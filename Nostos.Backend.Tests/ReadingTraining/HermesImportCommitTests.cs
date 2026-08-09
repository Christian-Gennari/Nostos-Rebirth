using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining.Import;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 11B1: transactional Reading import commit tests. Real SQLite schema
// (via EnsureCreated, matching the fixture convention used by the rest of
// the suite) + a fake backup service; the planner runs against temporary
// source directories, never against live Hermes data.
public sealed class HermesImportCommitTests : IDisposable
{
    private static readonly Guid CandideBookId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid MeditationsBookId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly UTF8Encoding Utf8NoBom = new(false);
    private static readonly DateTime CommitNow = new(2026, 8, 9, 12, 0, 0, DateTimeKind.Utc);

    private readonly List<Harness> _harnesses = [];

    public void Dispose()
    {
        foreach (var harness in _harnesses) harness.Dispose();
        _fixtureForShared.Dispose();
    }

    // ------------------------------------------------------------------
    // 1. Dry run: zero writes, zero backup, zero receipts.
    // ------------------------------------------------------------------

    [Fact]
    public async Task PlanAsync_ProducesDryRunWithZeroWritesAndZeroBackup()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);

        var result = await h.Service.PlanAsync(Fixture(), null);

        result.Status.Should().Be(HermesImportCommitStatus.DryRun);
        result.Report.Should().NotBeNull();
        result.Report!.Blocked.Should().BeFalse();
        result.ReceiptId.Should().BeNull();
        result.BackupId.Should().BeNull();
        h.Backup.CreateCalls.Should().Be(0);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));
    }

    // ------------------------------------------------------------------
    // 2. Blocked / invalid reports: fail closed before any backup or write.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_BlockedReport_NoBackupNoWrites()
    {
        var h = await NewHarnessAsync();
        var report = new HermesReadingImportPlanner().Plan(
            Fixture(openSession: true, includeOptional: true),
            [new(CandideBookId, "Candide", "Voltaire")]);
        report.Blocked.Should().BeTrue();

        var result = await h.Service.CommitAsync(report);

        result.Status.Should().Be(HermesImportCommitStatus.Failed);
        result.ErrorCode.Should().Be(HermesImportCommitCodes.Blocked);
        h.Backup.CreateCalls.Should().Be(0);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));
    }

    [Fact]
    public async Task Commit_MissingProgrammeOrInvalidFingerprint_NoBackupNoWrites()
    {
        var h = await NewHarnessAsync();
        var report = new HermesReadingImportPlanner().Plan(
            Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);
        report.Blocked.Should().BeFalse();

        var noProgramme = await h.Service.CommitAsync(report with { Programme = null });
        noProgramme.ErrorCode.Should().Be(HermesImportCommitCodes.BlockedNoProgramme);

        var badFingerprint = await h.Service.CommitAsync(report with { AggregateFingerprint = "not-hex!" });
        badFingerprint.ErrorCode.Should().Be(HermesImportCommitCodes.BlockedInvalidFingerprint);

        var forgedAggregate = await h.Service.CommitAsync(report with { AggregateFingerprint = new string('a', 64) });
        forgedAggregate.ErrorCode.Should().Be(HermesImportCommitCodes.BlockedInvalidFingerprint);

        var tamperedFiles = report.Files.ToArray();
        tamperedFiles[0] = tamperedFiles[0] with { Sha256 = new string('b', 64) };
        var tamperedManifest = await h.Service.CommitAsync(report with { Files = tamperedFiles });
        tamperedManifest.ErrorCode.Should().Be(HermesImportCommitCodes.BlockedInvalidFingerprint);

        var duplicateFiles = report.Files.Append(report.Files[0]).ToArray();
        var duplicateManifest = await h.Service.CommitAsync(report with { Files = duplicateFiles });
        duplicateManifest.ErrorCode.Should().Be(HermesImportCommitCodes.BlockedInvalidFingerprint);

        h.Backup.CreateCalls.Should().Be(0);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));
    }

    // ------------------------------------------------------------------
    // 3. Successful commit: exact programme/assignment/session/capture rows.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_NonEmptyPlan_InsertsExactRowsAndReceipt()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        await h.SeedBook("Meditations", "Marcus Aurelius", MeditationsBookId);

        var dir = FullSourceFixture();
        var report = new HermesReadingImportPlanner().Plan(
            dir, [new(CandideBookId, "Candide", "Voltaire"), new(MeditationsBookId, "Meditations", "Marcus Aurelius")]);
        report.Blocked.Should().BeFalse();
        report.Assignments.Should().ContainSingle();
        report.Sessions.Should().HaveCount(3);
        report.Captures.Should().HaveCount(3);

        var result = await h.Service.CommitAsync(report);

        result.Status.Should().Be(HermesImportCommitStatus.Committed);
        result.ErrorCode.Should().BeNull();
        result.BackupId.Should().Be(h.Backup.Created.Single());
        result.ReceiptId.Should().NotBeNull();
        h.Backup.CreateCalls.Should().Be(1);

        await using var db = h.Factory.CreateDbContext();

        // --- programme ---------------------------------------------------
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.Id.Should().Be(ReadingProgramme.WellKnownId);
        programme.SingletonSlot.Should().Be(ReadingProgramme.SingletonSentinel);
        programme.StateVersion.Should().Be("1");
        programme.TimezoneId.Should().Be("Europe/Stockholm");
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.DeepTargetMinutes.Should().Be(30);
        programme.RecoveryTargetMinutes.Should().Be(20);
        programme.EnduranceEstablishedMinutes.Should().Be(40);
        programme.DeepEstablishedMinutes.Should().Be(30);
        programme.RecoveryEstablishedMinutes.Should().Be(20);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
        programme.DeepConsecutiveIncreases.Should().Be(0);
        programme.DeloadActive.Should().BeTrue(); // source endurance deloaded
        programme.DeloadStartedAt.Should().Be(programme.CreatedAt);
        programme.CreatedAt.Should().Be(new DateTime(2026, 8, 9, 6, 0, 0, DateTimeKind.Utc)); // initialized_at
        programme.UpdatedAt.Should().Be(CommitNow);

        // --- assignment ---------------------------------------------------
        var assignment = await db.ReadingBookAssignments.SingleAsync();
        assignment.Id.Should().Be(report.Assignments.Single().Id); // deterministic id preserved
        assignment.BookId.Should().Be(CandideBookId);
        assignment.Mode.Should().Be(ReadingMode.Endurance);
        assignment.Status.Should().Be(ReadingAssignmentStatus.Active);
        assignment.QueueOrder.Should().Be(0);
        assignment.DefaultSlot.Should().Be((int)ReadingMode.Endurance); // default
        assignment.CreatedAt.Should().Be(new DateTime(2026, 8, 9, 6, 0, 0, DateTimeKind.Utc)); // added_at
        assignment.StartedAt.Should().Be(new DateTime(2026, 8, 9, 6, 0, 0, DateTimeKind.Utc));
        assignment.CompletedAt.Should().BeNull();

        // --- sessions -----------------------------------------------------
        var sessions = await db.ReadingSessions.ToListAsync();
        sessions.Should().HaveCount(3);

        var completed = sessions.Single(s => s.Id == report.Sessions.Single(x => x.SourceSessionId == "session-alpha").Id);
        completed.BookAssignmentId.Should().Be(assignment.Id);
        completed.BookId.Should().Be(CandideBookId);
        completed.Mode.Should().Be(ReadingMode.Endurance);
        completed.Status.Should().Be(ReadingSessionStatus.Completed);
        completed.Constraint.Should().Be(ReadingConstraint.TimeConstrained);
        completed.TargetMinutes.Should().Be(25);
        completed.PlannedTargetMinutes.Should().Be(40);
        completed.PlannedAt.Should().Be(new DateTime(2026, 8, 9, 0, 0, 0, DateTimeKind.Utc)); // parsed date midnight
        completed.StartedAt.Should().Be(new DateTime(2026, 8, 9, 7, 0, 0, DateTimeKind.Utc));
        completed.CompletedAt.Should().Be(new DateTime(2026, 8, 9, 7, 42, 0, DateTimeKind.Utc));
        completed.LastStartedAt.Should().BeNull();
        completed.PausedAt.Should().BeNull();
        completed.RatingRequestedAt.Should().BeNull();
        completed.OpenSlot.Should().BeNull(); // every imported session is closed
        completed.AccumulatedSeconds.Should().Be(2520);
        completed.MeasuredSeconds.Should().Be(2520); // clock_minutes * 60
        completed.ReportedMinutes.Should().Be(42);
        completed.Effort.Should().Be(4);
        completed.Focus.Should().Be(8);
        completed.Rating.Should().BeNull();
        completed.RatingsSkipped.Should().BeFalse();
        completed.NoticeSent.Should().BeFalse();
        completed.CreatedAt.Should().Be(new DateTime(2026, 8, 9, 7, 0, 0, DateTimeKind.Utc));
        completed.UpdatedAt.Should().Be(completed.CreatedAt); // deterministic, not wall clock

        var cancelled = sessions.Single(s => s.Id == report.Sessions.Single(x => x.SourceSessionId == "session-beta").Id);
        cancelled.Status.Should().Be(ReadingSessionStatus.Cancelled);
        cancelled.RatingsSkipped.Should().BeTrue();

        var historyOnly = sessions.Single(s => s.Id == report.Sessions.Single(x => x.SourceSessionId == "session-gamma").Id);
        historyOnly.BookAssignmentId.Should().BeNull(); // historical session survives without assignment
        historyOnly.BookId.Should().Be(MeditationsBookId);
        historyOnly.Status.Should().Be(ReadingSessionStatus.Completed);

        // --- captures ------------------------------------------------------
        var captures = await db.ReadingCaptures.ToListAsync();
        captures.Should().HaveCount(3);
        var question = captures.Single(c => c.ExternalId == "capture-question");
        question.Id.Should().Be(report.Captures.Single(x => x.SourceCaptureId == "capture-question").Id);
        question.Text.Should().Be("  naïve line one\nline   two  "); // verbatim unicode whitespace
        question.Type.Should().Be(ReadingCaptureType.Question);
        question.BookId.Should().Be(CandideBookId);
        question.SessionId.Should().Be(completed.Id); // linked to its planned session
        question.Resolved.Should().BeFalse();
        question.CreatedAt.Should().Be(new DateTime(2026, 8, 9, 8, 30, 0, DateTimeKind.Utc));
        var thought = captures.Single(c => c.ExternalId == "capture-thought");
        thought.Resolved.Should().BeTrue(); // capture_disposition applied
        thought.SessionId.Should().BeNull();
        var bookmark = captures.Single(c => c.ExternalId == "capture-bookmark");
        bookmark.Type.Should().Be(ReadingCaptureType.Bookmark);

        // --- receipt -------------------------------------------------------
        var receipt = await db.ReadingImportReceipts.SingleAsync();
        receipt.Id.Should().Be(result.ReceiptId!.Value);
        receipt.SourceFingerprint.Should().Be(report.AggregateFingerprint);
        receipt.CreatedAt.Should().Be(CommitNow);
        receipt.ResultJson.Should().NotBeNullOrEmpty();
    }

    // ------------------------------------------------------------------
    // 4. Backup is completed before any DB write.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_CreatesBackupBeforeAnyDbWrite()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);

        h.Backup.BeforeCreate = () =>
        {
            // The pre-transaction backup must observe a completely empty
            // reading-training schema: no programme, no domain rows, no receipt.
            using var db = h.Factory.CreateDbContext();
            db.ReadingProgrammes.Any().Should().BeFalse();
            db.ReadingBookAssignments.Any().Should().BeFalse();
            db.ReadingSessions.Any().Should().BeFalse();
            db.ReadingCaptures.Any().Should().BeFalse();
            db.ReadingImportReceipts.Any().Should().BeFalse();
        };

        var result = await h.Service.CommitAsync(report);

        result.Status.Should().Be(HermesImportCommitStatus.Committed);
        h.Backup.CreateCalls.Should().Be(1);
    }

    // ------------------------------------------------------------------
    // 5. Same fingerprint rerun: exact no-op, no second backup.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_SameReportRerun_IsExactNoOpWithNoSecondBackup()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);

        var first = await h.Service.CommitAsync(report);
        first.Status.Should().Be(HermesImportCommitStatus.Committed);

        var second = await h.Service.CommitAsync(report);

        second.Status.Should().Be(HermesImportCommitStatus.Duplicate);
        second.ErrorCode.Should().BeNull();
        second.ReceiptId.Should().Be(first.ReceiptId); // stored immutable receipt
        second.ResultJson.Should().Be(first.ResultJson); // byte-identical stored payload
        second.BackupId.Should().Be(first.BackupId);
        h.Backup.CreateCalls.Should().Be(1);
        (await h.CountsAsync()).Should().Be((1, 1, 0, 0, 1));
    }

    // ------------------------------------------------------------------
    // 6. Concurrent same fingerprint: one backup, one receipt.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_ConcurrentSameFingerprint_OneBackupOneReceipt()
    {
        var databasePath = _fixtureForShared.CreateDatabasePath();
        var h1 = await NewHarnessAsync(databasePath);
        var h2 = await NewHarnessAsync(databasePath);
        await h1.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);

        var results = await Task.WhenAll(
            h1.Service.CommitAsync(report), h2.Service.CommitAsync(report));

        results.Select(r => r.Status).Should().Contain(HermesImportCommitStatus.Committed);
        results.Select(r => r.Status).Should().Contain(HermesImportCommitStatus.Duplicate);
        results.Single(r => r.Status == HermesImportCommitStatus.Committed).ReceiptId
            .Should().Be(results.Single(r => r.Status == HermesImportCommitStatus.Duplicate).ReceiptId);
        (h1.Backup.CreateCalls + h2.Backup.CreateCalls).Should().Be(1); // process-static gate
        (await h1.CountsAsync()).Should().Be((1, 1, 0, 0, 1));
    }

    // ------------------------------------------------------------------
    // 7. Non-clean target or different fingerprint: fail before backup.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_DifferentReceiptOrExistingRows_FailsAsNonCleanTargetBeforeBackup()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);

        // A different fingerprint receipt already exists.
        await using (var db = h.Factory.CreateDbContext())
        {
            db.ReadingImportReceipts.Add(new ReadingImportReceipt
            {
                SourceFingerprint = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                ResultJson = "{}",
            });
            await db.SaveChangesAsync();
        }
        var differentReceipt = await h.Service.CommitAsync(report);
        differentReceipt.Status.Should().Be(HermesImportCommitStatus.Failed);
        differentReceipt.ErrorCode.Should().Be(HermesImportCommitCodes.TargetNotClean);

        // An existing assignment also makes the target non-clean.
        var h2 = await NewHarnessAsync();
        await h2.SeedBook("Candide", "Voltaire", CandideBookId);
        await using (var db = h2.Factory.CreateDbContext())
        {
            db.ReadingBookAssignments.Add(new ReadingBookAssignment
            {
                BookId = CandideBookId,
                Mode = ReadingMode.Endurance,
                Status = ReadingAssignmentStatus.Active,
                QueueOrder = 0,
                CreatedAt = CommitNow,
            });
            await db.SaveChangesAsync();
        }
        var dirtyTarget = await h2.Service.CommitAsync(report);
        dirtyTarget.Status.Should().Be(HermesImportCommitStatus.Failed);
        dirtyTarget.ErrorCode.Should().Be(HermesImportCommitCodes.TargetNotClean);

        h.Backup.CreateCalls.Should().Be(0);
        h2.Backup.CreateCalls.Should().Be(0);
    }

    // ------------------------------------------------------------------
    // 8. Existing singleton programme alone: updated atomically.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_ExistingSingletonProgramme_IsUpdatedAtomically()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var training = new ReadingTrainingService(h.Factory, h.Clock);
        await training.InitializeProgrammeAsync("setup", "init-1");

        var report = new HermesReadingImportPlanner().Plan(
            Fixture(enduranceTarget: 45), [new(CandideBookId, "Candide", "Voltaire")]);
        report.Programme!.EnduranceTargetMinutes.Should().Be(45);

        var result = await h.Service.CommitAsync(report);

        result.Status.Should().Be(HermesImportCommitStatus.Committed);
        await using var db = h.Factory.CreateDbContext();
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(45); // adopted from the plan
        programme.EnduranceEstablishedMinutes.Should().Be(45);
        programme.StateVersion.Should().Be("1");
        programme.CreatedAt.Should().Be(CommitNow); // preserved from the earlier initialization
        programme.UpdatedAt.Should().Be(CommitNow);
        (await db.ReadingImportReceipts.CountAsync()).Should().Be(1);
        h.Backup.CreateCalls.Should().Be(1);
    }

    // ------------------------------------------------------------------
    // 9. Backup failure / throw / missing archive: zero writes.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_BackupFailedOrThrownOrMissingArchive_ZeroWrites()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);

        // Failed status.
        h.Backup.OnCreate = () => new(Guid.NewGuid(), BackupStatus.Failed, 0, DateTime.UtcNow);
        var failed = await h.Service.CommitAsync(report);
        failed.ErrorCode.Should().Be(HermesImportCommitCodes.BackupFailed);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));

        // Thrown exception.
        h.Backup.OnCreate = () => throw new InvalidOperationException("backup exploded");
        var thrown = await h.Service.CommitAsync(report);
        thrown.ErrorCode.Should().Be(HermesImportCommitCodes.BackupFailed);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));

        // Completed status but no local archive file.
        h.Backup.OnCreate = () => new(Guid.NewGuid(), BackupStatus.Completed, 1, DateTime.UtcNow);
        h.Backup.SkipArchiveWrite = true;
        h.Backup.ReturnMissingArchivePath = true;
        var missing = await h.Service.CommitAsync(report);
        missing.ErrorCode.Should().Be(HermesImportCommitCodes.BackupFailed);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));

        // Archive path that does not end with .nostos.
        h.Backup.SkipArchiveWrite = false;
        h.Backup.ReturnMissingArchivePath = false;
        h.Backup.OnCreate = () => new(Guid.NewGuid(), BackupStatus.Completed, 1, DateTime.UtcNow);
        h.Backup.ArchivePathOverride = Path.Combine(Path.GetTempPath(), $"backup-{Guid.NewGuid():N}.zip");
        var wrongSuffix = await h.Service.CommitAsync(report);
        wrongSuffix.ErrorCode.Should().Be(HermesImportCommitCodes.BackupFailed);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));
    }

    // ------------------------------------------------------------------
    // 10. Injected SaveChanges failure: rollback everything, backup remains.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_SaveChangesFailure_RollsBackAllRowsWhileBackupRemains()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);
        h.Factory.Create = () => new FailingSaveContext(h.Factory.Options)
        {
            FailNextSave = true,
        };

        var result = await h.Service.CommitAsync(report);

        result.Status.Should().Be(HermesImportCommitStatus.Failed);
        result.ErrorCode.Should().Be(HermesImportCommitCodes.CommitFailed);
        h.Backup.CreateCalls.Should().Be(1);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0)); // full rollback
        // the pre-transaction backup itself remains on disk
        File.Exists(h.Backup.ArchivePath).Should().BeTrue();
    }

    // ------------------------------------------------------------------
    // 11. Receipt payload: canonical, immutable, leak-free.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Receipt_IsImmutableCanonicalAndExcludesCaptureTextAndPaths()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        await h.SeedBook("Meditations", "Marcus Aurelius", MeditationsBookId);
        var dir = FullSourceFixture();
        var report = new HermesReadingImportPlanner().Plan(
            dir, [new(CandideBookId, "Candide", "Voltaire"), new(MeditationsBookId, "Meditations", "Marcus Aurelius")]);
        report.Blocked.Should().BeFalse();

        var result = await h.Service.CommitAsync(report);
        result.Status.Should().Be(HermesImportCommitStatus.Committed);

        var payload = JsonSerializer.Deserialize<HermesImportReceiptPayload>(
            result.ResultJson!, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        payload.Should().NotBeNull();
        payload!.Version.Should().Be("1");
        payload.AggregateFingerprint.Should().Be(report.AggregateFingerprint);
        payload.BackupId.Should().Be(result.BackupId!.Value);
        payload.CommittedAtUtc.Should().Be(CommitNow);
        payload.Files.Should().HaveCount(6); // config, state, queue, active, log, inbox
        payload.Files.Should().OnlyContain(f => !string.IsNullOrEmpty(f.Name) && f.Sha256.Length == 64 && f.Length >= 0);
        payload.SourceCounts.LogRecords.Should().Be(5); // 3 sessions + rating + rating-skipped
        payload.SourceCounts.InboxRecords.Should().Be(5);
        payload.PlannedCounts.Should().Be(new HermesPlannedCounts(1, 1, 2, 1, 1, 1, 1));
        payload.Committed.Should().Be(new HermesCommittedCounts(1, 3, 3));
        payload.BookMappings.Should().Contain(m => m.SourceBookId == "voltaire-candide" && m.BookId == CandideBookId);
        payload.BookMappings.Single(m => m.SourceBookId == "voltaire-candide").Decision
            .Should().Be(HermesImportCodes.DecisionUniqueAuto);
        payload.Skips.Should().BeEmpty();
        payload.Warnings.Should().Contain(w => w.Code == HermesImportCodes.SessionBookNotInQueue);

        // Exclusions: capture text, session notes, raw source paths.
        result.ResultJson!.Should().NotContain("  naïve line one");
        result.ResultJson.Should().NotContain("private reflection about the session");
        result.ResultJson.Should().NotContain(dir);
    }

    [Fact]
    public async Task Receipt_ExcludesSecretBookMappingFields_OnlySafeMappingKeysRemain()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        await h.SeedBook("Meditations", "Marcus Aurelius", MeditationsBookId);
        var dir = FullSourceFixture();
        var report = new HermesReadingImportPlanner().Plan(
            dir, [new(CandideBookId, "Candide", "Voltaire"), new(MeditationsBookId, "Meditations", "Marcus Aurelius")]);
        report.Blocked.Should().BeFalse();

        // The planner report legitimately carries the secrets; the immutable
        // receipt must not. This is the exact leak surface found in live data.
        report.BookMappings.Should().HaveCount(2);
        report.BookMappings.Should().Contain(m =>
            m.SourceBookId == "voltaire-candide" &&
            m.SourceTitle == "Candide" && m.SourceAuthor == "Voltaire" &&
            m.MatchedTitle == "Candide" && m.MatchedAuthor == "Voltaire");
        report.BookMappings.Single(m => m.SourceBookId == "voltaire-candide").Detail
            .Should().Be("unique normalized title and author match");

        var result = await h.Service.CommitAsync(report);
        result.Status.Should().Be(HermesImportCommitStatus.Committed);
        var json = result.ResultJson!;

        // Secret source/matched titles, authors, and match detail strings.
        json.Should().NotContain("Candide");
        json.Should().NotContain("Voltaire");
        json.Should().NotContain("Meditations");
        json.Should().NotContain("Marcus Aurelius");
        json.Should().NotContain("unique normalized title and author match");
        json.Should().NotContain("\"sourceTitle\"");
        json.Should().NotContain("\"sourceAuthor\"");
        json.Should().NotContain("\"matchedTitle\"");
        json.Should().NotContain("\"matchedAuthor\"");
        // Free-text detail is excluded everywhere in the receipt: no mapping
        // detail, no warning detail, no skip detail.
        json.Should().NotContain("session book has no planned assignment");
        json.Should().NotContain("\"detail\"");

        // Fail-closed: every bookMappings row carries exactly the safe keys
        // and no others, and their values survive the sanitizer.
        using var doc = JsonDocument.Parse(json);
        var mappings = doc.RootElement.GetProperty("bookMappings").EnumerateArray().ToArray();
        mappings.Should().HaveCount(2);
        foreach (var mapping in mappings)
            mapping.EnumerateObject().Select(p => p.Name).OrderBy(n => n)
                .Should().Equal("bookId", "decision", "sourceBookId");
        var candide = mappings.Single(m => m.GetProperty("sourceBookId").GetString() == "voltaire-candide");
        candide.GetProperty("decision").GetString().Should().Be(HermesImportCodes.DecisionUniqueAuto);
        candide.GetProperty("bookId").GetGuid().Should().Be(CandideBookId);

        // The stored payload still round-trips through the sanitized DTOs.
        var payload = JsonSerializer.Deserialize<HermesImportReceiptPayload>(
            json, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        payload!.BookMappings.Should().Contain(m =>
            m.SourceBookId == "voltaire-candide" && m.Decision == HermesImportCodes.DecisionUniqueAuto &&
            m.BookId == CandideBookId);
        payload.Warnings.Should().Contain(w => w.Code == HermesImportCodes.SessionBookNotInQueue);
        payload.Skips.Should().BeEmpty();
    }

    // ------------------------------------------------------------------
    // 12. Cancellation boundaries.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Commit_PreCancelledToken_NoBackupNoWrites()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var result = await h.Service.CommitAsync(report, cts.Token);

        result.Status.Should().Be(HermesImportCommitStatus.Failed);
        result.ErrorCode.Should().Be(HermesImportCommitCodes.Cancelled);
        h.Backup.CreateCalls.Should().Be(0);
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0));
    }

    [Fact]
    public async Task Commit_CancelledAfterBackup_NoWritesButBackupRemains()
    {
        var h = await NewHarnessAsync();
        await h.SeedBook("Candide", "Voltaire", CandideBookId);
        var report = new HermesReadingImportPlanner().Plan(Fixture(), [new(CandideBookId, "Candide", "Voltaire")]);
        using var cts = new CancellationTokenSource();
        h.Backup.OnCreate = () =>
        {
            cts.Cancel(); // cancel the moment the backup completes
            return new TriggerBackupResultDto(Guid.NewGuid(), BackupStatus.Completed, 100, DateTime.UtcNow);
        };

        var result = await h.Service.CommitAsync(report, cts.Token);

        result.Status.Should().Be(HermesImportCommitStatus.Failed);
        result.ErrorCode.Should().Be(HermesImportCommitCodes.Cancelled);
        h.Backup.CreateCalls.Should().Be(1); // the backup itself was taken
        File.Exists(h.Backup.ArchivePath).Should().BeTrue();
        (await h.CountsAsync()).Should().Be((0, 0, 0, 0, 0)); // no partial write survived
    }

    // ------------------------------------------------------------------
    // Harness and fixtures.
    // ------------------------------------------------------------------

    private readonly ReadingTrainingSqliteFixture _fixtureForShared = new();

    private async Task<Harness> NewHarnessAsync(string? sharedDatabasePath = null)
    {
        var harness = new Harness(sharedDatabasePath ?? _fixtureForShared.CreateDatabasePath());
        _harnesses.Add(harness);
        await harness.InitializeAsync();
        return harness;
    }

    private sealed class Harness : IDisposable
    {
        private readonly ReadingTrainingSqliteFixture _fixture = new();

        public ContextFactory Factory { get; }
        public FakeBackupService Backup { get; } = new();
        public MutableReadingClock Clock { get; } = new(CommitNow);
        public HermesReadingImportService Service { get; }

        public Harness(string databasePath)
        {
            var options = new DbContextOptionsBuilder<NostosDbContext>()
                .UseSqlite($"Data Source={databasePath}").Options;
            Factory = new ContextFactory(options);
            Service = new HermesReadingImportService(Factory, Backup, Clock);
        }

        public async Task InitializeAsync()
        {
            await using var db = Factory.CreateDbContext();
            await db.Database.EnsureCreatedAsync();
        }

        public async Task<Guid> SeedBook(string title, string author, Guid id)
        {
            await using var db = Factory.CreateDbContext();
            db.Books.Add(new PhysicalBookModel { Id = id, Title = title, Author = author });
            await db.SaveChangesAsync();
            return id;
        }

        public async Task<(int Programme, int Assignments, int Sessions, int Captures, int Receipts)> CountsAsync()
        {
            await using var db = Factory.CreateDbContext();
            return (
                await db.ReadingProgrammes.CountAsync(),
                await db.ReadingBookAssignments.CountAsync(),
                await db.ReadingSessions.CountAsync(),
                await db.ReadingCaptures.CountAsync(),
                await db.ReadingImportReceipts.CountAsync());
        }

        public void Dispose()
        {
            Factory.Dispose();
            Backup.Dispose();
            _fixture.Dispose();
        }
    }

    private sealed class ContextFactory : IDbContextFactory<NostosDbContext>, IDisposable
    {
        public DbContextOptions<NostosDbContext> Options { get; }
        public Func<NostosDbContext>? Create { get; set; }

        public ContextFactory(DbContextOptions<NostosDbContext> options) => Options = options;

        public NostosDbContext CreateDbContext() => Create?.Invoke() ?? new NostosDbContext(Options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());

        public void Dispose() { }
    }

    private sealed class FailingSaveContext(DbContextOptions<NostosDbContext> options) : NostosDbContext(options)
    {
        public bool FailNextSave { get; set; }

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            if (FailNextSave)
                throw new InvalidOperationException("injected SaveChanges failure");
            return base.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed class MutableReadingClock(DateTime utcNow) : IReadingClock
    {
        public DateTime UtcNow { get; private set; } = utcNow;
    }

    private sealed class FakeBackupService : IBackupService, IDisposable
    {
        private readonly string _archiveDir;
        public int CreateCalls { get; private set; }
        public List<Guid> Created { get; } = [];
        public Func<TriggerBackupResultDto>? OnCreate { get; set; }
        public Action? BeforeCreate { get; set; }
        public bool SkipArchiveWrite { get; set; }
        public bool ReturnMissingArchivePath { get; set; }
        public string? ArchivePathOverride { get; set; }
        public string? ArchivePath { get; private set; }

        public FakeBackupService()
        {
            _archiveDir = Path.Combine(Path.GetTempPath(), "nostos-import-backup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_archiveDir);
        }

        public Task<TriggerBackupResultDto> CreateBackupAsync(CancellationToken ct = default)
        {
            CreateCalls++;
            BeforeCreate?.Invoke();
            var result = OnCreate?.Invoke() ?? new TriggerBackupResultDto(
                Guid.NewGuid(), BackupStatus.Completed, 4096, DateTime.UtcNow);
            if (result.Status == BackupStatus.Completed && !SkipArchiveWrite)
            {
                ArchivePath = ArchivePathOverride ?? Path.Combine(_archiveDir, $"{result.Id:N}.nostos");
                File.WriteAllText(ArchivePath, "fake-archive");
                Created.Add(result.Id);
            }
            return Task.FromResult(result);
        }

        public string? GetLocalArchivePath(Guid id)
        {
            var path = ArchivePathOverride ?? Path.Combine(_archiveDir, $"{id:N}.nostos");
            return ReturnMissingArchivePath || File.Exists(path) ? path : null;
        }

        public void Dispose()
        {
            try { Directory.Delete(_archiveDir, recursive: true); } catch (IOException) { }
            if (ArchivePathOverride is not null)
                try { File.Delete(ArchivePathOverride); } catch (IOException) { }
        }

        public Task<BackupStatusDto> GetStatusAsync() => throw new NotSupportedException();
        public Task<BackupSettingsDto> GetSettingsAsync() => throw new NotSupportedException();
        public Task<BackupSettingsDto> UpdateSettingsAsync(UpdateBackupSettingsDto dto) => throw new NotSupportedException();
        public Task<RestoreResultDto> RestoreBackupAsync(Guid backupId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<BackupHistoryDto>> GetHistoryAsync() => throw new NotSupportedException();
        public Task DeleteBackupRecordAsync(Guid id) => throw new NotSupportedException();
        public Task<List<BackupHistoryDto>> ImportExistingBackupsAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }

    // --- source-file fixtures (planner input, same shape as dry-run tests) --

    private static string Fixture(bool openSession = false, bool includeOptional = false, int enduranceTarget = 40)
    {
        var dir = Path.Combine(Path.GetTempPath(), "nostos-import-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "config.yaml"),
            "schema_version: 1\ntimezone: Europe/Stockholm\ninitial_targets:\n  endurance_minutes: " + enduranceTarget +
            "\n  deep_minutes: 30\n  recovery_minutes: 20\n", Utf8NoBom);
        var active = openSession
            ? ",\"active\":{\"session_id\":\"open-1\",\"status\":\"paused\"}"
            : ",\"active\":null";
        var queue = "[{\"id\":\"voltaire-candide\",\"title\":\"Candide\",\"author\":\"Voltaire\"," +
                    "\"current_mode\":\"endurance\",\"status\":\"reading\"," +
                    "\"added_at\":\"2026-08-09T08:00:00+02:00\",\"completed_at\":null}]";
        var state = "{\"schema_version\":1,\"initialized_at\":\"2026-08-09T08:00:00+02:00\"," +
                    "\"targets\":{\"endurance\":" + enduranceTarget + ",\"deep\":30,\"recovery\":20}," +
                    "\"established_targets\":{\"endurance\":" + enduranceTarget + ",\"deep\":30,\"recovery\":20}," +
                    "\"consecutive_increases\":{\"endurance\":0,\"deep\":0}," +
                    "\"deloaded\":{\"endurance\":false,\"deep\":false}," +
                    "\"deload_week\":{\"endurance\":null,\"deep\":null}," +
                    "\"training_phase\":\"base_building\",\"queue\":" + queue + active + "}";
        File.WriteAllText(Path.Combine(dir, "training-state.json"), state, Utf8NoBom);
        File.WriteAllText(Path.Combine(dir, "reading-queue.yaml"), QueueYaml(), Utf8NoBom);
        if (includeOptional || openSession)
        {
            File.WriteAllText(Path.Combine(dir, "active-session.json"),
                openSession
                    ? "{\"schema_version\":1,\"active\":true,\"session_id\":\"open-1\",\"status\":\"paused\"}"
                    : "{\"schema_version\":1,\"active\":false}", Utf8NoBom);
            File.WriteAllText(Path.Combine(dir, "reading-log.jsonl"), "", Utf8NoBom);
            File.WriteAllText(Path.Combine(dir, "reading-inbox.jsonl"), "", Utf8NoBom);
        }
        return dir;
    }

    /// <summary>Six-file source set with one assignment, three sessions
    /// (completed w/ ratings, cancelled w/ rating-skip, history-only with a
    /// null assignment) and three captures (question, resolved thought,
    /// bookmark).</summary>
    private static string FullSourceFixture()
    {
        var dir = Path.Combine(Path.GetTempPath(), "nostos-import-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "config.yaml"),
            "schema_version: 1\ntimezone: Europe/Stockholm\ninitial_targets:\n  endurance_minutes: 40\n  deep_minutes: 30\n  recovery_minutes: 20\n", Utf8NoBom);
        var queue = "[{\"id\":\"voltaire-candide\",\"title\":\"Candide\",\"author\":\"Voltaire\"," +
                    "\"current_mode\":\"endurance\",\"status\":\"reading\"," +
                    "\"added_at\":\"2026-08-09T08:00:00+02:00\",\"completed_at\":null}]";
        var state = "{\"schema_version\":1,\"initialized_at\":\"2026-08-09T08:00:00+02:00\"," +
                    "\"targets\":{\"endurance\":40,\"deep\":30,\"recovery\":20}," +
                    "\"established_targets\":{\"endurance\":40,\"deep\":30,\"recovery\":20}," +
                    "\"consecutive_increases\":{\"endurance\":0,\"deep\":0}," +
                    "\"deloaded\":{\"endurance\":true,\"deep\":false}," +
                    "\"deload_week\":{\"endurance\":\"w32\",\"deep\":null}," +
                    "\"training_phase\":\"base_building\",\"queue\":" + queue + ",\"active\":null}";
        File.WriteAllText(Path.Combine(dir, "training-state.json"), state, Utf8NoBom);
        File.WriteAllText(Path.Combine(dir, "reading-queue.yaml"), QueueYaml(), Utf8NoBom);
        File.WriteAllText(Path.Combine(dir, "active-session.json"),
            "{\"schema_version\":1,\"active\":false}", Utf8NoBom);

        var log = SessionJson("session-alpha", "completed", notes: "private reflection about the session") + "\n" +
                  SessionJson("session-beta", "cancelled", notes: null) + "\n" +
                  SessionJson("session-gamma", "completed", bookId: "marcus-meditations",
                      bookTitle: "Meditations", author: "Marcus Aurelius", notes: null) + "\n" +
                  "{\"schema_version\":1,\"record_type\":\"rating\",\"session_id\":\"session-alpha\",\"effort\":4,\"focus\":8,\"rated_at\":\"2026-08-09T11:00:00+02:00\"}\n" +
                  "{\"schema_version\":1,\"record_type\":\"rating_skipped\",\"session_id\":\"session-beta\",\"skipped_at\":\"2026-08-09T11:00:00+02:00\"}\n";
        File.WriteAllText(Path.Combine(dir, "reading-log.jsonl"), log, Utf8NoBom);

        const string rawText = "  naïve line one\nline   two  ";
        var inbox =
            "{\"schema_version\":1,\"record_type\":\"capture\",\"id\":\"capture-question\",\"turn_id\":\"turn-9\",\"type\":\"question\",\"text\":" +
            JsonSerializer.Serialize(rawText) +
            ",\"captured_at\":\"2026-08-09T10:30:00+02:00\",\"date\":\"2026-08-09\",\"book_id\":\"voltaire-candide\",\"book_title\":\"Candide\",\"session_id\":\"session-alpha\"}\n" +
            "{\"schema_version\":1,\"record_type\":\"capture\",\"id\":\"capture-thought\",\"type\":\"thought\",\"text\":\"a thought to promote\"," +
            "\"captured_at\":\"2026-08-09T10:31:00+02:00\",\"book_id\":\"voltaire-candide\",\"book_title\":\"Candide\"}\n" +
            "{\"schema_version\":1,\"record_type\":\"capture_disposition\",\"capture_id\":\"capture-thought\",\"disposition\":\"promote\"}\n" +
            "{\"schema_version\":1,\"record_type\":\"capture\",\"id\":\"capture-bookmark\",\"type\":\"bookmark\",\"text\":\"page 42\"," +
            "\"captured_at\":\"2026-08-09T10:32:00+02:00\",\"book_id\":\"voltaire-candide\",\"book_title\":\"Candide\"}\n" +
            "{\"schema_version\":1,\"record_type\":\"mirror_completed\"}\n";
        File.WriteAllText(Path.Combine(dir, "reading-inbox.jsonl"), inbox, Utf8NoBom);
        return dir;
    }

    private static string QueueYaml() =>
        "schema_version: 1\nactive:\n  endurance:\n    - id: voltaire-candide\n      title: Candide\n      author: Voltaire\n      current_mode: endurance\n      status: reading\n  deep: []\nup_next:\n  endurance: []\n  deep: []\ncompleted: []\n";

    private static string SessionJson(
        string id, string status, string? notes = null,
        string bookId = "voltaire-candide", string bookTitle = "Candide", string author = "Voltaire") =>
        "{\"schema_version\":1,\"record_type\":\"session\",\"id\":" + JsonSerializer.Serialize(id) +
        ",\"session_id\":" + JsonSerializer.Serialize(id) +
        ",\"date\":\"2026-08-09\",\"mode\":\"endurance\",\"book_id\":" + JsonSerializer.Serialize(bookId) +
        ",\"book_title\":" + JsonSerializer.Serialize(bookTitle) +
        ",\"author\":" + JsonSerializer.Serialize(author) +
        ",\"planned_target\":40,\"session_target\":25,\"constraint\":\"time_constrained\"," +
        "\"progression_eligible\":false,\"counts_as_failure\":false," +
        "\"started_at\":\"2026-08-09T09:00:00+02:00\",\"done_at\":\"2026-08-09T09:42:00+02:00\"," +
        "\"active_seconds\":2520,\"clock_minutes\":42,\"actual_minutes\":42,\"reported_minutes\":42," +
        "\"completed_target\":true,\"completed_planned_target\":true," +
        (notes is null ? "" : "\"notes\":" + JsonSerializer.Serialize(notes) + ",") +
        "\"status\":" + JsonSerializer.Serialize(status) + "}";
}
