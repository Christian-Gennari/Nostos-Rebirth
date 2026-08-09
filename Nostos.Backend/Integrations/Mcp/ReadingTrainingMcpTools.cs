using System.ComponentModel;
using ModelContextProtocol.Server;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Integrations.Mcp;

/// <summary>
/// Reading Training MCP tools. Every tool forwards to the deterministic
/// <see cref="IReadingTrainingService"/>, which is the sole authority for the
/// SQLite-backed reading state: no EF context, filesystem, or Hermes runtime
/// is touched here. Read-only tools (Task 9B1) never mutate state; sub-envelope
/// tools (week, books) extract their payload verbatim from the server's
/// dashboard envelope. Every mutating tool (Task 9B2) requires a
/// caller-supplied idempotency key, constructs the accepted public request
/// DTO with the fixed client id <see cref="ClientId"/>, and delegates exactly
/// once to the service — retries are the caller's concern, the service owns
/// duplicate convergence and returns the authoritative envelope unchanged.
/// </summary>
[McpServerToolType]
public sealed class ReadingTrainingMcpTools
{
    // Stable client identity for the Nostos MCP surface: receipts are keyed
    // by (ClientId, IdempotencyKey), so this fixed id keeps MCP retries
    // converging on the same command regardless of which client or session
    // issued them.
    private const string ClientId = "nostos-mcp";

    private readonly IReadingTrainingService _service;

    public ReadingTrainingMcpTools(IReadingTrainingService service)
    {
        _service = service;
    }

