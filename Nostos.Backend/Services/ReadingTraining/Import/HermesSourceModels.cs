namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// Typed models of the six Hermes reading-coach source files, parsed strictly
// from the engine grammar (reading_coach/engine.py, config.py, captures.py).
// Only fields the import planner consumes are surfaced.
// ---------------------------------------------------------------------------

/// <summary>A book in the source queue (training-state.json, reading-queue.yaml).</summary>
internal sealed record HermesSourceBook(
    string Id,
    string Title,
    string Author,
    string CurrentMode,
    string Status,
    string? ThoughtNote,
    string? SourceRecord,
    string? EditionId,
    string? AddedAt,
    string? CompletedAt,
    int QueueOrder);

/// <summary>A session or evidence event parsed from reading-log.jsonl.</summary>
internal sealed record HermesSourceSession(
    string SessionId,
    string Status,
    string Mode,
    string BookId,
    string BookTitle,
    string Author,
    int PlannedTarget,
    int SessionTarget,
    string? Constraint,
    bool ProgressionEligible,
    bool CountsAsFailure,
    string? StartedAt,
    string? DoneAt,
    string? Date,
    int ActiveSeconds,
    int ClockMinutes,
    int ActualMinutes,
    int? ReportedMinutes,
    int? Effort,
    int? Focus,
    bool CompletedTarget,
    bool CompletedPlannedTarget,
    string? Notes,
    string? IncidentMarker,
    bool AccidentalMarker,
    long Line);

/// <summary>A capture record parsed from reading-inbox.jsonl (text verbatim).</summary>
internal sealed record HermesSourceCapture(
    string Id,
    string Type,
    string Text,
    string CapturedAt,
    string? Date,
    string BookId,
    string BookTitle,
    string? SessionId,
    string? TurnId,
    bool Resolved,
    string? LastDisposition,
    long Line);

/// <summary>Parsed config.yaml policy (baseline targets, timezone).</summary>
internal sealed record HermesSourceConfig(
    string TimezoneId,
    int BaselineEnduranceMinutes,
    int BaselineDeepMinutes,
    int BaselineRecoveryMinutes);

/// <summary>Parsed training-state.json programme facts and queue.</summary>
internal sealed record HermesSourceState(
    HermesSourceProgrammeState Programme,
    IReadOnlyList<HermesSourceBook> Queue,
    HermesSourceOpenSession? OpenSession);

/// <summary>Programme facts from training-state.json (targets, phase, deload).</summary>
internal sealed record HermesSourceProgrammeState(
    int EnduranceTargetMinutes,
    int DeepTargetMinutes,
    int RecoveryTargetMinutes,
    int EnduranceEstablishedMinutes,
    int DeepEstablishedMinutes,
    int RecoveryEstablishedMinutes,
    bool EnduranceDeloaded,
    bool DeepDeloaded,
    string? EnduranceDeloadWeek,
    string? DeepDeloadWeek,
    int EnduranceConsecutiveIncreases,
    int DeepConsecutiveIncreases,
    string TrainingPhase,
    string? InitializedAt);

/// <summary>An open session inside training-state.json (hard dry-run blocker).</summary>
internal sealed record HermesSourceOpenSession(string SessionId, string Status);

/// <summary>Parsed reading-queue.yaml mirror (bucket = Active | UpNext | Completed).</summary>
internal sealed record HermesSourceQueueDoc(
    IReadOnlyList<HermesSourceBook> Books,
    IReadOnlyDictionary<string, (string Bucket, string Mode)> Placements);

/// <summary>Parsed active-session.json mirror flag.</summary>
internal sealed record HermesSourceActiveMirror(bool Present, bool ClaimsOpen);

/// <summary>Parsed reading-log.jsonl evidence.</summary>
internal sealed record HermesSourceLog(
    IReadOnlyList<HermesSourceSession> Sessions,
    IReadOnlyList<HermesSourceRatingEvent> RatingEvents,
    IReadOnlyList<HermesSourceRatingSkippedEvent> RatingSkippedEvents,
    IReadOnlyList<HermesSourceActualMinutesEvent> ActualMinutesEvents);

internal sealed record HermesSourceRatingEvent(string SessionId, int Effort, int Focus, long Line);
internal sealed record HermesSourceRatingSkippedEvent(string SessionId, long Line);
internal sealed record HermesSourceActualMinutesEvent(string SessionId, int Minutes, long Line);

/// <summary>Parsed reading-inbox.jsonl captures.</summary>
internal sealed record HermesSourceInbox(IReadOnlyList<HermesSourceCapture> Captures);
