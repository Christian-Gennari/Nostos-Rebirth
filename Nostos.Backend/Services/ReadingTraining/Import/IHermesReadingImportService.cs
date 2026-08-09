namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// Task 11B1: transactional cutover of the accepted Hermes import plan.
//
// The public surface is deliberately small and side-effect-free unless a
// commit is explicitly requested:
//   * PlanAsync        – read-only dry run (planner + library candidates).
//   * CommitAsync      – persists an already-built immutable plan atomically.
//   * PlanAndCommitAsync – plan once, then commit that exact report (no
//                         second parse of the source files after backup).
// ---------------------------------------------------------------------------

public enum HermesImportCommitStatus
{
    DryRun = 0,
    Blocked = 1,
    Committed = 2,
    Duplicate = 3,
    Failed = 4,
}

/// <summary>Stable error codes on Blocked/Failed results.</summary>
public static class HermesImportCommitCodes
{
    public const string Blocked = "blocked";
    public const string BlockedNoProgramme = "blocked_no_programme";
    public const string BlockedInvalidFingerprint = "blocked_invalid_fingerprint";
    public const string TargetNotClean = "target_not_clean";
    public const string BackupFailed = "backup_failed";
    public const string CommitFailed = "commit_failed";
    public const string Cancelled = "cancelled";
}

/// <summary>
/// Outcome of a plan or commit call. Never carries source bodies, capture
/// text, session notes, or raw source paths; <see cref="Report"/> is the
/// planner's immutable plan and <see cref="ResultJson"/> is the stored
/// receipt payload (see <see cref="HermesImportReceiptPayload"/>).
/// </summary>
public sealed record HermesImportCommitResult(
    HermesImportCommitStatus Status,
    HermesImportDryRunReport? Report,
    Guid? ReceiptId,
    Guid? BackupId,
    string? ResultJson,
    string? ErrorCode);

/// <summary>Rows actually persisted by a commit (equals the plan for a clean commit).</summary>
public sealed record HermesCommittedCounts(int Assignments, int Sessions, int Captures);

/// <summary>
/// Versioned canonical receipt payload (ResultJson, version "1"). Excludes
/// capture text, session notes, and raw source paths by construction.
/// </summary>
public sealed record HermesImportReceiptPayload(
    string Version,
    string AggregateFingerprint,
    Guid BackupId,
    IReadOnlyList<HermesFileChecksum> Files,
    HermesSourceCounts SourceCounts,
    HermesPlannedCounts PlannedCounts,
    HermesCommittedCounts Committed,
    IReadOnlyList<HermesBookMappingDecision> BookMappings,
    IReadOnlyList<HermesImportSkip> Skips,
    IReadOnlyList<HermesImportIssue> Warnings,
    DateTime CommittedAtUtc);

public interface IHermesReadingImportService
{
    /// <summary>
    /// Read-only dry run: queries the current Nostos library as candidate
    /// books, runs the planner, and returns the immutable report. Zero
    /// writes, zero backup, zero receipts.
    /// </summary>
    Task<HermesImportCommitResult> PlanAsync(
        string sourceDirectory,
        IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
        CancellationToken ct = default);

    /// <summary>
    /// Persists an already-built plan atomically: validates it, creates the
    /// pre-transaction backup, then inserts/updates the singleton programme,
    /// assignments, sessions, captures, and one immutable receipt inside a
    /// single EF transaction. Rerunning the same fingerprint is an exact
    /// no-op returning the stored receipt.
    /// </summary>
    Task<HermesImportCommitResult> CommitAsync(
        HermesImportDryRunReport report,
        CancellationToken ct = default);

    /// <summary>
    /// Plans once and commits that exact report; no second parse after the
    /// backup is taken.
    /// </summary>
    Task<HermesImportCommitResult> PlanAndCommitAsync(
        string sourceDirectory,
        IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
        CancellationToken ct = default);
}
