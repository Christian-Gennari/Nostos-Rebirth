using System.Security.Cryptography;
using System.Text;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// Task 11A dry-run import planner DTOs.
//
// These records describe a *plan* for importing the six Hermes reading-coach
// source files into Nostos. Nothing here touches the database, the filesystem
// outside the caller-supplied source directory, or the live Hermes data; the
// planner is a pure function of (directory contents, library candidates,
// explicit mappings, limits).
// ---------------------------------------------------------------------------

/// <summary>Bounded-read limits for the source file set.</summary>
public sealed record HermesImportLimits(
    long MaxFileBytes = 8 * 1024 * 1024,
    long MaxLineBytes = 64 * 1024,
    int MaxJsonlLines = 100_000);

/// <summary>A book the caller's library can currently offer for reconciliation.</summary>
public sealed record LibraryBookCandidate(Guid Id, string Title, string Author);

/// <summary>Stable reason codes emitted by the planner (blockers, skips, warnings).</summary>
public static class HermesImportCodes
{
    // --- hard blockers ----------------------------------------------------
    public const string DirectoryNotFound = "directory_not_found";
    public const string DirectorySymlink = "directory_symlink";
    public const string PathEscape = "path_escape";
    public const string FileSymlink = "file_symlink";
    public const string FileMissing = "file_missing";
    public const string FileNotUtf8 = "file_not_utf8";
    public const string FileTooLarge = "file_too_large";
    public const string FileTooManyLines = "file_too_many_lines";
    public const string UnreadableFile = "unreadable_file";
    public const string MalformedJson = "malformed_json";
    public const string DuplicateJsonKey = "duplicate_json_key";
    public const string MalformedYaml = "malformed_yaml";
    public const string DuplicateYamlKey = "duplicate_yaml_key";
    public const string InvalidYamlKey = "invalid_yaml_key";
    public const string UnsafeYamlTag = "unsafe_yaml_tag";
    public const string UnsafeYamlAlias = "unsafe_yaml_alias";
    public const string UnsupportedSchemaVersion = "unsupported_schema_version";
    public const string InvalidSource = "invalid_source";
    public const string OpenSessionPending = "open_session_pending";
    public const string SourceInconsistent = "source_inconsistent";
    public const string BookNotFound = "book_not_found";
    public const string BookAmbiguous = "book_ambiguous";
    public const string ExplicitMappingTargetMissing = "explicit_mapping_target_missing";

    // --- skips (stable, non-blocking) --------------------------------------
    public const string IncidentPollution = "incident_pollution";
    public const string DuplicateSessionId = "duplicate_session_id";
    public const string UnresolvedRatingEvent = "unresolved_rating_event";
    public const string UnresolvedCaptureDisposition = "unresolved_capture_disposition";
    public const string UnrecognizedRecordType = "unrecognized_record_type";
    public const string UnrecognizedMode = "unrecognized_mode";
    public const string UnrecognizedSessionStatus = "unrecognized_session_status";
    public const string UnrecognizedCaptureType = "unrecognized_capture_type";
    public const string UnrecognizedConstraint = "unrecognized_constraint";
    public const string UnrecognizedQueueStatus = "unrecognized_queue_status";
    public const string UnrecognizedQueueMode = "unrecognized_queue_mode";
    public const string InvalidQueueEntry = "invalid_queue_entry";
    public const string DuplicateQueueEntry = "duplicate_queue_entry";
    public const string MissingBookReference = "missing_book_reference";

    // --- warnings ------------------------------------------------------------
    public const string ActiveMirrorMismatch = "active_mirror_mismatch";
    public const string SessionBookNotInQueue = "session_book_not_in_queue";
    public const string UnparseableTimestamp = "unparseable_timestamp";
    public const string IncompleteConfig = "incomplete_config";

    // --- book mapping decisions ---------------------------------------------
    public const string DecisionUniqueAuto = "unique_auto";
    public const string DecisionExplicitMatched = "explicit_matched";
    public const string DecisionNotFound = "not_found";
    public const string DecisionAmbiguous = "ambiguous";
    public const string DecisionExplicitTargetMissing = "explicit_target_missing";
}

/// <summary>A single source file checksum (name, byte length, SHA-256 hex).</summary>
public sealed record HermesFileChecksum(string Name, long Length, string Sha256);

/// <summary>A non-blocking diagnostic (warning) or a blocking diagnostic (blocker).</summary>
public sealed record HermesImportIssue(string Code, string Detail, string? File = null, long? Line = null);

/// <summary>A record deliberately left out of the plan (stable reason code).</summary>
public sealed record HermesImportSkip(
    string Code,
    string Detail,
    string? File = null,
    long? Line = null,
    string? SourceId = null);

/// <summary>Per-file line counts (JSONL line counts include blank lines as written).</summary>
public sealed record HermesFileLines(string Name, long Lines);

/// <summary>Raw source counts, per file and per record type.</summary>
public sealed record HermesSourceCounts(
    int QueueEntries,
    int QueueYamlBooks,
    bool ActiveSessionPresent,
    bool ActiveSessionOpen,
    int LogRecords,
    int SessionRecords,
    int RatingRecords,
    int RatingSkippedRecords,
    int ActualMinutesRecords,
    int OtherLogRecords,
    int InboxRecords,
    int CaptureRecords,
    int DispositionRecords,
    int MirrorRecords,
    int OtherInboxRecords);

/// <summary>Planned import counts (what the cutover would create).</summary>
public sealed record HermesPlannedCounts(
    int Programme,
    int Assignments,
    int SessionsCompleted,
    int SessionsCancelled,
    int CapturesThought,
    int CapturesQuestion,
    int CapturesBookmark);

