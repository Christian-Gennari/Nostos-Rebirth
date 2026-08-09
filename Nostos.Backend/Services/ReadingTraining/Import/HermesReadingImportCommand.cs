using System.Text;
using System.Text.Json;

namespace Nostos.Backend.Services.ReadingTraining.Import;

// ---------------------------------------------------------------------------
// Task 11B2: safe local one-shot reading import CLI.
//
// Pure command layer: argument parsing/validation, exactly one service call
// (PlanAsync for the default dry run, PlanAndCommitAsync for a confirmed
// commit), and exactly one sanitized compact JSON envelope on stdout.
//
// Safety properties:
//   * Import mode engages ONLY on the exact `--reading-import` token; all
//     other argument shapes leave the normal web startup untouched.
//   * The single validated absolute source directory is the only path ever
//     handed to the service. No HTTP endpoint, no arbitrary path exposure.
//   * The full report/commit result is NEVER serialized: the report carries
//     capture/session text, notes, titles, authors, and raw timestamps. The
//     envelope emits only stable codes, checksums, counts, and decisions.
//   * Argument errors happen before the service is ever called and carry a
//     stable error code only - never the offending argument/path/value.
//   * The command itself never writes live data or reads the Hermes data
//     root; it only reads the caller-supplied source directory (via the
//     planner) and calls the injected service.
// ---------------------------------------------------------------------------

public sealed class HermesReadingImportCommand
{
    /// <summary>Stable argument-error codes; never echo raw arguments.</summary>
    public static class ErrorCodes
    {
        public const string UnknownFlag = "unknown_flag";
        public const string DuplicateFlag = "duplicate_flag";
        public const string InvalidSourceDirectory = "invalid_source_dir";
        public const string InvalidBookMap = "invalid_book_map";
        public const string CommitConfirmationRequired = "commit_confirmation_required";
        public const string DatabaseMigrationFailed = "database_migration_failed";
        public const string UnexpectedError = "unexpected_error";
    }

    /// <summary>Exit codes: 0 unblocked dry-run/committed/duplicate, 2 blocked/failed, 64 argument error.</summary>
    public const int ExitOk = 0;
    public const int ExitBlockedOrFailed = 2;
    public const int ExitArgumentError = 64;

    /// <summary>Fully validated import-mode arguments.</summary>
    public sealed record Arguments(
        string SourceDirectory,
        IReadOnlyDictionary<string, Guid>? BookMappings,
        bool Commit);

    private readonly IHermesReadingImportService _service;

    public HermesReadingImportCommand(IHermesReadingImportService service) => _service = service;

