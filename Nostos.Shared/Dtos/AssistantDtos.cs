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
    string? PendingPlanId = null);

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
    AssistantPendingPlanDto? PendingPlan);

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
