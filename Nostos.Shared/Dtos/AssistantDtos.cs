namespace Nostos.Shared.Dtos;

// --- ASSISTANT BRIDGE WIRE CONTRACT (issue #261 §3, decision D2) ---
// The Angular assistant shell sends one structured turn and receives the reply,
// any deterministic follow-up question, non-mutating suggestions, and a pending
// plan to approve later. The context DTO mirrors the frontend context service
// field-for-field (the names in the 261-S2 brief); it is deliberately not a
// superset and carries no field the client does not already resolve.

/// <summary>
/// One assistant turn. <paramref name="ClientId"/> and
/// <paramref name="IdempotencyKey"/> flow straight through to
/// <c>notes_capture</c>, so a retried turn cannot create a second note.
/// </summary>
public sealed record AssistantTurnRequest(
    string ClientId,
    string IdempotencyKey,
    string Message,
    AssistantContextDto Context,
    string? PendingPlanId = null,
    // APPENDED (positional record): the post-processing mode the composer used
    // to send per capture (issue #262 §7). It is now IGNORED: the capture mode
    // comes from the stored assistant setting, which the owner chooses once in
    // Settings. It is kept for wire compatibility — the record is append-only
    // and other callers may still send it — so removing it is a separate
    // decision, not this change.
    string? ProcessingMode = null,
    // APPENDED (positional record): the recent turns the client remembers, so the
    // model can follow the exchange instead of rebuilding it from nothing each
    // turn (issue #286). Untrusted, client-supplied text: it travels only as
    // ordinary user/assistant turns and is never stored server-side.
    IReadOnlyList<AssistantHistoryMessageDto>? History = null);

/// <summary>
/// One remembered turn sent by the client (issue #286). <c>Role</c> is
/// <c>"user"</c> or <c>"assistant"</c>; any other role is ignored by the
/// orchestrator and never promoted to a system message. <c>Text</c> is untrusted
/// user-supplied text.
/// </summary>
public sealed record AssistantHistoryMessageDto(string Role, string Text);

/// <summary>
/// What the user is looking at. Mirrors the frontend
/// <c>AssistantContextService</c> snapshot; nulls are the norm and are never
/// guessed at.
/// </summary>
public sealed record AssistantContextDto(
    string Surface,
    string Route,
    string? BookId = null,
    string? BookTitle = null,
    string? BookFormat = null,
    string? ReaderType = null,
    string? EpubCfi = null,
    int? PdfPage = null,
    double? AudioTimestamp = null,
    string? AudioChapter = null,
    string? SelectedText = null,
    string? BrainReviewNoteId = null,
    string? Concept = null,
    string? CollectionId = null,
    AssistantAnchorDto? Anchor = null);

/// <summary>
/// A resolved source anchor. <c>Verified</c> is true ONLY for an anchor the app
/// acquired itself; a value the user typed is never verified.
/// </summary>
public sealed record AssistantAnchorDto(
    string Kind,
    string? Value = null,
    bool Verified = false);

/// <summary>
/// A normal turn result. <c>Suggestions</c> is always present (empty when the
/// model proposed none); <c>PendingPlan</c> is non-null only when a
/// PlanAndAct tool was requested and is waiting for explicit approval.
/// </summary>
public sealed record AssistantTurnResponse(
    string Reply,
    string? Acknowledgement,
    AssistantAnchorPromptDto? AnchorPrompt,
    IReadOnlyList<AssistantSuggestionDto> Suggestions,
    AssistantPendingPlanDto? PendingPlan,
    // APPENDED (positional record): the id of the note a capture created this
    // turn, so the surface can show its raw transcript and offer restore
    // (issue #262 §8). Null when the turn captured nothing.
    string? CapturedNoteId = null);

/// <summary>
/// The deterministic source-location follow-up. Present only when the capture's
/// format cannot supply an anchor and none was given; answering (or explicitly
/// skipping with <c>kind = "unknown"</c>) completes the capture.
/// </summary>
public sealed record AssistantAnchorPromptDto(string Kind, string Question);

/// <summary>
/// A non-mutating proposal. The user selects one; the assistant never links or
/// applies a suggestion on its own.
/// </summary>
public sealed record AssistantSuggestionDto(
    string Kind,
    string Label,
    string Reason,
    string? Value = null);

/// <summary>
/// A plan the assistant will not run inline. <c>ApprovalToken</c> is bound to
/// this <c>PlanId</c> and is required by
/// <c>POST /api/assistant/plan/approve</c>; a missing or mismatched pair is
/// refused and mutates nothing.
/// </summary>
public sealed record AssistantPendingPlanDto(
    string PlanId,
    string Summary,
    IReadOnlyList<AssistantPlanStepDto> Steps,
    string ApprovalToken);

/// <summary>One ordered step of a pending plan; executed exactly as stored.</summary>
public sealed record AssistantPlanStepDto(
    string Capability,
    string Summary,
    string ArgumentsJson);

/// <summary>Approve exactly one pending plan.</summary>
public sealed record AssistantPlanApproveRequest(
    string PlanId,
    string? ApprovalToken);

/// <summary>
/// The result of executing an approved plan. Failures are data
/// (<c>ErrorCode</c>), never hidden behind a 200-shaped success.
/// </summary>
public sealed record AssistantPlanApproveResponse(
    bool Success,
    string? ErrorCode,
    string? ErrorMessage,
    IReadOnlyList<AssistantPlanStepOutcomeDto> Steps);

/// <summary>Outcome of one executed plan step, in plan order.</summary>
public sealed record AssistantPlanStepOutcomeDto(
    string Capability,
    bool Success,
    string? ErrorCode,
    string? ErrorMessage,
    object? Data);

// --- ASSISTANT SETTINGS (issue #262 §7) ---
// The settings the owner picks once, stored on the server. The wire contract is
// frozen: GET/PUT /api/settings/assistant carry exactly the one field below.

/// <summary>
/// The stored assistant settings as returned to the client. The single field is
/// the effective capture post-processing mode; it is <c>"verbatim"</c> when the
/// owner has never chosen.
/// </summary>
public sealed record AssistantSettingsResponse(string CaptureProcessingMode);

/// <summary>
/// A settings update. <c>CaptureProcessingMode</c> must be one of the supported
/// modes; anything else (including absent) is refused with
/// <c>invalid_processing_mode</c> and stores nothing.
/// </summary>
public sealed record AssistantSettingsUpdateRequest(string? CaptureProcessingMode);