    /// <summary>
    /// Parses import-mode arguments. Returns <c>true</c> with parsed arguments
    /// when the exact <c>--reading-import</c> token is present (dry run is the
    /// default). Returns <c>false</c> with a stable <paramref name="errorCode"/>
    /// on any import argument error. Returns <c>false</c> with a null
    /// <paramref name="errorCode"/> when import mode is not engaged at all, so
    /// normal Nostos arguments remain completely unaffected.
    /// </summary>
    public static bool TryParse(string[] args, out Arguments? parsed, out string? errorCode)
    {
        parsed = null;
        errorCode = null;

        string? sourceDirectory = null;
        var commit = false;
        var confirm = false;
        var mappings = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var sawSourceFlag = false;
        var sawImportOption = false;

        for (var i = 0; i < args.Length; i++)
        {
            var token = args[i];
            switch (token)
            {
                case "--reading-import":
                    sawImportOption = true;
                    if (sawSourceFlag)
                    {
                        errorCode = ErrorCodes.DuplicateFlag;
                        return false;
                    }
                    sawSourceFlag = true;
                    if (i + 1 >= args.Length)
                    {
                        errorCode = ErrorCodes.InvalidSourceDirectory;
                        return false;
                    }
                    sourceDirectory = args[++i];
                    break;

                case "--reading-book-map":
                    sawImportOption = true;
                    if (i + 1 >= args.Length || !TryParseBookMap(args[++i], mappings))
                    {
                        errorCode = ErrorCodes.InvalidBookMap;
                        return false;
                    }
                    break;

                case "--commit-reading-import":
                    sawImportOption = true;
                    if (commit)
                    {
                        errorCode = ErrorCodes.DuplicateFlag;
                        return false;
                    }
                    commit = true;
                    break;

                case "--confirm-reading-import":
                    sawImportOption = true;
                    if (confirm)
                    {
                        errorCode = ErrorCodes.DuplicateFlag;
                        return false;
                    }
                    confirm = true;
                    break;

                default:
                    // Unknown import-prefixed flag: fail closed rather than
                    // silently ignoring a typo'd import request.
                    if (IsImportPrefixed(token))
                    {
                        errorCode = ErrorCodes.UnknownFlag;
                        return false;
                    }
                    // Non-import arguments are ignored in import mode; the
                    // server never starts anyway.
                    break;
            }
        }

        if (commit != confirm)
        {
            errorCode = ErrorCodes.CommitConfirmationRequired;
            return false;
        }

        if (!sawSourceFlag)
        {
            if (sawImportOption)
                errorCode = ErrorCodes.InvalidSourceDirectory;
            return false;
        }

        if (string.IsNullOrEmpty(sourceDirectory) ||
            !Path.IsPathFullyQualified(sourceDirectory) ||
            !Directory.Exists(sourceDirectory))
        {
            errorCode = ErrorCodes.InvalidSourceDirectory;
            return false;
        }

        // Commit requires BOTH the commit and the confirm flag; either alone
        // is an argument error and the service is never called.
        parsed = new Arguments(sourceDirectory, mappings.Count > 0 ? mappings : null, commit);
        return true;
    }

    /// <summary>
    /// Runs the single service call for the validated arguments: exactly one
    /// <see cref="IHermesReadingImportService.PlanAsync"/> for a dry run or
    /// exactly one <see cref="IHermesReadingImportService.PlanAndCommitAsync"/>
    /// for a commit, then prints one sanitized JSON envelope. Never prints
    /// exception messages.
    /// </summary>
    public async Task<int> RunAsync(Arguments arguments, TextWriter output, CancellationToken ct = default)
    {
        HermesImportCommitResult result;
        try
        {
            result = arguments.Commit
                ? await _service.PlanAndCommitAsync(arguments.SourceDirectory, arguments.BookMappings, ct)
                : await _service.PlanAsync(arguments.SourceDirectory, arguments.BookMappings, ct);
        }
        catch (OperationCanceledException)
        {
            result = new HermesImportCommitResult(
                HermesImportCommitStatus.Failed, null, null, null, null,
                HermesImportCommitCodes.Cancelled);
        }
        catch (Exception)
        {
            result = new HermesImportCommitResult(
                HermesImportCommitStatus.Failed, null, null, null, null,
                ErrorCodes.UnexpectedError);
        }

        return WriteResult(output, result);
    }

    /// <summary>Prints the argument-error envelope (stable code only) and returns exit code 64.</summary>
    public static int WriteArgumentError(string errorCode, TextWriter output)
    {
        WriteEnvelope(
            output,
            status: "argument_error",
            errorCode: errorCode,
            receiptId: null,
            backupId: null,
            aggregateFingerprint: null,
            files: null,
            sourceCounts: null,
            plannedCounts: null,
            mappings: null,
            blockers: null,
            warnings: null,
            skips: null);
        return ExitArgumentError;
    }

    public static int WriteStartupError(string errorCode, TextWriter output)
    {
        WriteEnvelope(output, "failed", errorCode, null, null, null,
            null, null, null, null, null, null, null);
        return ExitBlockedOrFailed;
    }

    public static bool IsImportInvocation(IEnumerable<string> args) =>
        args.Any(token => token == "--reading-import" || IsImportPrefixed(token));

    // --- parsing helpers ---------------------------------------------------

