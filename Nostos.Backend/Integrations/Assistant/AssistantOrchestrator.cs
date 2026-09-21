using System.Text.Json;
using System.Text.Json.Nodes;
using Nostos.Backend.Configuration;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Services.Library;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// The backend assistant bridge (issue #261 §3, §4, §7): it gives the assistant
/// an LLM and an in-process tool loop over <see cref="AssistantCapabilityRegistry"/>.
///
/// Design rules, in one place:
/// <list type="bullet">
/// <item>Tools are generated from the registry, one per capability, using its
/// <c>Summary</c>. There is no MCP round trip: the assistant reaches its own
/// Nostos instance through the same canonical services the REST surface uses.</item>
/// <item>Trust classes are enforced here as well as in the registry.
/// <see cref="AssistantTrustClass.Capture"/> and normal
/// <see cref="AssistantTrustClass.Act"/> work execute inside the tool loop,
/// <see cref="AssistantTrustClass.Suggest"/> never mutates, and only destructive
/// <see cref="AssistantTrustClass.PlanAndAct"/> work is collected into a
/// server-held plan for explicit approval.</item>
/// <item>The source-location follow-up is deterministic: when a capture has no
/// nearby anchor and the format cannot supply one, the bridge asks (physical
/// book → a page; externally played audiobook → a timestamp) instead of
/// guessing. An explicitly skipped anchor still captures as <c>unknown</c>.</item>
/// </list>
/// </summary>
public sealed class AssistantOrchestrator(
    AssistantCapabilityRegistry registry,
    ILlmProvider llm,
    AssistantPlanStore plans,
    IAssistantSettingsService settings,
    ILibraryService library,
    AssistantOptions options,
    ILogger<AssistantOrchestrator> logger)
{
    private readonly AssistantConversationBuilder _conversation = new(registry);
    private readonly AssistantPlanExecutor _planExecutor = new(registry, plans);
    private readonly AssistantCapturePolicy _capturePolicy = new(library);

    /// <summary>
    /// Generous on purpose: a tool-calling turn can spend reasoning tokens even
    /// on a two-word reply, and a tighter budget truncates real answers.
    /// </summary>
    public const int MaxResponseTokens = 4096;

    /// <summary>
    /// The review flow's "small set": at most five candidate concepts are shown
    /// for one unlinked note. A longer list is a search result, not a suggestion
    /// (issue #261 §5).
    /// </summary>
    public const int MaxConceptSuggestions = 5;

    /// <summary>
    /// How many past exchanges of client-supplied history are kept. An exchange
    /// is a user message plus the assistant message(s) that followed it; older
    /// turns are dropped rather than sent (issue #286).
    /// </summary>
    public const int MaxHistoryExchanges = 10;

    /// <summary>
    /// Per-message ceiling for client-supplied history. A longer message is
    /// truncated and marked with <see cref="HistoryTruncationMarker"/> so the
    /// model can see the cut (issue #286).
    /// </summary>
    public const int MaxHistoryCharsPerMessage = 2000;

    /// <summary>
    /// Appended to a history message that exceeded
    /// <see cref="MaxHistoryCharsPerMessage"/>, so the model can tell that text
    /// was cut rather than assume the message ended there.
    /// </summary>
    public const string HistoryTruncationMarker = " [history truncated]";

    /// <summary>
    /// Appended to a quote typed/transcribed by hand rather than read from the
    /// digital source, so the difference is never inferred later.
    /// </summary>
    public const string QuoteFidelityNote =
        "Quoted by hand; punctuation and wording may differ from the source.";

    /// <summary>
    /// The one-line reply when a turn ends with no assistant content at all —
    /// the measured "exhausted the tool loop and returned nothing" case. It is
    /// deliberately not an apology and never claims the request succeeded. It is
    /// "that", not "what you asked": roughly half of these turns are captures,
    /// where the user asked nothing and simply gave the assistant something.
    /// </summary>
    public const string IncompleteTurnReply = "I could not finish that.";

    /// <summary>
    /// The one question a capture asks when the app cannot know the book: no book
    /// is open and the user has not named one. Nothing is saved until it is
    /// answered, because a guess files the thought in the wrong place.
    /// </summary>
    public const string WhichBookQuestion = "Which book is this for?";

    /// <summary>
    /// The same question again, after an answer that named no book in the
    /// library. Asked rather than guessed: the second answer is as likely to be
    /// right as the first.
    /// </summary>
    public const string BookNotFoundQuestion = "I could not find that book. Which book is this for?";

    /// <summary>The prompt kind the client answers with the book's title.</summary>
    public const string BookPromptKind = "book";

    private const string CaptureCapability = "notes_capture";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly HashSet<string> ConceptSuggestionCapabilities = new(StringComparer.Ordinal)
    {
        "concepts_list",
        "concepts_search",
    };

    // ------------------------------------------------------------------
    // A turn
    // ------------------------------------------------------------------

    /// <summary>
    /// Runs one assistant turn: build the conversation and tools, loop over the
    /// model's tool calls, and return prose plus any suggestions / follow-up
    /// question / pending plan.
    /// </summary>
    public async Task<AssistantTurnResponse> HandleTurnAsync(
        AssistantTurnRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var conversationKey = ConversationKey(request.ClientId);
        var capabilityByName = registry.All.ToDictionary(c => c.Name, StringComparer.Ordinal);
        var messages = _conversation.BuildConversation(request);
        var tools = _conversation.BuildTools();

        // The capture post-processing mode is the owner's stored setting, resolved
        // once per turn (issue #262 §7). It is deliberately not read from the
        // request or from the tool call: the owner chose it once, and a
        // per-capture mode would make that choice meaningless.
        var captureProcessingMode = await settings.GetCaptureProcessingModeAsync(ct);

        var suggestions = new List<AssistantSuggestionDto>();
        var executedCapabilities = new List<string>();
        var planSteps = new List<AssistantPlanStep>();
        AssistantAnchorPromptDto? anchorPrompt = null;
        string? acknowledgement = null;
        string? finalContent = null;
        string? lastAssistantContent = null;
        string? capturedNoteId = null;

        var iterations = Math.Max(1, options.MaxToolIterations);
        for (var iteration = 0; iteration < iterations; iteration++)
        {
            var completion = await llm.CompleteAsync(
                new LlmCompletionRequest(messages, tools, MaxResponseTokens),
                ct);

            finalContent = completion.Content;
            if (!string.IsNullOrWhiteSpace(completion.Content))
            {
                lastAssistantContent = completion.Content;
            }

            if (completion.ToolCalls.Count == 0)
            {
                // A plain answer (including the pool's empty-content/"length"
                // outcome, which is data: it is returned as-is, never a 500).
                break;
            }

            messages.Add(LlmMessage.Assistant(completion.Content, completion.ToolCalls));

            var callOrdinal = 0;
            foreach (var call in completion.ToolCalls)
            {
                // Every tool call in one assistant turn needs its own receipt key.
                // Reusing the turn key would make the canonical library service
                // replay call #1 for call #2, silently breaking multi-step agent
                // work. Iteration + ordinal stay stable for a retried turn while
                // remaining distinct inside this bounded tool loop.
                var toolContext = new AssistantToolContext(
                    ClientId: request.ClientId,
                    IdempotencyKey: $"{request.IdempotencyKey}:{iteration}:{callOrdinal}");
                callOrdinal++;

                if (!capabilityByName.TryGetValue(call.Name, out var capability))
                {
                    messages.Add(LlmMessage.Tool(call.Id, ToolJson(new
                    {
                        status = "unknown_capability",
                        message = $"No assistant capability named '{call.Name}' exists.",
                    })));
                    continue;
                }

                // PlanAndAct is never executed inline. The call becomes an
                // ordered plan step; nothing is touched until approval.
                if (capability.Trust == AssistantTrustClass.PlanAndAct)
                {
                    planSteps.Add(new AssistantPlanStep(
                        capability.Name,
                        capability.Summary,
                        call.ArgumentsJson));

                    messages.Add(LlmMessage.Tool(call.Id, ToolJson(new
                    {
                        status = "pending_approval",
                        capability = capability.Name,
                        message = "Recorded as a plan step. It runs only after the user explicitly approves the plan.",
                    })));
                    continue;
                }

                JsonElement args;
                AssistantCapturePreparation? capture = null;

                if (capability.Trust == AssistantTrustClass.Capture
                    && string.Equals(capability.Name, CaptureCapability, StringComparison.Ordinal))
                {
                    capture = await _capturePolicy.PrepareAsync(
                        call.ArgumentsJson,
                        request.Context,
                        captureProcessingMode,
                        ct);

                    if (capture.Prompt is { } prompt)
                    {
                        anchorPrompt = prompt;
                        messages.Add(LlmMessage.Tool(call.Id, ToolJson(new
                        {
                            status = capture.PromptStatus,
                            kind = prompt.Kind,
                            question = prompt.Question,
                            message = capture.PromptMessage,
                        })));
                        continue;
                    }

                    args = capture.Arguments!.Value;
                }
                else
                {
                    args = ParseArguments(call.ArgumentsJson);
                }

                var result = await registry.InvokeAsync(capability.Name, args, toolContext, ct);
                messages.Add(LlmMessage.Tool(call.Id, ToolJson(result)));

                if (result.Success && capability.Trust == AssistantTrustClass.Act)
                {
                    executedCapabilities.Add(capability.Name);
                }

                if (result.Success && capability.Trust == AssistantTrustClass.Suggest)
                {
                    MergeSuggestions(suggestions, ExtractSuggestions(capability.Name, result.Data));
                }

                if (result.Success
                    && capability.Trust == AssistantTrustClass.Capture
                    && string.Equals(capability.Name, CaptureCapability, StringComparison.Ordinal))
                {
                    acknowledgement = AssistantCapturePolicy.BuildAcknowledgement(capture!.BookTitle, capture.QuoteFidelity);
                    capturedNoteId = ReadNoteId(result.Data);
                }
            }

            // Asking for a page/timestamp ends this turn deterministically; the
            // user's answer arrives as the next turn's context anchor.
            if (anchorPrompt is not null)
            {
                break;
            }
        }

        // A PlanAndAct call is only a proposal until the user approves it. A
        // second proposal supersedes the first: one pending plan per conversation.
        AssistantPendingPlanDto? pendingPlan = null;
        if (planSteps.Count > 0)
        {
            var summary = string.IsNullOrWhiteSpace(finalContent)
                ? string.Join("; ", planSteps.Select(step => step.Summary))
                : finalContent.Trim();

            var stored = plans.Create(conversationKey, request.IdempotencyKey, summary, planSteps);
            pendingPlan = ToPendingPlanDto(stored);
        }

        // Prefer the last non-empty assistant content from anywhere in the loop:
        // a model that narrated a tool call and then ran out of iterations still
        // said something. Only when it said nothing at all does the turn report
        // that it could not finish, rather than returning an empty reply — and
        // NOT when a capture succeeded, because that turn already has its own
        // confirmation, built from what the app actually did. Without this
        // exception the transcript would read "Saved to X." followed by "I could
        // not finish that."
        var reply = lastAssistantContent?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(reply) && acknowledgement is null)
        {
            reply = anchorPrompt?.Question
                ?? (pendingPlan is not null ? "I've prepared a plan for your approval." : IncompleteTurnReply);
        }

        // The conversational reply is the only text the guard may rewrite. Note
        // content, quotes, processing results and plan summaries are the user's
        // own words and must never be touched, so this runs here and nowhere else.
        var selfAssertedVendor = AssistantIdentityGuard.MatchVendorSelfAssertion(reply);
        if (selfAssertedVendor is not null)
        {
            // The matched term only: never the reply, the user's message, or the
            // content that was removed.
            logger.LogWarning(
                "Assistant identity guard replaced a self-asserted vendor/model mention: {VendorTerm}.",
                selfAssertedVendor);
            reply = AssistantIdentityGuard.Apply(reply);
        }

        logger.LogDebug(
            "Assistant turn handled: {Suggestions} suggestion(s), plan {HasPlan}, anchor prompt {HasPrompt}.",
            suggestions.Count,
            pendingPlan is not null,
            anchorPrompt is not null);

        return new AssistantTurnResponse(
            reply,
            acknowledgement,
            anchorPrompt,
            suggestions,
            pendingPlan,
            capturedNoteId,
            executedCapabilities);
    }

    // ------------------------------------------------------------------
    // Approval — executes exactly the stored plan, once
    // ------------------------------------------------------------------

    /// <summary>
    /// Executes exactly the stored plan whose id and token are presented. A
    /// missing token, an unknown id, a superseded id, or a mismatched token is
    /// refused by the store before any capability is reached, so a refused
    /// approval mutates nothing.
    /// </summary>
    public Task<AssistantPlanApproveResponse> ApproveAsync(
        string? planId,
        string? approvalToken,
        CancellationToken ct = default) =>
        _planExecutor.ApproveAsync(planId, approvalToken, ct);

    // ------------------------------------------------------------------
    // Suggestions (non-mutating)
    // ------------------------------------------------------------------

    /// <summary>
    /// Shapes a model-requested concept listing into response suggestions. This
    /// is deliberately not scoring: it does not rank, filter, or invent — it only
    /// conveys the candidates the model asked to see, with the one reason the
    /// data carries. The Brain flow's cap and de-duplication (issue #261 §5) are
    /// applied by <see cref="MergeSuggestions"/>, so both the listing and the
    /// search path pass through the same "small set" rule.
    /// </summary>
    private static IEnumerable<AssistantSuggestionDto> ExtractSuggestions(
        string capabilityName,
        JsonElement? data)
    {
        if (!ConceptSuggestionCapabilities.Contains(capabilityName)
            || data is not { } element
            || element.ValueKind != JsonValueKind.Array)
        {
            yield break;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var name = ReadString(item, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var usage = ReadInt(item, "usageCount");
            var reason = usage is > 0
                ? $"Existing concept used in {usage} note{(usage == 1 ? string.Empty : "s")}."
                : "Existing concept in your library.";

            yield return new AssistantSuggestionDto(
                "concept",
                name,
                reason,
                ReadString(item, "id"));
        }
    }

    /// <summary>
    /// Adds incoming suggestions to the response, de-duplicated by identity and
    /// capped for concepts. The cap is what makes the review a small set rather
    /// than a dump of the library; the de-duplication matters because
    /// <c>concepts_list</c> and <c>concepts_search</c> can both name the same
    /// concept in one turn. Nothing here creates or mutates anything.
    /// </summary>
    private static void MergeSuggestions(
        List<AssistantSuggestionDto> target,
        IEnumerable<AssistantSuggestionDto> incoming)
    {
        foreach (var suggestion in incoming)
        {
            var key = suggestion.Value ?? suggestion.Label;
            if (target.Any(existing =>
                    string.Equals(existing.Kind, suggestion.Kind, StringComparison.Ordinal)
                    && string.Equals(existing.Value ?? existing.Label, key, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            if (string.Equals(suggestion.Kind, "concept", StringComparison.Ordinal)
                && target.Count(existing => string.Equals(existing.Kind, "concept", StringComparison.Ordinal))
                    >= MaxConceptSuggestions)
            {
                continue;
            }

            target.Add(suggestion);
        }
    }

    // ------------------------------------------------------------------
    // Small JSON helpers
    // ------------------------------------------------------------------

    private static AssistantPendingPlanDto ToPendingPlanDto(StoredAssistantPlan stored) =>
        new(
            stored.PlanId,
            stored.Summary,
            stored.Steps
                .Select(step => new AssistantPlanStepDto(step.Capability, step.Summary, step.ArgumentsJson))
                .ToList(),
            stored.ApprovalToken);

    private static string ConversationKey(string? clientId) =>
        string.IsNullOrWhiteSpace(clientId) ? "anonymous" : clientId.Trim();

    private static JsonObject ParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(json) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static JsonElement ParseArguments(string? json) =>
        JsonSerializer.SerializeToElement(ParseObject(json), JsonOptions);

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>
    /// The id of the note a successful <c>notes_capture</c> produced, read from
    /// the canonical result envelope. Null when the shape is not what we expect:
    /// the surface then simply does not offer its raw-transcript affordance.
    /// </summary>
    private static string? ReadNoteId(JsonElement? data)
    {
        if (data is not { ValueKind: JsonValueKind.Object } element)
        {
            return null;
        }

        return element.TryGetProperty("value", out var value)
            && value.ValueKind == JsonValueKind.Object
            && value.TryGetProperty("id", out var id)
            && id.ValueKind == JsonValueKind.String
                ? id.GetString()
                : null;
    }

    private static int? ReadInt(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetInt32(out var number)
            ? number
            : null;

    private static string ToolJson(object value) => JsonSerializer.Serialize(value, JsonOptions);

}