    [McpServerTool(Name = "reading_get_dashboard", ReadOnly = true)]
    [Description("Gets the full Reading Training dashboard from the server: programme targets, book queue, open session, and current-week summary.")]
    public Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct) =>
        _service.GetDashboardAsync(ct);

    [McpServerTool(Name = "reading_get_status", ReadOnly = true)]
    [Description("Gets the current Reading Training session status from the server (open session, or none).")]
    public Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct) =>
        _service.GetStatusAsync(ct);

    [McpServerTool(Name = "reading_get_week", ReadOnly = true)]
    [Description("Gets the server-authoritative summary of the current ISO week from the Reading Training dashboard.")]
    public async Task<ReadingCommandResultDto> GetCurrentWeekAsync(CancellationToken ct)
    {
        var dashboard = await _service.GetDashboardAsync(ct);
        return dashboard.Data is ReadingDashboardDto dto
            ? dashboard with { Data = dto.CurrentWeek }
            : dashboard;
    }

    [McpServerTool(Name = "reading_list_history", ReadOnly = true)]
    [Description("Lists completed and cancelled Reading Training sessions from the server.")]
    public Task<ReadingCommandResultDto> ListHistoryAsync(CancellationToken ct) =>
        _service.GetHistoryAsync(ct);

    [McpServerTool(Name = "reading_list_books", ReadOnly = true)]
    [Description("Lists the server-authoritative Reading Training book queue from the dashboard.")]
    public async Task<ReadingCommandResultDto> ListBooksAsync(CancellationToken ct)
    {
        var dashboard = await _service.GetDashboardAsync(ct);
        return dashboard.Data is ReadingDashboardDto dto
            ? dashboard with { Data = dto.Books }
            : dashboard;
    }

    [McpServerTool(Name = "reading_list_inbox", ReadOnly = true)]
    [Description("Lists unresolved Reading Training inbox captures from the server.")]
    public Task<ReadingCommandResultDto> ListInboxAsync(CancellationToken ct) =>
        _service.ListInboxAsync(ct);

    [McpServerTool(Name = "reading_preview_review", ReadOnly = true)]
    [Description("Previews the weekly review for the given ISO year and week without committing it.")]
    public Task<ReadingCommandResultDto> PreviewWeeklyReviewAsync(
        [Description("ISO-8601 week-numbering year of the week to preview.")] int year,
        [Description("ISO-8601 week number of the year (1-53).")] int week,
        CancellationToken ct = default) =>
        _service.PreviewWeeklyReviewAsync(new ReadingWeeklyReviewRequest(year, week), ct);

    // --- session and capture mutations (Task 9B2) ---
    // Every tool below requires a caller-supplied idempotencyKey (no default,
    // no generated key), builds the accepted public request DTO with the fixed
    // ClientId, and delegates exactly once to the service; the service's
    // envelope — success or rejection, duplicate or fresh — is returned
    // unchanged. No domain rules are precomputed or validated here.

    [McpServerTool(Name = "reading_plan_session")]
    [Description("Plans a reading session for the given active book and mode. The target is minutes; pages are optional book progress, never the training target.")]
    public Task<ReadingCommandResultDto> PlanSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the active book assignment to plan the session for.")] Guid bookAssignmentId,
        [Description("Session mode: Endurance, Deep, or Recovery.")] ReadingMode mode,
        [Description("Planned session length in minutes.")] int targetMinutes,
        [Description("Optional session constraint: None, TimeConstrained, or FatigueConstrained.")] ReadingConstraint constraint = ReadingConstraint.None,
        CancellationToken ct = default) =>
        _service.PlanSessionAsync(new ReadingPlanSessionRequest(
            ClientId, idempotencyKey, bookAssignmentId, mode, targetMinutes, constraint), ct);

    [McpServerTool(Name = "reading_start_session")]
    [Description("Starts the planned reading session. Omit sessionId to start the open planned session.")]
    public Task<ReadingCommandResultDto> StartSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Optional id of the planned session to start; omitted starts the open planned session.")] Guid? sessionId = null,
        CancellationToken ct = default) =>
        _service.StartSessionAsync(new ReadingStartSessionRequest(ClientId, idempotencyKey, sessionId), ct);

    [McpServerTool(Name = "reading_pause_session")]
    [Description("Pauses the open reading session.")]
    public Task<ReadingCommandResultDto> PauseSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        CancellationToken ct = default) =>
        _service.PauseSessionAsync(new ReadingSessionCommandRequest(ClientId, idempotencyKey), ct);

    [McpServerTool(Name = "reading_resume_session")]
    [Description("Resumes the paused reading session.")]
    public Task<ReadingCommandResultDto> ResumeSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        CancellationToken ct = default) =>
        _service.ResumeSessionAsync(new ReadingSessionCommandRequest(ClientId, idempotencyKey), ct);

    [McpServerTool(Name = "reading_complete_session")]
    [Description("Finishes the open reading session and requests ratings. reportedMinutes is optional; if you tracked pages instead of a timer, estimate the minutes read — pages are optional book progress, not the training target.")]
    public Task<ReadingCommandResultDto> CompleteSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Optional actual minutes read; omitted uses the measured time.")] int? reportedMinutes = null,
        CancellationToken ct = default) =>
        _service.CompleteSessionAsync(new ReadingCompleteSessionRequest(ClientId, idempotencyKey, reportedMinutes), ct);

    [McpServerTool(Name = "reading_rate_session")]
    [Description("Records effort and focus ratings (1-10) for the finished session. They are self-reported measurements of the session, not achievements or gamification; rating is an optional overall mark.")]
    public Task<ReadingCommandResultDto> RateSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Self-reported effort during the session, 1 (low) to 10 (high).")] int effort,
        [Description("Self-reported focus during the session, 1 (low) to 10 (high).")] int focus,
        [Description("Optional overall rating for the session.")] int? rating = null,
        CancellationToken ct = default) =>
        _service.RateSessionAsync(new ReadingRateSessionRequest(ClientId, idempotencyKey, effort, focus, rating), ct);

    [McpServerTool(Name = "reading_cancel_session")]
    [Description("Cancels the open reading session. It will not count toward training.")]
    public Task<ReadingCommandResultDto> CancelSessionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        CancellationToken ct = default) =>
        _service.CancelSessionAsync(new ReadingSessionCommandRequest(ClientId, idempotencyKey), ct);

    [McpServerTool(Name = "reading_capture")]
    [Description("Saves a verbatim reading capture (thought, question, or bookmark). Text is stored exactly as given — no trimming or rewriting; pages are optional context, never the training target.")]
    public Task<ReadingCommandResultDto> CaptureAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("The exact text to save, stored verbatim.")] string text,
        [Description("Capture kind: Thought, Question, or Bookmark.")] ReadingCaptureType type,
        [Description("Optional book to attach the capture to; omitted attaches to the open session's book.")] Guid? bookId = null,
        [Description("Optional session to attach the capture to; omitted attaches to the open session.")] Guid? sessionId = null,
        [Description("Optional external identifier for exact-once capture retries.")] string? externalId = null,
        CancellationToken ct = default) =>
        _service.CaptureAsync(new ReadingCaptureRequest(
            ClientId, idempotencyKey, text, type, bookId, sessionId, externalId), ct);

    // "Answer now" pauses the current session through the service's
    // authoritative pause operation so a saved question can be answered; the
    // question text itself is served separately by reading_list_inbox. The
    // tool neither reads EF nor synthesizes a pause or any text of its own.
    [McpServerTool(Name = "reading_answer_now")]
    [Description("Pauses the current reading session so a saved question can be answered. The question text is available through reading_list_inbox.")]
    public Task<ReadingCommandResultDto> AnswerNowAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        CancellationToken ct = default) =>
        _service.PauseSessionAsync(new ReadingSessionCommandRequest(ClientId, idempotencyKey), ct);

    // --- book queue, capture resolution, and weekly review mutations ---
    // Same exact-once contract as the session tools above: the tool only
    // builds the accepted public DTO with the fixed ClientId and delegates
    // once; ids, modes, and weeks are forwarded verbatim for the service to
    // validate, and no client-side inference replaces a server decision.

    [McpServerTool(Name = "reading_add_book")]
    [Description("Adds an existing Nostos book (by id) to the training queue in the given mode, optionally as the mode's default book. Pages are optional book progress and never the training target; sessions are measured in minutes.")]
    public Task<ReadingCommandResultDto> AddBookAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the existing Nostos book to add to the queue.")] Guid bookId,
        [Description("Queue mode for the book: Endurance, Deep, or Recovery.")] ReadingMode mode,
        [Description("Optional: make this book the mode's default book.")] bool makeDefault = false,
        CancellationToken ct = default) =>
        _service.AddBookAssignmentAsync(new ReadingAddBookAssignmentRequest(
            ClientId, idempotencyKey, bookId, mode, makeDefault), ct);

    [McpServerTool(Name = "reading_set_default_book")]
    [Description("Makes the given active book assignment the default book of its mode. The assignment must already belong to that mode.")]
    public Task<ReadingCommandResultDto> SetDefaultBookAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the active book assignment to make the default.")] Guid bookAssignmentId,
        [Description("Mode the assignment belongs to: Endurance, Deep, or Recovery.")] ReadingMode mode,
        CancellationToken ct = default) =>
        _service.SetDefaultBookAsync(new ReadingSetDefaultBookRequest(
            ClientId, idempotencyKey, bookAssignmentId, mode), ct);

    [McpServerTool(Name = "reading_finish_book")]
    [Description("Marks the given book assignment as finished. The server rejects the command while the book has an open session; finish or cancel that session first.")]
    public Task<ReadingCommandResultDto> FinishBookAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the active book assignment to finish.")] Guid bookAssignmentId,
        CancellationToken ct = default) =>
        _service.CompleteBookAsync(new ReadingCompleteBookRequest(
            ClientId, idempotencyKey, bookAssignmentId), ct);

    [McpServerTool(Name = "reading_resolve_capture")]
    [Description("Resolves an unresolved inbox capture: keep=true saves it to the existing note given by noteId, keep=false dismisses it. The server validates the capture and note ids and rejects keep=true without a matching note.")]
    public Task<ReadingCommandResultDto> ResolveCaptureAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the unresolved capture to resolve.")] Guid captureId,
        [Description("True to keep the capture (requires noteId), false to dismiss it.")] bool keep,
        [Description("Optional id of the existing note to keep the capture on; required when keep is true.")] Guid? noteId = null,
        CancellationToken ct = default) =>
        _service.ResolveCaptureAsync(captureId, new ReadingResolveCaptureRequest(
            ClientId, idempotencyKey, keep, noteId), ct);

    [McpServerTool(Name = "reading_commit_review")]
    [Description("Commits the weekly review for the given ISO year and week. The server recomputes the review from the recorded sessions, persists it, and returns the immutable committed result.")]
    public Task<ReadingCommandResultDto> CommitReviewAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("ISO-8601 week-numbering year of the week to commit.")] int year,
        [Description("ISO-8601 week number of the year (1-53).")] int week,
        CancellationToken ct = default) =>
        _service.CommitWeeklyReviewAsync(new ReadingCommitWeeklyReviewRequest(
            ClientId, idempotencyKey, year, week), ct);
}