    private static bool TryParseBookMap(string value, Dictionary<string, Guid> mappings)
    {
        var equals = value.IndexOf('=');
        if (equals <= 0 || equals >= value.Length - 1)
            return false; // empty source id or empty guid side
        var sourceId = value[..equals];
        var guidText = value[(equals + 1)..];
        // Whitespace around the equals sign is rejected; source ids are
        // otherwise preserved exactly (never trimmed).
        if (char.IsWhiteSpace(sourceId[^1]) ||
            char.IsWhiteSpace(guidText[0]) ||
            char.IsWhiteSpace(guidText[^1]))
            return false;
        if (!Guid.TryParse(guidText, out var guid) || guid == Guid.Empty)
            return false;
        // Duplicate source ids are rejected; the same target guid may be
        // used by several source ids.
        return mappings.TryAdd(sourceId, guid);
    }

    private static bool IsImportPrefixed(string token) =>
        token.StartsWith("--reading-", StringComparison.Ordinal) ||
        token.StartsWith("--commit-reading-", StringComparison.Ordinal) ||
        token.StartsWith("--confirm-reading-", StringComparison.Ordinal);

    // --- sanitized output --------------------------------------------------

    private int WriteResult(TextWriter output, HermesImportCommitResult result)
    {
        var report = result.Report;
        var status = result.Status switch
        {
            HermesImportCommitStatus.Committed => "committed",
            HermesImportCommitStatus.Duplicate => "duplicate",
            HermesImportCommitStatus.Blocked => "blocked",
            HermesImportCommitStatus.Failed => "failed",
            _ => report is { Blocked: true } ? "blocked" : "dry_run",
        };

        // Stable code: the service result's code, else (blocked dry run) the
        // first blocker's stable code.
        var errorCode = result.ErrorCode
            ?? (status == "blocked" && report is { Blockers.Count: > 0 }
                ? report.Blockers[0].Code
                : null);

        WriteEnvelope(
            output,
            status: status,
            errorCode: errorCode,
            receiptId: result.ReceiptId,
            backupId: result.BackupId,
            aggregateFingerprint: report?.AggregateFingerprint,
            files: report?.Files,
            sourceCounts: report?.SourceCounts,
            plannedCounts: report?.PlannedCounts,
            mappings: report?.BookMappings,
            blockers: report?.Blockers,
            warnings: report?.Warnings,
            skips: report?.Skips);

        return status is "dry_run" or "committed" or "duplicate"
            ? ExitOk
            : ExitBlockedOrFailed;
    }

    /// <summary>
    /// Exactly one compact camelCase JSON document. Field order is stable and
    /// mirrors the report's own ordering. Omitted by construction: capture
    /// text, session/assignment notes, titles, authors, raw source paths,
    /// raw timestamps, and issue/skip detail strings.
    /// </summary>
    private static void WriteEnvelope(
        TextWriter output,
        string status,
        string? errorCode,
        Guid? receiptId,
        Guid? backupId,
        string? aggregateFingerprint,
        IReadOnlyList<HermesFileChecksum>? files,
        HermesSourceCounts? sourceCounts,
        HermesPlannedCounts? plannedCounts,
        IReadOnlyList<HermesBookMappingDecision>? mappings,
        IReadOnlyList<HermesImportIssue>? blockers,
        IReadOnlyList<HermesImportIssue>? warnings,
        IReadOnlyList<HermesImportSkip>? skips)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("version", "1");
            writer.WriteString("status", status);
            writer.WriteString("errorCode", errorCode);
            writer.WriteString("receiptId", receiptId?.ToString());
            writer.WriteString("backupId", backupId?.ToString());
            writer.WriteString("aggregateFingerprint", aggregateFingerprint);

            writer.WriteStartArray("files");
            if (files is not null)
            {
                foreach (var file in files)
                {
                    writer.WriteStartObject();
                    writer.WriteString("name", file.Name); // basename only, never a path
                    writer.WriteNumber("length", file.Length);
                    writer.WriteString("sha256", file.Sha256);
                    writer.WriteEndObject();
                }
            }
            writer.WriteEndArray();

            WriteSourceCounts(writer, sourceCounts);
            WritePlannedCounts(writer, plannedCounts);

