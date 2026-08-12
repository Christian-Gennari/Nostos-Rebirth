using System.Text.Json;
using FluentAssertions;
using Nostos.Backend.Services.ReadingTraining.Import;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// ---------------------------------------------------------------------------
// Task 11B2: safe local one-shot reading import CLI. All tests run the
// command against a fake IHermesReadingImportService and a StringWriter --
// the live importer/persistence is never touched.
// ---------------------------------------------------------------------------

public sealed class HermesImportCommandTests
{
    private static readonly Guid BookA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid BookB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid ReceiptId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid BackupId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    private static readonly HermesSourceCounts SourceCounts = new(
        QueueEntries: 2, QueueYamlBooks: 1, ActiveSessionPresent: false, ActiveSessionOpen: false,
        LogRecords: 1, SessionRecords: 1, RatingRecords: 0, RatingSkippedRecords: 0,
        ActualMinutesRecords: 0, OtherLogRecords: 0, InboxRecords: 1, CaptureRecords: 1,
        DispositionRecords: 0, MirrorRecords: 1, OtherInboxRecords: 0);

    private static readonly HermesPlannedCounts PlannedCounts =
        new(Programme: 1, Assignments: 1, SessionsCompleted: 1, SessionsCancelled: 0,
            CapturesThought: 0, CapturesQuestion: 1, CapturesBookmark: 0);

    // --- parse: import mode engagement -------------------------------------

    [Fact]
    public void NoImportFlag_NormalArgs_NotApplicableAndUntouched()
    {
        var args = new[] { "--urls", "http://localhost:5000", "--environment", "Production" };

        var engaged = HermesReadingImportCommand.TryParse(args, out var parsed, out var errorCode);

        engaged.Should().BeFalse();
        parsed.Should().BeNull();
        errorCode.Should().BeNull();
    }