/// <summary>Exact book reconciliation decision for one source book.</summary>
public sealed record HermesBookMappingDecision(
    string SourceBookId,
    string SourceTitle,
    string SourceAuthor,
    string Decision,
    Guid? BookId,
    string? MatchedTitle,
    string? MatchedAuthor,
    string Detail);

/// <summary>Planned programme row (maps to the Nostos singleton ReadingProgramme).</summary>
public sealed record HermesPlannedProgramme(
    Guid Id,
    string TimezoneId,
    int BaselineEnduranceMinutes,
    int BaselineDeepMinutes,
    int BaselineRecoveryMinutes,
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
    DateTimeOffset? InitializedAt,
    string? InitializedAtRaw);

/// <summary>Planned book assignment (maps to a Nostos ReadingBookAssignment).</summary>
public sealed record HermesPlannedAssignment(
    Guid Id,
    Guid BookId,
    string SourceBookId,
    string Title,
    string Author,
    ReadingMode Mode,
    ReadingAssignmentStatus Status,
    int QueueOrder,
    bool IsDefault,
    string? ThoughtNote,
    string? SourceRecord,
    string? EditionId,
    string? AddedAtRaw,
    string? CompletedAtRaw,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt);

/// <summary>Planned session (maps to a Nostos ReadingSession).</summary>
public sealed record HermesPlannedSession(
    Guid Id,
    string SourceSessionId,
    ReadingMode Mode,
    ReadingSessionStatus Status,
    ReadingConstraint Constraint,
    int TargetMinutes,
    int PlannedTargetMinutes,
    bool ProgressionEligible,
    bool CountsAsFailure,
    DateTimeOffset? PlannedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string? StartedAtRaw,
    string? DoneAtRaw,
    string? DateRaw,
    int AccumulatedSeconds,
    int ClockMinutes,
    int ActualMinutes,
    int? ReportedMinutes,
    int? Effort,
    int? Focus,
    bool RatingsSkipped,
    bool CompletedTarget,
    bool CompletedPlannedTarget,
    string? Notes,
    string SourceBookId,
    Guid BookId,
    Guid? BookAssignmentId,
    long SourceLine);

/// <summary>Planned capture (maps to a Nostos ReadingCapture). Text is preserved verbatim.</summary>
public sealed record HermesPlannedCapture(
    Guid Id,
    string SourceCaptureId,
    ReadingCaptureType Type,
    string Text,
    DateTimeOffset? CapturedAt,
    string CapturedAtRaw,
    string? DateRaw,
    Guid BookId,
    string SourceBookId,
    string? SourceSessionId,
    Guid? PlannedSessionId,
    string? SourceTurnId,
    bool Resolved,
    string? LastDisposition,
    long SourceLine);

/// <summary>The complete deterministic dry-run import report.</summary>
public sealed record HermesImportDryRunReport(
    bool Blocked,
    IReadOnlyList<HermesFileChecksum> Files,
    string AggregateFingerprint,
    HermesSourceCounts SourceCounts,
    IReadOnlyList<HermesFileLines> SourceLines,
    HermesPlannedCounts PlannedCounts,
    HermesPlannedProgramme? Programme,
    IReadOnlyList<HermesPlannedAssignment> Assignments,
    IReadOnlyList<HermesPlannedSession> Sessions,
    IReadOnlyList<HermesPlannedCapture> Captures,
    IReadOnlyList<HermesBookMappingDecision> BookMappings,
    IReadOnlyList<HermesImportIssue> Blockers,
    IReadOnlyList<HermesImportIssue> Warnings,
    IReadOnlyList<HermesImportSkip> Skips);

// ---------------------------------------------------------------------------
// Deterministic identifier derivation (RFC 4122 UUID v5 over a fixed
// importer namespace). Plan records carry these ids so reruns produce
// byte-identical reports and the cutover slice can reference assignments.
// ---------------------------------------------------------------------------

internal static class DeterministicGuid
{
    private static readonly Guid Namespace = new("6f1e7f2a-2b3c-4d5e-8f90-0a1b2c3d4e5f");

    public static Guid For(string kind, string sourceId)
    {
        // RFC-order namespace bytes straight from the canonical hex form.
        var nsBytes = Convert.FromHexString(Namespace.ToString("N"));
        var nameBytes = Encoding.UTF8.GetBytes($"nostos-reading-import:{kind}:{sourceId}");
        var digest = SHA1.HashData(nsBytes.Concat(nameBytes).ToArray());
        var rfc = digest.AsSpan(0, 16).ToArray();
        rfc[6] = (byte)((rfc[6] & 0x0F) | 0x50); // version 5
        rfc[8] = (byte)((rfc[8] & 0x3F) | 0x80); // RFC 4122 variant
        // .NET Guid(byte[]) expects the mixed-endian layout; reverse data1..data3.
        return new Guid(
        [
            rfc[3], rfc[2], rfc[1], rfc[0],
            rfc[5], rfc[4],
            rfc[7], rfc[6],
            rfc[8], rfc[9], rfc[10], rfc[11], rfc[12], rfc[13], rfc[14], rfc[15],
        ]);
    }

    public static Guid AssignmentFor(string sourceBookId) => For("assignment", sourceBookId);
    public static Guid SessionFor(string sourceSessionId) => For("session", sourceSessionId);
    public static Guid CaptureFor(string sourceCaptureId) => For("capture", sourceCaptureId);
    public static Guid ProgrammeId => ReadingProgramme.WellKnownId;
}