            writer.WriteStartArray("mappings");
            if (mappings is not null)
            {
                foreach (var mapping in mappings)
                {
                    writer.WriteStartObject();
                    writer.WriteString("sourceBookId", mapping.SourceBookId);
                    writer.WriteString("decision", mapping.Decision);
                    writer.WriteString("bookId", mapping.BookId?.ToString());
                    writer.WriteEndObject();
                }
            }
            writer.WriteEndArray();

            WriteIssues(writer, "blockers", blockers);
            WriteIssues(writer, "warnings", warnings);

            writer.WriteStartArray("skips");
            if (skips is not null)
            {
                foreach (var skip in skips)
                {
                    writer.WriteStartObject();
                    writer.WriteString("code", skip.Code);
                    writer.WriteString("file", skip.File);
                    if (skip.Line is { } line)
                    {
                        writer.WriteNumber("line", line);
                    }
                    else
                    {
                        writer.WriteNull("line");
                    }
                    writer.WriteString("sourceId", skip.SourceId);
                    writer.WriteEndObject();
                }
            }
            writer.WriteEndArray();

            writer.WriteEndObject();
        }

        output.Write(Encoding.UTF8.GetString(stream.ToArray()));
        output.Write('\n');
        output.Flush();
    }

    private static void WriteIssues(Utf8JsonWriter writer, string propertyName, IReadOnlyList<HermesImportIssue>? issues)
    {
        writer.WriteStartArray(propertyName);
        if (issues is not null)
        {
            foreach (var issue in issues)
            {
                writer.WriteStartObject();
                writer.WriteString("code", issue.Code);
                writer.WriteString("file", issue.File);
                if (issue.Line is { } line)
                {
                    writer.WriteNumber("line", line);
                }
                else
                {
                    writer.WriteNull("line");
                }
                writer.WriteEndObject();
            }
        }
        writer.WriteEndArray();
    }

    private static void WriteSourceCounts(Utf8JsonWriter writer, HermesSourceCounts? counts)
    {
        if (counts is null)
        {
            writer.WriteNull("sourceCounts");
            return;
        }
        writer.WriteStartObject("sourceCounts");
        writer.WriteNumber("queueEntries", counts.QueueEntries);
        writer.WriteNumber("queueYamlBooks", counts.QueueYamlBooks);
        writer.WriteBoolean("activeSessionPresent", counts.ActiveSessionPresent);
        writer.WriteBoolean("activeSessionOpen", counts.ActiveSessionOpen);
        writer.WriteNumber("logRecords", counts.LogRecords);
        writer.WriteNumber("sessionRecords", counts.SessionRecords);
        writer.WriteNumber("ratingRecords", counts.RatingRecords);
        writer.WriteNumber("ratingSkippedRecords", counts.RatingSkippedRecords);
        writer.WriteNumber("actualMinutesRecords", counts.ActualMinutesRecords);
        writer.WriteNumber("otherLogRecords", counts.OtherLogRecords);
        writer.WriteNumber("inboxRecords", counts.InboxRecords);
        writer.WriteNumber("captureRecords", counts.CaptureRecords);
        writer.WriteNumber("dispositionRecords", counts.DispositionRecords);
        writer.WriteNumber("mirrorRecords", counts.MirrorRecords);
        writer.WriteNumber("otherInboxRecords", counts.OtherInboxRecords);
        writer.WriteEndObject();
    }

    private static void WritePlannedCounts(Utf8JsonWriter writer, HermesPlannedCounts? counts)
    {
        if (counts is null)
        {
            writer.WriteNull("plannedCounts");
            return;
        }
        writer.WriteStartObject("plannedCounts");
        writer.WriteNumber("programme", counts.Programme);
        writer.WriteNumber("assignments", counts.Assignments);
        writer.WriteNumber("sessionsCompleted", counts.SessionsCompleted);
        writer.WriteNumber("sessionsCancelled", counts.SessionsCancelled);
        writer.WriteNumber("capturesThought", counts.CapturesThought);
        writer.WriteNumber("capturesQuestion", counts.CapturesQuestion);
        writer.WriteNumber("capturesBookmark", counts.CapturesBookmark);
        writer.WriteEndObject();
    }
}