    [Fact]
    public void CommitFlagWithoutImportFlag_IsImportArgumentError()
    {
        var engaged = HermesReadingImportCommand.TryParse(
            ["--commit-reading-import"], out var parsed, out var errorCode);

        engaged.Should().BeFalse();
        parsed.Should().BeNull();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.CommitConfirmationRequired);
    }

    [Fact]
    public void BothCommitFlagsWithoutSource_AreInvalidSourceArgumentError()
    {
        HermesReadingImportCommand.TryParse(
            ["--commit-reading-import", "--confirm-reading-import"], out var parsed, out var errorCode)
            .Should().BeFalse();
        parsed.Should().BeNull();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidSourceDirectory);
    }

    [Fact]
    public void ImportInvocationDetection_CatchesKnownAndUnknownImportFlagsOnly()
    {
        HermesReadingImportCommand.IsImportInvocation(["--commit-reading-import"]).Should().BeTrue();
        HermesReadingImportCommand.IsImportInvocation(["--reading-typo"]).Should().BeTrue();
        HermesReadingImportCommand.IsImportInvocation(["--urls", "http://localhost"]).Should().BeFalse();
    }

    // --- parse: source directory -------------------------------------------

    [Fact]
    public void ReadingImportFlag_DryRunIsDefault_NoMappings()
    {
        var dir = NewTempDir();

        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir], out var parsed, out var errorCode);

        engaged.Should().BeTrue();
        errorCode.Should().BeNull();
        parsed!.SourceDirectory.Should().Be(dir);
        parsed.Commit.Should().BeFalse();
        parsed.BookMappings.Should().BeNull();
    }

    [Fact]
    public void ReadingImportFlag_WithBothCommitFlags_CommitIsTrue()
    {
        var dir = NewTempDir();

        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--commit-reading-import", "--confirm-reading-import"],
            out var parsed, out var errorCode);

        engaged.Should().BeTrue();
        parsed!.Commit.Should().BeTrue();
    }

    [Fact]
    public void ReadingImport_RelativeDirectory_ArgumentError()
    {
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", "relative/dir"], out var parsed, out var errorCode);

        engaged.Should().BeFalse();
        parsed.Should().BeNull();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidSourceDirectory);
    }

    [Fact]
    public void ReadingImport_NonexistentDirectory_ArgumentError()
    {
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", "/definitely/not/a/real/dir-9f31"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidSourceDirectory);
    }

    [Fact]
    public void ReadingImport_MissingValue_ArgumentError()
    {
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidSourceDirectory);
    }

    [Fact]
    public void ReadingImport_RepeatedFlag_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-import", dir], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.DuplicateFlag);
    }

    // --- parse: commit confirmation ----------------------------------------

    [Fact]
    public void CommitWithoutConfirm_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--commit-reading-import"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.CommitConfirmationRequired);
    }

    [Fact]
    public void ConfirmWithoutCommit_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--confirm-reading-import"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.CommitConfirmationRequired);
    }

    [Fact]
    public void RepeatedCommitFlag_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--commit-reading-import", "--commit-reading-import",
             "--confirm-reading-import"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.DuplicateFlag);
    }

    [Fact]
    public void RepeatedConfirmFlag_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--confirm-reading-import", "--confirm-reading-import",
             "--commit-reading-import"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.DuplicateFlag);
    }

    // --- parse: unknown flags ----------------------------------------------

    [Fact]
    public void UnknownImportPrefixedFlag_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-frobnicate"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.UnknownFlag);
    }

    [Fact]
    public void UnknownImportPrefixedFlag_WithoutValue_StillArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-mapping-typo", "x=1"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.UnknownFlag);
    }

    [Fact]
    public void NonImportFlags_InsideImportMode_AreIgnored()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--urls", "http://localhost:9999"], out var parsed, out var errorCode);

        engaged.Should().BeTrue();
        errorCode.Should().BeNull();
        parsed!.SourceDirectory.Should().Be(dir);
    }

    // --- parse: book maps ---------------------------------------------------

    [Fact]
    public void BookMaps_Valid_CollectedExactAndPreserved()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir,
             "--reading-book-map", $"candide={BookA}",
             "--reading-book-map", $"book-α 2={BookB}"],
            out var parsed, out var errorCode);

        engaged.Should().BeTrue();
        errorCode.Should().BeNull();
        parsed!.BookMappings.Should().HaveCount(2);
        parsed.BookMappings!["candide"].Should().Be(BookA);
        parsed.BookMappings["book-α 2"].Should().Be(BookB); // exact, no trim
    }

    [Fact]
    public void BookMap_EmptySourceId_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-map", $"={BookA}"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Fact]
    public void BookMap_EmptyGuid_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-map", "candide="], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Fact]
    public void BookMap_InvalidGuid_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-map", "candide=not-a-guid"],
            out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Fact]
    public void BookMap_AllZeroGuid_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-map", "candide=00000000-0000-0000-0000-000000000000"],
            out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Fact]
    public void BookMap_DuplicateSourceId_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir,
             "--reading-book-map", $"candide={BookA}",
             "--reading-book-map", $"candide={BookB}"],
            out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Theory]
    [InlineData("candide =11111111-1111-1111-1111-111111111111")]
    [InlineData("candide= 11111111-1111-1111-1111-111111111111")]
    [InlineData("candide=11111111-1111-1111-1111-111111111111 ")]
    public void BookMap_WhitespaceAroundEquals_ArgumentError(string value)
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-map", value], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Fact]
    public void BookMap_MissingValue_ArgumentError()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-book-map"], out var _, out var errorCode);

        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.InvalidBookMap);
    }

    [Fact]
    public void BookMap_SameTargetGuidForTwoSourceIds_Accepted()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir,
             "--reading-book-map", $"a={BookA}",
             "--reading-book-map", $"b={BookA}"],
            out var parsed, out var errorCode);

        engaged.Should().BeTrue();
        parsed!.BookMappings.Should().HaveCount(2);
    }

    // --- run: dry run -------------------------------------------------------

    [Fact]
    public async Task DryRun_Unblocked_CallsPlanExactlyOnce_ExitZero()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService { PlanResult = UnblockedResult() };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        var exitCode = await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, null, Commit: false), output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitOk);
        fake.PlanCalls.Should().Be(1);
        fake.PlanAndCommitCalls.Should().Be(0);
        fake.LastSourceDirectory.Should().Be(dir);

        using var doc = JsonDocument.Parse(output.ToString());
        var root = doc.RootElement;
        root.GetProperty("version").GetString().Should().Be("1");
        root.GetProperty("status").GetString().Should().Be("dry_run");
        root.TryGetProperty("errorCode", out var errorCode).Should().BeTrue();
        errorCode.ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("aggregateFingerprint").GetString().Should().MatchRegex("^[0-9a-f]{64}$");
        root.GetProperty("files")[0].GetProperty("name").GetString().Should().Be("reading-log.jsonl");
        root.GetProperty("files")[0].GetProperty("length").GetInt64().Should().Be(123);
        root.GetProperty("files")[0].GetProperty("sha256").GetString().Should().MatchRegex("^[0-9a-f]{64}$");
        root.GetProperty("sourceCounts").GetProperty("logRecords").GetInt32().Should().Be(1);
        root.GetProperty("plannedCounts").GetProperty("assignments").GetInt32().Should().Be(1);
        root.GetProperty("mappings")[0].GetProperty("sourceBookId").GetString().Should().Be("candide");
        root.GetProperty("mappings")[0].GetProperty("decision").GetString().Should().Be("unique_auto");
        root.GetProperty("mappings")[0].GetProperty("bookId").GetString().Should().Be(BookA.ToString());
        root.GetProperty("mappings")[0].TryGetProperty("detail", out _).Should().BeFalse();
        root.GetProperty("blockers").GetArrayLength().Should().Be(0);
        root.GetProperty("warnings").GetArrayLength().Should().Be(1);
        root.GetProperty("skips").GetArrayLength().Should().Be(1);
    }

    [Fact]
    public async Task DryRun_PassesDirectoryAndMappingsToService()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService { PlanResult = UnblockedResult() };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();
        var mappings = new Dictionary<string, Guid> { ["candide"] = BookA };

        await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, mappings, Commit: false), output);

        fake.LastSourceDirectory.Should().Be(dir);
        fake.LastMappings.Should().BeEquivalentTo(mappings);
    }

    [Fact]
    public async Task DryRun_Blocked_ExitTwo_StableErrorCode()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService
        {
            PlanResult = new HermesImportCommitResult(
                HermesImportCommitStatus.DryRun,
                MakeReport(blocked: true,
                    blockers: [new HermesImportIssue("directory_not_found", "missing", null, null)]),
                null, null, null, null),
        };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        var exitCode = await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, null, Commit: false), output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitBlockedOrFailed);
        using var doc = JsonDocument.Parse(output.ToString());
        doc.RootElement.GetProperty("status").GetString().Should().Be("blocked");
        doc.RootElement.GetProperty("errorCode").GetString().Should().Be("directory_not_found");
        doc.RootElement.GetProperty("blockers")[0].GetProperty("code").GetString()
            .Should().Be("directory_not_found");
    }

    // --- run: commit --------------------------------------------------------

    [Fact]
    public async Task Commit_CallsPlanAndCommitExactlyOnce_ExitZero()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService
        {
            CommitResult = new HermesImportCommitResult(
                HermesImportCommitStatus.Committed, UnblockedReport(), ReceiptId, BackupId, null, null),
        };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        var exitCode = await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, null, Commit: true), output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitOk);
        fake.PlanCalls.Should().Be(0);
        fake.PlanAndCommitCalls.Should().Be(1);
        fake.LastSourceDirectory.Should().Be(dir);

        using var doc = JsonDocument.Parse(output.ToString());
        doc.RootElement.GetProperty("status").GetString().Should().Be("committed");
        doc.RootElement.GetProperty("receiptId").GetString().Should().Be(ReceiptId.ToString());
        doc.RootElement.GetProperty("backupId").GetString().Should().Be(BackupId.ToString());
    }

    [Fact]
    public async Task Commit_Duplicate_ExitZero()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService
        {
            CommitResult = new HermesImportCommitResult(
                HermesImportCommitStatus.Duplicate, UnblockedReport(), ReceiptId, BackupId, null, null),
        };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        var exitCode = await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, null, Commit: true), output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitOk);
        using var doc = JsonDocument.Parse(output.ToString());
        doc.RootElement.GetProperty("status").GetString().Should().Be("duplicate");
        doc.RootElement.GetProperty("receiptId").GetString().Should().Be(ReceiptId.ToString());
    }

    [Fact]
    public async Task Commit_Failed_ExitTwo_StableErrorCode()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService
        {
            CommitResult = new HermesImportCommitResult(
                HermesImportCommitStatus.Failed, UnblockedReport(), null, null, null,
                HermesImportCommitCodes.BackupFailed),
        };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        var exitCode = await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, null, Commit: true), output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitBlockedOrFailed);
        using var doc = JsonDocument.Parse(output.ToString());
        doc.RootElement.GetProperty("status").GetString().Should().Be("failed");
        doc.RootElement.GetProperty("errorCode").GetString().Should().Be("backup_failed");
    }

    [Fact]
    public async Task ThrowingService_ExitTwo_NoExceptionMessageLeaks()
    {
        var dir = NewTempDir();
        var fake = new FakeImportService
        {
            PlanException = new InvalidOperationException("SENTINEL-EXCEPTION-TEXT-9f2c"),
        };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        var exitCode = await command.RunAsync(
            new HermesReadingImportCommand.Arguments(dir, null, Commit: false), output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitBlockedOrFailed);
        output.ToString().Should().NotContain("SENTINEL-EXCEPTION-TEXT-9f2c");
        using var doc = JsonDocument.Parse(output.ToString());
        doc.RootElement.GetProperty("status").GetString().Should().Be("failed");
        doc.RootElement.GetProperty("errorCode").GetString()
            .Should().Be(HermesReadingImportCommand.ErrorCodes.UnexpectedError);
    }

    [Fact]
    public void StartupFailure_EmitsStableSanitizedEnvelopeAndExitTwo()
    {
        using var output = new StringWriter();

        var exitCode = HermesReadingImportCommand.WriteStartupError(
            HermesReadingImportCommand.ErrorCodes.DatabaseMigrationFailed, output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitBlockedOrFailed);
        using var doc = JsonDocument.Parse(output.ToString());
        doc.RootElement.GetProperty("status").GetString().Should().Be("failed");
        doc.RootElement.GetProperty("errorCode").GetString().Should().Be("database_migration_failed");
        output.ToString().ToLowerInvariant().Should().NotContain("exception");
    }

    // --- run: sanitized output ----------------------------------------------

    [Fact]
    public async Task Output_NeverLeaksCaptureTextNotesTitlesAuthorsOrPaths()
    {
        const string dirName = "nostos-leak-dir-7f3a";
        var dir = Path.Combine(Path.GetTempPath(), dirName);
        Directory.CreateDirectory(dir);
        try
        {
            var report = LeakReport(dirName);
            var fake = new FakeImportService
            {
                PlanResult = new HermesImportCommitResult(
                    HermesImportCommitStatus.DryRun, report, null, null, null, null),
            };
            var command = new HermesReadingImportCommand(fake);
            using var output = new StringWriter();

            await command.RunAsync(
                new HermesReadingImportCommand.Arguments(dir, null, Commit: false), output);

            var text = output.ToString();
            // Exact sentinel values planted in every sensitive slot.
            text.Should().NotContain("SENTINEL-CAPTURE-TEXT");
            text.Should().NotContain("SENTINEL-SESSION-NOTES");
            text.Should().NotContain("SENTINEL-THOUGHT-NOTE");
            text.Should().NotContain("SENTINEL-TITLE");
            text.Should().NotContain("SENTINEL-AUTHOR");
            text.Should().NotContain("SENTINEL-ISSUE-DETAIL");
            text.Should().NotContain("SENTINEL-SKIP-DETAIL");
            text.Should().NotContain("SENTINEL-RAW-TIMESTAMP");
            text.Should().NotContain(dirName); // no directory/path

            // The document is exactly one JSON document and no sensitive key
            // exists anywhere in it.
            using var doc = JsonDocument.Parse(text);
            var names = new HashSet<string>(StringComparer.Ordinal);
            CollectPropertyNames(doc.RootElement, names);
            names.Should().NotContain("text");
            names.Should().NotContain("notes");
            names.Should().NotContain("title");
            names.Should().NotContain("author");
            names.Should().NotContain("capturedAt");
            names.Should().NotContain("startedAtRaw");
            names.Should().NotContain("thoughtNote");
            names.Should().NotContain("committedAtUtc");
            names.Should().NotContain("resultJson");
            names.Should().NotContain("path");
            names.Should().NotContain("detail");
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public async Task BlockedDryRun_BlockerAndSkipCarryOnlyCodeFileLineSourceId()
    {
        var report = MakeReport(
            blocked: true,
            blockers: [new HermesImportIssue("file_missing", "SENTINEL-BLOCKER-DETAIL", "config.yaml", 7)],
            warnings: [new HermesImportIssue("unparseable_timestamp", "SENTINEL-WARN-DETAIL", "reading-log.jsonl", 3)],
            skips: [new HermesImportSkip("duplicate_session_id", "SENTINEL-SKIP-DETAIL", "reading-log.jsonl", 9, "session-1")]);
        var fake = new FakeImportService
        {
            PlanResult = new HermesImportCommitResult(
                HermesImportCommitStatus.DryRun, report, null, null, null, null),
        };
        var command = new HermesReadingImportCommand(fake);
        using var output = new StringWriter();

        await command.RunAsync(
            new HermesReadingImportCommand.Arguments(NewTempDir(), null, Commit: false), output);

        var text = output.ToString();
        text.Should().NotContain("SENTINEL-BLOCKER-DETAIL");
        text.Should().NotContain("SENTINEL-WARN-DETAIL");
        text.Should().NotContain("SENTINEL-SKIP-DETAIL");

        using var doc = JsonDocument.Parse(text);
        var blocker = doc.RootElement.GetProperty("blockers")[0];
        blocker.GetProperty("code").GetString().Should().Be("file_missing");
        blocker.GetProperty("file").GetString().Should().Be("config.yaml");
        blocker.GetProperty("line").GetInt64().Should().Be(7);
        blocker.TryGetProperty("detail", out _).Should().BeFalse();
        var skip = doc.RootElement.GetProperty("skips")[0];
        skip.GetProperty("code").GetString().Should().Be("duplicate_session_id");
        skip.GetProperty("file").GetString().Should().Be("reading-log.jsonl");
        skip.GetProperty("line").GetInt64().Should().Be(9);
        skip.GetProperty("sourceId").GetString().Should().Be("session-1");
        skip.TryGetProperty("detail", out _).Should().BeFalse();
    }

    // --- argument error envelope --------------------------------------------

    [Fact]
    public void ArgumentError_StableEnvelope_NoRawValues_Exit64()
    {
        var dir = NewTempDir();
        var engaged = HermesReadingImportCommand.TryParse(
            ["--reading-import", dir, "--reading-evil-flag"], out var _, out var errorCode);
        engaged.Should().BeFalse();
        errorCode.Should().Be(HermesReadingImportCommand.ErrorCodes.UnknownFlag);

        using var output = new StringWriter();
        var exitCode = HermesReadingImportCommand.WriteArgumentError(errorCode!, output);

        exitCode.Should().Be(HermesReadingImportCommand.ExitArgumentError);
        var text = output.ToString();
        text.Should().NotContain("reading-evil-flag");
        text.Should().NotContain(dir);

        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        root.GetProperty("version").GetString().Should().Be("1");
        root.GetProperty("status").GetString().Should().Be("argument_error");
        root.GetProperty("errorCode").GetString().Should().Be("unknown_flag");
        root.GetProperty("receiptId").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("backupId").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("aggregateFingerprint").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("sourceCounts").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("plannedCounts").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("files").GetArrayLength().Should().Be(0);
        root.GetProperty("mappings").GetArrayLength().Should().Be(0);
        root.GetProperty("blockers").GetArrayLength().Should().Be(0);
        root.GetProperty("warnings").GetArrayLength().Should().Be(0);
        root.GetProperty("skips").GetArrayLength().Should().Be(0);
    }

    // --- helpers ------------------------------------------------------------

    private sealed class FakeImportService : IHermesReadingImportService
    {
        public HermesImportCommitResult PlanResult { get; init; } = null!;
        public HermesImportCommitResult CommitResult { get; init; } = null!;
        public Exception? PlanException { get; init; }
        public Exception? CommitException { get; init; }
        public int PlanCalls { get; private set; }
        public int PlanAndCommitCalls { get; private set; }
        public string? LastSourceDirectory { get; private set; }
        public IReadOnlyDictionary<string, Guid>? LastMappings { get; private set; }

        public Task<HermesImportCommitResult> PlanAsync(
            string sourceDirectory, IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
            CancellationToken ct = default)
        {
            PlanCalls++;
            LastSourceDirectory = sourceDirectory;
            LastMappings = explicitBookMappings;
            if (PlanException is not null)
            {
                throw PlanException;
            }
            return Task.FromResult(PlanResult);
        }

        public Task<HermesImportCommitResult> CommitAsync(
            HermesImportDryRunReport report, CancellationToken ct = default)
            => throw new NotSupportedException("the command must never call CommitAsync directly");

        public Task<HermesImportCommitResult> PlanAndCommitAsync(
            string sourceDirectory, IReadOnlyDictionary<string, Guid>? explicitBookMappings = null,
            CancellationToken ct = default)
        {
            PlanAndCommitCalls++;
            LastSourceDirectory = sourceDirectory;
            LastMappings = explicitBookMappings;
            if (CommitException is not null)
            {
                throw CommitException;
            }
            return Task.FromResult(CommitResult);
        }
    }

    private static HermesImportCommitResult UnblockedResult() =>
        new(HermesImportCommitStatus.DryRun, UnblockedReport(), null, null, null, null);

    private static HermesImportDryRunReport UnblockedReport() => MakeReport();

    private static HermesImportDryRunReport MakeReport(
        bool blocked = false,
        IReadOnlyList<HermesImportIssue>? blockers = null,
        IReadOnlyList<HermesImportIssue>? warnings = null,
        IReadOnlyList<HermesImportSkip>? skips = null,
        IReadOnlyList<HermesBookMappingDecision>? mappings = null)
    {
        blockers ??= blocked
            ? [new HermesImportIssue("book_not_found", "no match", "reading-queue.yaml", 1)]
            : [];
        warnings ??= [new HermesImportIssue("active_mirror_mismatch", "mirror differs", "active-session.json", null)];
        skips ??= [new HermesImportSkip("unrecognized_record_type", "skipped", "reading-log.jsonl", 2, "rec-9")];
        mappings ??= [new HermesBookMappingDecision("candide", "Candide", "Voltaire",
            "unique_auto", BookA, "Candide", "Voltaire", "unique normalized title and author match")];
        return new HermesImportDryRunReport(
            Blocked: blocked,
            Files: [new HermesFileChecksum("reading-log.jsonl", 123, new string('a', 64))],
            AggregateFingerprint: new string('b', 64),
            SourceCounts: SourceCounts,
            SourceLines: [new HermesFileLines("reading-log.jsonl", 1)],
            PlannedCounts: PlannedCounts,
            Programme: null,
            Assignments: [],
            Sessions: [],
            Captures: [],
            BookMappings: mappings,
            Blockers: blockers,
            Warnings: warnings,
            Skips: skips);
    }

    private static HermesImportDryRunReport LeakReport(string dirName)
    {
        var assignment = new HermesPlannedAssignment(
            Id: Guid.NewGuid(), BookId: BookA, SourceBookId: "candide",
            Title: "SENTINEL-TITLE", Author: "SENTINEL-AUTHOR",
            Mode: ReadingMode.Endurance, Status: ReadingAssignmentStatus.Active,
            QueueOrder: 1, IsDefault: true,
            ThoughtNote: "SENTINEL-THOUGHT-NOTE", SourceRecord: "SENTINEL-SKIP-DETAIL",
            EditionId: null, AddedAtRaw: null, CompletedAtRaw: null, StartedAt: null, CompletedAt: null);
        var session = new HermesPlannedSession(
            Id: Guid.NewGuid(), SourceSessionId: "session-1", Mode: ReadingMode.Endurance,
            Status: ReadingSessionStatus.Completed, Constraint: ReadingConstraint.TimeConstrained,
            TargetMinutes: 30, PlannedTargetMinutes: 30, ProgressionEligible: true, CountsAsFailure: false,
            PlannedAt: null, StartedAt: null, CompletedAt: null,
            StartedAtRaw: "SENTINEL-RAW-TIMESTAMP", DoneAtRaw: null, DateRaw: "2026-08-09",
            AccumulatedSeconds: 0, ClockMinutes: 0, ActualMinutes: 0, ReportedMinutes: null,
            Effort: null, Focus: null, RatingsSkipped: false, CompletedTarget: true,
            CompletedPlannedTarget: true, Notes: "SENTINEL-SESSION-NOTES",
            SourceBookId: "candide", BookId: BookA, BookAssignmentId: null, SourceLine: 4);
        var capture = new HermesPlannedCapture(
            Id: Guid.NewGuid(), SourceCaptureId: "capture-1", Type: ReadingCaptureType.Question,
            Text: "SENTINEL-CAPTURE-TEXT", CapturedAt: null, CapturedAtRaw: "", DateRaw: "2026-08-09",
            BookId: BookA, SourceBookId: "candide", SourceSessionId: "session-1",
            PlannedSessionId: null, SourceTurnId: "turn-1", Resolved: false, LastDisposition: null,
            SourceLine: 5);
        return new HermesImportDryRunReport(
            Blocked: false,
            Files: [new HermesFileChecksum("reading-log.jsonl", 123, new string('a', 64))],
            AggregateFingerprint: new string('b', 64),
            SourceCounts: SourceCounts,
            SourceLines: [new HermesFileLines("reading-log.jsonl", 5)],
            PlannedCounts: PlannedCounts,
            Programme: null,
            Assignments: [assignment],
            Sessions: [session],
            Captures: [capture],
            BookMappings: [new HermesBookMappingDecision("candide", "SENTINEL-TITLE", "SENTINEL-AUTHOR",
                "unique_auto", BookA, "SENTINEL-TITLE", "SENTINEL-AUTHOR", "unique normalized title and author match")],
            Blockers: [new HermesImportIssue("blocked", "SENTINEL-ISSUE-DETAIL", "reading-queue.yaml", 1)],
            Warnings: [new HermesImportIssue("active_mirror_mismatch", "SENTINEL-ISSUE-DETAIL", "active-session.json", 1)],
            Skips: [new HermesImportSkip("unrecognized_record_type", "SENTINEL-SKIP-DETAIL",
                "reading-log.jsonl", 2, "rec-9")]);
    }

    private static void CollectPropertyNames(JsonElement element, HashSet<string> names)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    names.Add(property.Name);
                    CollectPropertyNames(property.Value, names);
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    CollectPropertyNames(item, names);
                }
                break;
        }
    }

    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"nostos-import-cli-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        return dir;
    }
}
