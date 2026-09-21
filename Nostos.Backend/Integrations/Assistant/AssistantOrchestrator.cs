using System.Globalization;
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
        var messages = BuildConversation(request);
        var tools = BuildTools();

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
                var quoteFidelity = false;
                BookDecision? book = null;

                if (capability.Trust == AssistantTrustClass.Capture
                    && string.Equals(capability.Name, CaptureCapability, StringComparison.Ordinal))
                {
                    // The book is decided BEFORE the anchor, because it is the
                    // fact the rest of the capture depends on: the app knows it
                    // (the book that is open) or asks for it. It is never the
                    // model's to choose — measured: left to pick, the model filed
                    // thoughts against books it went and found.
                    var decided = await DecideBookAsync(request.Context, ct);
                    if (decided.Prompt is { } bookPrompt)
                    {
                        anchorPrompt = bookPrompt;
                        messages.Add(LlmMessage.Tool(call.Id, ToolJson(new
                        {
                            status = "awaiting_book",
                            kind = bookPrompt.Kind,
                            question = bookPrompt.Question,
                            message = "Ask the user for this; do not save the capture yet.",
                        })));
                        continue;
                    }

                    book = decided;

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
                        book.BookId!.Value,
                        captureProcessingMode,
                        out quoteFidelity);
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
                    acknowledgement = BuildAcknowledgement(book!.Title, quoteFidelity);
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

    private List<LlmMessage> BuildConversation(AssistantTurnRequest request)
    {
        var messages = new List<LlmMessage> { LlmMessage.System(BuildSystemPrompt()) };

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

        // A selection is named for the same reason, and only when there is one:
        // measured twice, the model answered "Save this passage." and asked the
        // user to supply a passage that was already in the context, and asking
        // for the text the app already holds is exactly the friction this
        // feature exists to remove.
        if (!string.IsNullOrWhiteSpace(request.Context?.SelectedText))
        {
            messages.Add(LlmMessage.System(
                "A passage is selected in the reader right now: it is the 'selectedText' value in the context above. "
                + "When the user says to save, keep, note or record a passage, a quote or a highlight, that selection "
                + "is the passage — capture it as selectedText in that same turn, and do not ask them for text the app "
                + "already has."));
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

    private string BuildSystemPrompt()
    {
        var abilities = registry.All.Select(capability =>
        {
            var mode = capability.Trust switch
            {
                AssistantTrustClass.Suggest => "read-only",
                AssistantTrustClass.Capture => "immediate capture",
                AssistantTrustClass.Act => "immediate action",
                AssistantTrustClass.PlanAndAct => "requires approval",
                _ => "unknown",
            };

            return $"- {capability.Name} [{mode}]: {capability.Summary}";
        });

        return SystemPrompt
            + "\n\nAvailable abilities in this Nostos installation:\n"
            + string.Join("\n", abilities);
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
        - Immediate action tools perform ordinary user-requested Nostos work in the current turn. Use their real result before deciding the next step.
        - Approval-required tools are destructive/high-impact. Calling one records a plan step; do not claim it ran until the user explicitly approves that plan.
        - Never claim an action succeeded unless a tool result says it did. If a tool fails, use the failure result to recover, clarify, or report what stopped.

        A capture is the user giving you something of their own to keep: a thought, an observation, a reaction, a question they are sitting with, or a passage they want recorded. Ask yourself whether the user is TELLING you something of theirs or ASKING you something. Telling you is a capture: save it with notes_capture in that same turn, whether they say "save this", "note that", "capturing a thought" or "I just had a thought I wanted to write down", or simply tell you the thought. Asking — about the library, or for something to be found, read, explained, summarised or compared — is not a capture: answer it and capture nothing. Answering a capture instead of saving it loses the user's words, so when a message does both, save the part that is theirs and answer the rest.

        The thought you were given is not a topic to discuss. Do not comment on it, evaluate it, agree with it, develop it or improve it.

        Capture the user's own words exactly as they arrived: `content` is the user's message itself, with only the instruction removed. "I keep coming back to the idea that attention is the real scarce resource, not time" is captured exactly like that — not shortened to "attention is the real scarce resource, not time". Never paraphrase, shorten, translate, correct, tidy or add to them, and never keep only the part you judge to be the essential one: the preamble is theirs too. How the words are rendered is decided by a setting, not by you.

        A passage the reader has selected is already in the context. When the user says to save, keep, note or record a passage, a quote, a highlight, "this" or "this passage", that selection is what they mean: capture it as selectedText in that same turn. Do not ask them to supply the text, and do not ask which passage they mean — asking is the failure here, because the app already has it.

        The book is the app's, not yours: a capture goes to the book that is open, and when no book is open the app asks the user which one it belongs to before saving anything. You never choose a book, and you never name one you found in the library. Never invent a page, position or timestamp either: the capture tool asks for those itself when they cannot be known.

        A capture is saved only when the notes_capture result says it succeeded. If it fails, say in one line what failed. The words "saved" may only follow a successful notes_capture result, and the app confirms a capture itself — including where it went — so keep your own reply to one short line and never restate the book, page or note, or name one that a tool result did not give you.

        Do not answer a thought with what you found. A thought that resembles notes you already have is still a new capture: save it, and do not reply with a list of those notes.

        An explicitly named note or concept in the user's message beats the ambient context. If a target is ambiguous or matches only weakly, ask one short clarifying question instead of guessing.

        Nostos product knowledge:
        - The Library already has search, sorting, status filters (Not Started, In Progress, Favorites, Finished, Unsorted), and built-in format filters for Audiobooks, eBooks and PDFs.
        - Collections are hierarchical, user-defined structures for durable themes, projects, curricula, reading paths or other meaningful groupings. A book may belong to more than one collection.
        - Do not recommend collections merely to recreate a Library filter or sort that already exists. In particular, an Audiobooks/eBooks/PDFs collection is normally redundant because format filtering is built in.
        - Creating/restructuring collections and assigning books are separate operations. To change a book's collection membership, use library_update_book with collectionIds. That field is a FULL replacement set: read the current book first and preserve memberships the user did not ask to remove.
        - Notes and quotes belong to books and may be linked to existing concepts. The Second Brain is for relationships between notes and concepts; its review flow surfaces notes that are not yet linked.
        - The current application context tells you what surface, book, passage and reading position Nostos already knows. Use it rather than asking the user to repeat known context.

        Ground answers in the user's actual Nostos data:
        - When the user asks about their books, collections, notes or concepts, or asks for advice based on what they currently have, use the relevant read capability before answering. Do not substitute generic library advice for data you can inspect.
        - For a whole-library organization or recommendation question, prefer library_overview: it is complete and compact, and avoids reasoning from only the first page of books.
        - When the user asks what you can do, answer only from the Available abilities supplied below. Distinguish read-only inspection, immediate capture, immediate actions, and changes that require approval. Do not generalize beyond the registered capabilities.
        - When the user explicitly asks you to add, update, organize, rename, move, or link something and an immediate action capability exists, do the work rather than merely describing how they could do it.
        - Multi-step work is allowed: inspect first when needed, execute one action, read its actual result, then use that result in the next tool call. Do not pre-invent ids or pretend later steps happened.

        Never invent a source location. When a capture has no location, the tool layer asks the user for a page or timestamp; do not guess one.

        Quotes: only present a passage as an exact quotation when it came from the digital source. Otherwise the capture records that it was typed by hand and may differ.

        Keep replies to a sentence or two unless the user asks for more. Do not use markdown headings.
        """;

    // ------------------------------------------------------------------
    // Book policy (deterministic)
    // ------------------------------------------------------------------

    /// <summary>
    /// Decides which book a capture belongs to, or asks. The model never chooses
    /// a book: the app either knows it (the book that is open) or asks the user
    /// and resolves the answer. The answer is resolved through the canonical
    /// library service with external metadata off, so an answer either names a
    /// book in the library or is questioned again.
    /// </summary>
    private async Task<BookDecision> DecideBookAsync(AssistantContextDto? context, CancellationToken ct)
    {
        // The open book needs no resolution and cannot be overridden: whatever
        // the user says, this is where the words were written.
        if (Guid.TryParse(context?.BookId, out var open))
        {
            return BookDecision.At(open, context?.BookTitle);
        }

        var title = context?.CaptureBookTitle;
        if (string.IsNullOrWhiteSpace(title))
        {
            return BookDecision.Ask(new AssistantAnchorPromptDto(BookPromptKind, WhichBookQuestion));
        }

        var resolved = await library.ResolveBookAsync(
            new LibraryResolveBookRequest(Title: title.Trim(), IncludeExternalMetadata: false),
            ct);

        return resolved.Resolution switch
        {
            LibraryResolution.ExactMatch when resolved.MatchedBook is { } match =>
                BookDecision.At(match.Id, match.Title),

            // Exactly one candidate is an answer, not an ambiguity. More than
            // one is the user's to settle, so it becomes the same question again.
            LibraryResolution.Candidates when resolved.Candidates is { Count: 1 } only =>
                BookDecision.At(only[0].BookId, only[0].Title),

            _ => BookDecision.Ask(new AssistantAnchorPromptDto(BookPromptKind, BookNotFoundQuestion)),
        };
    }

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
        Guid bookId,
        string mode,
        out bool quoteFidelity)
    {
        quoteFidelity = false;

        var obj = ParseObject(argumentsJson);

        // The book is the APP's, exactly like the anchor, and it is now the ONLY
        // source: the open book, or the book the user named when the capture
        // asked. Measured against the live gateway with Pride and Prejudice open:
        // the model searched notes, found one about the same subject in another
        // book, and filed the thought there — and because the acknowledgement is
        // built from the ambient context, the confirmation then named a book the
        // note was not filed against. Both were wrong, and neither was visible.
        // An open book is a fact; a book the model went and found is a guess.
        obj["bookId"] = bookId.ToString();

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

    private static string BuildAcknowledgement(string? bookTitle, bool quoteFidelity)
    {
        var text = string.IsNullOrWhiteSpace(bookTitle)
            ? "Saved."
            : $"Saved to {bookTitle}.";

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

    /// <summary>
    /// Which book a capture belongs to, or the question that must be asked
    /// before it can be saved. Exactly one of the two is set. The title travels
    /// with the id so the confirmation can name the book even when the ambient
    /// context never knew it — the answer's title, not the open book's.
    /// </summary>
    private sealed record BookDecision(Guid? BookId, string? Title, AssistantAnchorPromptDto? Prompt)
    {
        public static BookDecision At(Guid bookId, string? title) => new(bookId, title, null);

        public static BookDecision Ask(AssistantAnchorPromptDto prompt) => new(null, null, prompt);
    }
}
