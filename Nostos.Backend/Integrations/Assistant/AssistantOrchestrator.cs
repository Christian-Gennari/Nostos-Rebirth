using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Nostos.Backend.Configuration;
using Nostos.Backend.Services.Ai;
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
/// <see cref="AssistantTrustClass.Capture"/> executes immediately,
/// <see cref="AssistantTrustClass.Suggest"/> never mutates, and
/// <see cref="AssistantTrustClass.PlanAndAct"/> is NEVER executed inline — it is
/// collected into a server-held plan and returned for explicit approval.</item>
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
    AssistantOptions options,
    ILogger<AssistantOrchestrator> logger)
{
    /// <summary>
    /// Generous on purpose: the free pool spends reasoning tokens even on a
    /// two-word answer, and a tighter budget truncates real replies.
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
        var messages = BuildConversation(request);
        var tools = BuildTools();

        // The capture post-processing mode is the owner's stored setting, resolved
        // once per turn (issue #262 §7). It is deliberately not read from the
        // request or from the tool call: the owner chose it once, and a
        // per-capture mode would make that choice meaningless.
        var captureProcessingMode = await settings.GetCaptureProcessingModeAsync(ct);

        var toolContext = new AssistantToolContext(
            ClientId: request.ClientId,
            IdempotencyKey: request.IdempotencyKey,
            PlanId: request.PendingPlanId);

        var suggestions = new List<AssistantSuggestionDto>();
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

            foreach (var call in completion.ToolCalls)
            {
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
                var quoteFidelity = false;

                if (capability.Trust == AssistantTrustClass.Capture
                    && string.Equals(capability.Name, CaptureCapability, StringComparison.Ordinal))
                {
                    var decision = DecideAnchor(request.Context);

                    // The deterministic anchor follow-up: no anchor and a format
                    // that cannot supply one means ask, never guess.
                    if (decision.Prompt is { } prompt)
                    {
                        anchorPrompt = prompt;
                        messages.Add(LlmMessage.Tool(call.Id, ToolJson(new
                        {
                            status = "awaiting_anchor",
                            kind = prompt.Kind,
                            question = prompt.Question,
                            message = "Ask the user for this; do not save the capture yet.",
                        })));
                        continue;
                    }

                    args = BuildCaptureArgs(
                        call.ArgumentsJson,
                        request.Context,
                        decision,
                        captureProcessingMode,
                        out quoteFidelity);
                }
                else
                {
                    args = ParseArguments(call.ArgumentsJson);
                }

                var result = await registry.InvokeAsync(capability.Name, args, toolContext, ct);
                messages.Add(LlmMessage.Tool(call.Id, ToolJson(result)));

                if (result.Success && capability.Trust == AssistantTrustClass.Suggest)
                {
                    MergeSuggestions(suggestions, ExtractSuggestions(capability.Name, result.Data));
                }

                if (result.Success
                    && capability.Trust == AssistantTrustClass.Capture
                    && string.Equals(capability.Name, CaptureCapability, StringComparison.Ordinal))
                {
                    acknowledgement = BuildAcknowledgement(request.Context, quoteFidelity);
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
        // that it could not finish, rather than returning an empty reply.
        var reply = lastAssistantContent?.Trim();
        if (string.IsNullOrWhiteSpace(reply))
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
            capturedNoteId);
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
    public async Task<AssistantPlanApproveResponse> ApproveAsync(
        string? planId,
        string? approvalToken,
        CancellationToken ct = default)
    {
        var outcome = plans.Approve(planId, approvalToken);
        if (!outcome.Approved || outcome.Plan is null)
        {
            return new AssistantPlanApproveResponse(
                false,
                outcome.ErrorCode,
                outcome.ErrorMessage,
                []);
        }

        var plan = outcome.Plan;

        var results = new List<AssistantPlanStepOutcomeDto>(plan.Steps.Count);
        for (var index = 0; index < plan.Steps.Count; index++)
        {
            var step = plan.Steps[index];

            // Each step needs its OWN idempotency key. Canonical library commands
            // dedupe on (client, key), so reusing the plan's single key would make
            // every step after the first a no-op replay of the first — a
            // multi-step reorganisation would silently apply only step one.
            // Deriving from the consumed plan id keeps the key stable and short.
            var context = new AssistantToolContext(
                ClientId: plan.ConversationKey,
                IdempotencyKey: $"{plan.PlanId}:{index}",
                PlanId: plan.PlanId,
                Approval: new AssistantPlanApproval(plan.PlanId, plan.ApprovalToken));

            var args = ParseArguments(step.ArgumentsJson);
            var result = await registry.InvokeAsync(step.Capability, args, context, ct);

            results.Add(new AssistantPlanStepOutcomeDto(
                step.Capability,
                result.Success,
                result.ErrorCode,
                result.ErrorMessage,
                result.Data));

            // Execute the plan in order; a failed step stops the rest rather
            // than blindly applying later steps on a broken base.
            if (!result.Success)
            {
                break;
            }
        }

        var success = results.Count > 0 && results.All(r => r.Success);
        var failure = results.LastOrDefault(r => !r.Success);
        return new AssistantPlanApproveResponse(
            success,
            success ? null : failure?.ErrorCode,
            success ? null : failure?.ErrorMessage,
            results);
    }

    // ------------------------------------------------------------------
    // Conversation / tool construction
    // ------------------------------------------------------------------

    private static List<LlmMessage> BuildConversation(AssistantTurnRequest request)
    {
        var messages = new List<LlmMessage> { LlmMessage.System(SystemPrompt) };

        var contextJson = JsonSerializer.Serialize(request.Context ?? new AssistantContextDto("other", "/"), JsonOptions);
        messages.Add(LlmMessage.System(
            "Current application context (JSON). Nulls mean the app does not know that value; never invent it. "
            + contextJson));

        // The Brain review flow is named explicitly, not left to be inferred from
        // the context blob: the note id is what notes_read_for_review needs, and
        // the "small set of existing concepts, never create or auto-link" rule is
        // the whole point of the review (issue #261 §5).
        if (!string.IsNullOrWhiteSpace(request.Context?.BrainReviewNoteId))
        {
            messages.Add(LlmMessage.System(
                $"The user is reviewing the unlinked note '{request.Context!.BrainReviewNoteId}' in the Second Brain. "
                + "To suggest where it belongs, read it with notes_read_for_review (that noteId), then look for matching "
                + "existing concepts with concepts_list or concepts_search. "
                + $"Offer at most {MaxConceptSuggestions} existing concepts, each with a brief reason. "
                + "Never create a concept to satisfy a suggestion, and never link a note without the user choosing."));
        }

        if (!string.IsNullOrWhiteSpace(request.PendingPlanId))
        {
            messages.Add(LlmMessage.System(
                $"There is one pending plan awaiting explicit approval, with id '{request.PendingPlanId}'. "
                + "Do not claim it has run. The user approves it through the plan approval action, which carries this id."));
        }

        // Client-supplied recent turns. This is UNTRUSTED text: it travels only
        // as ordinary user/assistant turns and must never be promoted to a system
        // message or concatenated into one, whatever a role field claims.
        messages.AddRange(BuildHistory(request.History));

        // The identity is injected LAST on purpose. The gateway prepends its own
        // system prompt, so an identity stated at the top of the list loses to
        // it; a system message the provider sees closest to the user's turn does
        // not. Position is the whole mechanism — do not move this earlier.
        messages.Add(LlmMessage.System(AssistantSoul.Prompt));

        messages.Add(LlmMessage.User(request.Message));
        return messages;
    }

    /// <summary>
    /// Maps client-supplied history to conversation turns. The text is UNTRUSTED
    /// and is used only as ordinary user/assistant content, never as a system
    /// message. Blank entries and unknown roles are dropped outright; the list is
    /// clamped to the last <see cref="MaxHistoryExchanges"/> exchanges and each
    /// message to <see cref="MaxHistoryCharsPerMessage"/> characters. Server-side
    /// conversation state is deliberately absent: the client re-sends what it
    /// remembers, so the server stays stateless (issue #286).
    /// </summary>
    private static IEnumerable<LlmMessage> BuildHistory(
        IReadOnlyList<AssistantHistoryMessageDto>? history)
    {
        if (history is null || history.Count == 0)
        {
            return [];
        }

        var kept = new List<(bool IsUser, string Text)>();
        foreach (var entry in history)
        {
            if (entry is null || string.IsNullOrWhiteSpace(entry.Text))
            {
                continue;
            }

            var isUser = string.Equals(entry.Role, "user", StringComparison.OrdinalIgnoreCase);
            var isAssistant = string.Equals(entry.Role, "assistant", StringComparison.OrdinalIgnoreCase);
            if (!isUser && !isAssistant)
            {
                // An unknown role is ignored: it is never treated as a system
                // message or any other privileged turn.
                continue;
            }

            kept.Add((isUser, TruncateHistory(entry.Text)));
        }

        // An exchange is a user message plus the assistant messages that followed
        // it. Keep everything from the earliest of the last MaxHistoryExchanges
        // user-role entries onward.
        var userIndexes = kept
            .Select((entry, index) => (entry, index))
            .Where(pair => pair.entry.IsUser)
            .Select(pair => pair.index)
            .ToList();

        var start = userIndexes.Count > MaxHistoryExchanges
            ? userIndexes[userIndexes.Count - MaxHistoryExchanges]
            : 0;

        return kept
            .Skip(start)
            .Select(entry => entry.IsUser
                ? LlmMessage.User(entry.Text)
                : LlmMessage.Assistant(entry.Text));
    }

    private static string TruncateHistory(string text) =>
        text.Length <= MaxHistoryCharsPerMessage
            ? text
            : text[..MaxHistoryCharsPerMessage] + HistoryTruncationMarker;

    private IReadOnlyList<LlmToolDefinition> BuildTools() =>
        registry.All
            .Select(capability => new LlmToolDefinition(
                capability.Name,
                capability.Summary,
                capability.ParametersJsonSchema))
            .ToList();

    /// <summary>
    /// The behavior contract given to the model: it states the trust classes,
    /// the explicit-targets-beat-ambient rule, and the quote-fidelity rule; the
    /// orchestrator enforces the parts that must not depend on model goodwill
    /// (approval, anchors, plan capture). Identity and voice live in
    /// <see cref="AssistantSoul"/>, injected separately as the last system
    /// message.
    /// </summary>
    private const string SystemPrompt =
        """
        You have tools. Use them to read the user's library and to capture thoughts.
        - Capture tools run immediately; after a capture, confirm in one short line.
        - Read and suggestion tools never change anything and may be called freely.
        - State-changing tools never run during a turn. Calling one records a plan step. Tell the user what the plan will do and wait for explicit approval; never claim the change has happened.
        - Never claim an action succeeded unless a tool result says it did.

        A capture is the user giving you something of their own to keep: a thought, an observation, a reaction, a question they are sitting with, or a passage they want recorded. Save it with notes_capture in the same turn, whether they say "save this", "note that", "capturing a thought" or "I just had a thought I wanted to write down", or simply tell you the thought. Do not answer it, discuss it, comment on it or improve it.

        A question about the library, or a request to find, read, explain, summarise or compare something, is not a capture. Answer it and capture nothing.

        Capture the user's own words exactly as they arrived. Never paraphrase, shorten, translate, correct, tidy or add to them; how they are rendered is decided by a setting, not by you. A passage quoted from the book itself goes in selectedText.

        The book comes from the current context first. If the context has no book and the user did not name one, ask which book it belongs to — one short question — and do not save until the answer is known; then resolve the book with the read tools. Never invent a page, position or timestamp: the capture tool asks for those itself when they cannot be known.

        A capture is saved only when the notes_capture result says it succeeded. If it fails, say in one line what failed. The words "saved" may only follow a successful notes_capture result.

        An explicitly named book, note, or concept in the user's message beats the ambient context. If a target is ambiguous or matches only weakly, ask one short clarifying question instead of guessing.

        Never invent a source location. When a capture has no location, the tool layer asks the user for a page or timestamp; do not guess one.

        Quotes: only present a passage as an exact quotation when it came from the digital source. Otherwise the capture records that it was typed by hand and may differ.

        Keep replies to a sentence or two unless the user asks for more. Do not use markdown headings.
        """;

    // ------------------------------------------------------------------
    // Anchor policy (deterministic)
    // ------------------------------------------------------------------

    /// <summary>
    /// Decides where a capture is anchored, or asks. The model never supplies
    /// the anchor: it is derived from what the app actually knows.
    /// </summary>
    private JsonElement BuildCaptureArgs(
        string argumentsJson,
        AssistantContextDto? context,
        AnchorDecision decision,
        string mode,
        out bool quoteFidelity)
    {
        quoteFidelity = false;

        var obj = ParseObject(argumentsJson);

        // The ambient book is the default; an explicit target in the tool call
        // already overrides it.
        if (!HasValue(obj, "bookId") && !string.IsNullOrWhiteSpace(context?.BookId))
        {
            obj["bookId"] = context!.BookId;
        }

        var selectedText = ReadString(obj, "selectedText") ?? context?.SelectedText;
        if (!string.IsNullOrWhiteSpace(selectedText))
        {
            obj["selectedText"] = selectedText;
        }

        // The orchestrator owns the anchor. A guessed one would file the note
        // against the wrong place, which is worse than none.
        obj["sourceAnchorKind"] = decision.Kind;
        obj["sourceAnchorValue"] = decision.Value;
        obj["anchorVerified"] = decision.Verified;

        // The stored setting is the ONLY source of the mode. Whatever
        // `processingMode` the tool call carried is overwritten on purpose: the
        // owner chose the mode once, so neither a per-capture request nor the
        // model may change it. It rides on the canonical `processingMode`
        // argument the capability's reader already accepts, so the frozen
        // capability signature does not change (issue #262 §7).
        obj["processingMode"] = mode;

        if (string.Equals(decision.Kind, "epub_cfi", StringComparison.Ordinal)
            && !string.IsNullOrWhiteSpace(decision.Value))
        {
            obj["cfiRange"] = decision.Value;
        }

        var content = ReadString(obj, "content");
        if (!string.IsNullOrWhiteSpace(selectedText) && !decision.Verified)
        {
            quoteFidelity = true;
            if (!string.IsNullOrWhiteSpace(content)
                && !content.Contains(QuoteFidelityNote, StringComparison.Ordinal))
            {
                obj["content"] = $"{content}\n\n_{QuoteFidelityNote}_";
            }
        }

        return JsonSerializer.SerializeToElement(obj, JsonOptions);
    }

    private static AnchorDecision DecideAnchor(AssistantContextDto? context)
    {
        // An anchor the client supplied is an answer (or an explicit skip).
        if (context?.Anchor is { } anchor)
        {
            if (string.IsNullOrWhiteSpace(anchor.Kind)
                || string.Equals(anchor.Kind, "unknown", StringComparison.OrdinalIgnoreCase)
                || string.IsNullOrWhiteSpace(anchor.Value))
            {
                return AnchorDecision.Skip();
            }

            return AnchorDecision.At(anchor.Kind, anchor.Value, anchor.Verified);
        }

        // No anchor at all: derive one from an app-known location.
        if (context is not null)
        {
            if (!string.IsNullOrWhiteSpace(context.EpubCfi))
            {
                return AnchorDecision.At("epub_cfi", context.EpubCfi, verified: true);
            }

            if (context.PdfPage is not null)
            {
                return AnchorDecision.At(
                    "pdf_page",
                    context.PdfPage.Value.ToString(CultureInfo.InvariantCulture),
                    verified: true);
            }

            if (context.AudioTimestamp is not null)
            {
                return AnchorDecision.At(
                    "audio_timestamp",
                    context.AudioTimestamp.Value.ToString(CultureInfo.InvariantCulture),
                    verified: true);
            }
        }

        // The format cannot supply a location: ask.
        var prompt = AnchorPromptFor(context);
        return prompt is null ? AnchorDecision.Skip() : AnchorDecision.Ask(prompt);
    }

    private static AssistantAnchorPromptDto? AnchorPromptFor(AssistantContextDto? context)
    {
        if (context is null)
        {
            return null;
        }

        if (string.Equals(context.BookFormat, "physical", StringComparison.OrdinalIgnoreCase))
        {
            return new AssistantAnchorPromptDto("physical_page", "What page are you on?");
        }

        // An in-app audio reader publishes its own timestamp; only an external
        // audiobook (no in-app reader open) needs to be asked.
        if (string.Equals(context.BookFormat, "audiobook", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(context.ReaderType, "audio", StringComparison.OrdinalIgnoreCase))
        {
            return new AssistantAnchorPromptDto(
                "external_audio_timestamp",
                "What's the current timestamp?");
        }

        return null;
    }

    private static string BuildAcknowledgement(AssistantContextDto? context, bool quoteFidelity)
    {
        var text = string.IsNullOrWhiteSpace(context?.BookTitle)
            ? "Saved."
            : $"Saved to {context!.BookTitle}.";

        // The response contract carries no undo field; the note id and the note
        // itself are the affordance, so point at them.
        text += " You can undo this from your notes.";

        if (quoteFidelity)
        {
            text += $" {QuoteFidelityNote}";
        }

        return text;
    }

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

    private static bool HasValue(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is not null;

    private static string? ReadString(JsonObject obj, string name)
    {
        if (!obj.TryGetPropertyValue(name, out var node) || node is null)
        {
            return null;
        }

        try
        {
            return node.GetValue<string>();
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

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

    /// <summary>
    /// Where a capture ended up, or the decision that we must ask first.
    /// </summary>
    private sealed record AnchorDecision(
        string Kind,
        string? Value,
        bool Verified,
        AssistantAnchorPromptDto? Prompt)
    {
        public static AnchorDecision At(string kind, string? value, bool verified) =>
            new(kind, value, verified, null);

        public static AnchorDecision Skip() => new("unknown", null, false, null);

        public static AnchorDecision Ask(AssistantAnchorPromptDto prompt) =>
            new("unknown", null, false, prompt);
    }
}
