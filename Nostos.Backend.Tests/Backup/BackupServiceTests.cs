using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Backup;

// Real backup -> restore integration tests (Task 3): the full BackupService
// runs against a real temporary SQLite database and a real content root, so
// the .nostos archive, the metadata/reading-training.json whitelist, the
// vacuumed database and the file-copy restore path are all exercised for
// real. IncludeBookFiles=false keeps the tests free of book file payloads.
public sealed class BackupServiceTests
{
    private const string DistinctiveCaptureText = "Distinctive secret capture text, unique: quixotic-42";

    private static readonly JsonSerializerOptions TestJsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    [Fact]
    public async Task BackupArchive_IncludesWhitelistedReadingTrainingMetadata_WithExactValuesAndNoForbiddenContent()
    {
        using var h = BackupHarness.Create();
        await SeedFullTrainingScenarioAsync(h);

        int assignments, sessions, captures, reviews, decisions, notifications, commandReceipts, importReceipts, openSessions;
        string stateVersion, timezone, phase;
        int enduranceTarget, deepTarget, recoveryTarget;
        await using (var db = h.NewDbContext())
        {
            assignments = await db.ReadingBookAssignments.CountAsync();
            sessions = await db.ReadingSessions.CountAsync();
            captures = await db.ReadingCaptures.CountAsync();
            reviews = await db.ReadingWeeklyReviews.CountAsync();
            decisions = await db.ReadingModeDecisions.CountAsync();
            notifications = await db.ReadingNotifications.CountAsync();
            commandReceipts = await db.ReadingCommandReceipts.CountAsync();
            importReceipts = await db.ReadingImportReceipts.CountAsync();
            openSessions = await db.ReadingSessions.CountAsync(s => s.OpenSlot != null);
            var programme = await db.ReadingProgrammes.AsNoTracking().SingleAsync();
            stateVersion = programme.StateVersion;
            timezone = programme.TimezoneId;
            phase = programme.DeloadActive ? "deload" : "training";
            enduranceTarget = programme.EnduranceTargetMinutes;
            deepTarget = programme.DeepTargetMinutes;
            recoveryTarget = programme.RecoveryTargetMinutes;
        }

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);

        var archivePath = h.Service.GetLocalArchivePath(created.Id);
        archivePath.Should().NotBeNull();

        using var zip = ZipFile.OpenRead(archivePath!);
        var entry = zip.GetEntry("metadata/reading-training.json");
        entry.Should().NotBeNull("the .nostos archive must include metadata/reading-training.json");
        zip.GetEntry("database/nostos.db").Should().NotBeNull();
        zip.GetEntry("manifest.json").Should().NotBeNull();
        zip.Entries.Should().NotContain(e => e.FullName.StartsWith("books/"), "IncludeBookFiles=false must not copy book files");

        string json;
        using (var reader = new StreamReader(entry!.Open()))
            json = await reader.ReadToEndAsync();

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.ValueKind.Should().Be(JsonValueKind.Object);

        // Exact whitelist of top-level keys: nothing else may be present.
        root.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(new[]
        {
            "schemaVersion", "programme", "assignments", "sessions", "captures",
            "reviews", "decisions", "notifications", "commandReceipts",
            "importReceipts", "openSessionCount",
        });

        root.GetProperty("schemaVersion").GetInt32().Should().Be(1);

        var programmeEl = root.GetProperty("programme");
        programmeEl.EnumerateObject().Select(p => p.Name)
            .Should().BeEquivalentTo(new[] { "stateVersion", "timezone", "phase", "targets" });
        programmeEl.GetProperty("stateVersion").GetString().Should().Be(stateVersion);
        programmeEl.GetProperty("timezone").GetString().Should().Be(timezone);
        programmeEl.GetProperty("phase").GetString().Should().Be(phase);

        var targetsEl = programmeEl.GetProperty("targets");
        targetsEl.EnumerateObject().Select(p => p.Name)
            .Should().BeEquivalentTo(new[] { "enduranceTargetMinutes", "deepTargetMinutes", "recoveryTargetMinutes" });
        targetsEl.GetProperty("enduranceTargetMinutes").GetInt32().Should().Be(enduranceTarget);
        targetsEl.GetProperty("deepTargetMinutes").GetInt32().Should().Be(deepTarget);
        targetsEl.GetProperty("recoveryTargetMinutes").GetInt32().Should().Be(recoveryTarget);

        root.GetProperty("assignments").GetInt32().Should().Be(assignments);
        root.GetProperty("sessions").GetInt32().Should().Be(sessions);
        root.GetProperty("captures").GetInt32().Should().Be(captures);
        root.GetProperty("reviews").GetInt32().Should().Be(reviews);
        root.GetProperty("decisions").GetInt32().Should().Be(decisions);
        root.GetProperty("notifications").GetInt32().Should().Be(notifications);
        root.GetProperty("commandReceipts").GetInt32().Should().Be(commandReceipts);
        root.GetProperty("importReceipts").GetInt32().Should().Be(importReceipts);
        root.GetProperty("openSessionCount").GetInt32().Should().Be(openSessions);

        // Whitelist is summary-only: titles, authors, capture text, receipt
        // payloads/results, paths and raw timestamps must not appear.
        foreach (var forbidden in new[]
        {
            "Candide", "Voltaire", "Nicomachean", "Aristotle", // titles / authors
            DistinctiveCaptureText,                             // capture text
            "import-fp-1", "\"source\"", "\"imported\"",        // import receipt fingerprint/ResultJson
            "bk-key-",                                          // command receipt idempotency keys/replies
            "responseJson", "resultJson", "payloadJson", "text", "title", "author",
            "2026-08-0",                                        // raw session/programme timestamps
            "Storage", "backups", "nostos.db",                  // file paths
        })
        {
            json.Should().NotContain(forbidden, $"reading-training.json must not leak {forbidden}");
        }
    }

    [Fact]
    public async Task RestoreBackup_RoundTripsEveryReadingTrainingRow_WithIntegrityAndNoForeignKeyViolations()
    {
        using var h = BackupHarness.Create();
        await SeedFullTrainingScenarioAsync(h);

        var original = await SnapshotStateAsync(h.NewDbContext());

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);
        var backupId = created.Id;

        // Destructively mutate the live database: wipe every Reading Training
        // row and the books, in FK-safe order (children before parents).
        await using (var db = h.NewDbContext())
        {
            db.ReadingCaptures.RemoveRange(db.ReadingCaptures);
            db.ReadingNotifications.RemoveRange(db.ReadingNotifications);
            db.ReadingImportReceipts.RemoveRange(db.ReadingImportReceipts);
            db.ReadingCommandReceipts.RemoveRange(db.ReadingCommandReceipts);
            db.ReadingModeDecisions.RemoveRange(db.ReadingModeDecisions);
            db.ReadingWeeklyReviews.RemoveRange(db.ReadingWeeklyReviews);
            db.ReadingSessions.RemoveRange(db.ReadingSessions);
            db.ReadingBookAssignments.RemoveRange(db.ReadingBookAssignments);
            db.ReadingProgrammes.RemoveRange(db.ReadingProgrammes);
            db.Books.RemoveRange(db.Books);
            await db.SaveChangesAsync();

            (await db.ReadingSessions.CountAsync()).Should().Be(0);
            (await db.ReadingCaptures.CountAsync()).Should().Be(0);
            (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(0);
            (await db.ReadingProgrammes.CountAsync()).Should().Be(0);
        }

        var restored = await h.Service.RestoreBackupAsync(backupId);
        restored.Success.Should().BeTrue(restored.Message);

        // The live database file was replaced by the archive's vacuumed copy.
        await using var after = h.NewDbContext();
        var state = await SnapshotStateAsync(after);
        state.Should().BeEquivalentTo(original);

        // Physical integrity of the restored database.
        var connection = after.Database.GetDbConnection();
        await connection.OpenAsync();
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "PRAGMA integrity_check";
            ((string)(await cmd.ExecuteScalarAsync())!).Should().Be("ok");
        }
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "PRAGMA foreign_key_check";
            using var reader = await cmd.ExecuteReaderAsync();
            var violations = new List<string>();
            while (await reader.ReadAsync())
                violations.Add(reader.GetString(0));
            violations.Should().BeEmpty();
        }

        // The metadata file is informational only: restore was driven by the
        // database inside the archive, not by metadata/reading-training.json.
        var archivePath = h.Service.GetLocalArchivePath(backupId);
        using var zip = ZipFile.OpenRead(archivePath!);
        zip.GetEntry("metadata/reading-training.json").Should().NotBeNull();
    }

    [Fact]
    public async Task Restore_RefusesArchiveWithChecksumMismatch_LeavingLiveDatabaseUntouched()
    {
        using var h = BackupHarness.Create();
        await SeedFullTrainingScenarioAsync(h);

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);
        var archivePath = h.Service.GetLocalArchivePath(created.Id)!;

        var liveDbBytes = await File.ReadAllBytesAsync(h.DatabasePath);

        // Tamper with the archive after the fact.
        await File.AppendAllTextAsync(archivePath, "tampered-after-backup");

        var result = await h.Service.RestoreBackupAsync(created.Id);
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("integrity");

        // The live database was never touched and remains fully readable.
        (await File.ReadAllBytesAsync(h.DatabasePath)).Should().Equal(liveDbBytes);
        h.Settings.IsInMaintenanceMode.Should().BeFalse();
        await using var db = h.NewDbContext();
        (await db.ReadingSessions.CountAsync()).Should().Be(3);
        (await db.ReadingProgrammes.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Restore_FailureAfterEnteringMaintenance_ExitsMaintenanceAndRollsBackWithoutTouchingLiveDatabase()
    {
        using var h = BackupHarness.Create();
        await SeedFullTrainingScenarioAsync(h);

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);
        var archivePath = h.Service.GetLocalArchivePath(created.Id)!;

        var liveDbBytes = await File.ReadAllBytesAsync(h.DatabasePath);

        // Corrupt the zip structure (truncate the end-of-central-directory
        // record) and re-stamp the record's manifest checksum so the archive
        // passes integrity verification and fails later — inside maintenance
        // mode — when the zip is extracted.
        var corrupted = await File.ReadAllBytesAsync(archivePath);
        var truncated = corrupted[..^64];
        await File.WriteAllBytesAsync(archivePath, truncated);
        var corruptedChecksum = Convert.ToHexString(SHA256.HashData(truncated)).ToLowerInvariant();

        await using (var recordDb = h.NewDbContext())
        {
            var record = await recordDb.BackupRecords.SingleAsync(r => r.Id == created.Id);
            var manifest = JsonSerializer.Deserialize<BackupManifestDto>(record.ManifestJson!, TestJsonOpts)!;
            record.ManifestJson = JsonSerializer.Serialize(
                manifest with { Checksum = corruptedChecksum }, TestJsonOpts);
            await recordDb.SaveChangesAsync();
        }

        var result = await h.Service.RestoreBackupAsync(created.Id);
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Restore failed");

        // Maintenance mode is always exited and the failed restore left the
        // live database byte-for-byte untouched (rollback by non-replacement).
        h.Settings.IsInMaintenanceMode.Should().BeFalse();
        (await File.ReadAllBytesAsync(h.DatabasePath)).Should().Equal(liveDbBytes);
        await using var db = h.NewDbContext();
        (await db.ReadingSessions.CountAsync()).Should().Be(3);
    }

    [Fact]
    public async Task CreateBackup_FailsClosed_WhenArchiveFinalizationFails_MarkingRecordFailedWithoutArchive()
    {
        using var h = BackupHarness.Create();
        await SeedFullTrainingScenarioAsync(h);

        // Block LocalBackupDir creation so finalizing a fully built archive
        // throws. Metadata serialization failures inside BuildArchiveAsync
        // take the identical path: the exception aborts the backup, the
        // record is marked Failed, and no archive survives (fail closed).
        var storageDir = Path.Combine(h.ContentRoot, "Storage");
        Directory.CreateDirectory(storageDir);
        var backupsPath = Path.Combine(storageDir, "backups");
        await File.WriteAllTextAsync(backupsPath, "blocking file");

        var result = await h.Service.CreateBackupAsync();
        result.Status.Should().Be(BackupStatus.Failed);

        await using var db = h.NewDbContext();
        var record = await db.BackupRecords.SingleAsync(r => r.Id == result.Id);
        record.Status.Should().Be(BackupStatus.Failed);
        record.ErrorMessage.Should().NotBeNullOrEmpty();
        record.LocalArchivePath.Should().BeNull();

        h.Service.GetLocalArchivePath(result.Id).Should().BeNull();
        Directory.Exists(Path.Combine(Path.GetTempPath(), $"nostos-backup-{result.Id}")).Should().BeFalse();
    }

    // --- Seeding -----------------------------------------------------------

    private static async Task SeedFullTrainingScenarioAsync(BackupHarness h)
    {
        var clock = h.Clock;
        var service = new ReadingTrainingService(h.DbFactory, clock);

        // 1. Singleton programme via the supported service command.
        var init = await service.InitializeProgrammeAsync("backup-test", "init-programme");
        init.Reply.Should().NotBeNullOrEmpty();

        // 2. Books (plain Nostos rows, required by assignments/sessions).
        var candideId = await AddBookAsync(h, "Candide", "Voltaire");
        var ethicsId = await AddBookAsync(h, "Nicomachean Ethics", "Aristotle");

        // 3. One default assignment per mode, via the service.
        var enduranceAssignment = (ReadingBookAssignmentDto)(await service.AddBookAssignmentAsync(
            new("backup-test", "add-candide", candideId, ReadingMode.Endurance, true))).Data!;
        var deepAssignment = (ReadingBookAssignmentDto)(await service.AddBookAssignmentAsync(
            new("backup-test", "add-ethics", ethicsId, ReadingMode.Deep, true))).Data!;

        // 4. Two completed, rated sessions (qualifying evidence for W32).
        await CompleteRatedSessionAsync(service, clock, enduranceAssignment.Id, ReadingMode.Endurance,
            reportedMinutes: 45, effort: 5, focus: 8, rating: 4);
        await CompleteRatedSessionAsync(service, clock, deepAssignment.Id, ReadingMode.Deep,
            reportedMinutes: 32, effort: 6, focus: 7, rating: 5);

        // 5. Committed weekly review -> exactly three per-mode decisions.
        var committed = await service.CommitWeeklyReviewAsync(new("backup-test", "commit-w32", 2026, 32));
        committed.Data.Should().NotBeNull();

        // 6. A second assignment-backed open session occupying the global
        //    open slot, with a verbatim capture attached to it.
        var openPlanned = (ReadingSessionDto)(await service.PlanSessionAsync(
            new("ui", "plan-open", enduranceAssignment.Id, ReadingMode.Endurance, 0))).Data!;
        await service.StartSessionAsync(new("ui", "start-open", openPlanned.Id));
        var captured = await service.CaptureAsync(
            new("ui", "capture-1", DistinctiveCaptureText, ReadingCaptureType.Thought));
        captured.Reply.Should().Be(ReadingReplyFormatter.ThoughtCaptured);

        // 7. Target-reached notification via the outbox scanner (the open
        //    session has now exceeded its planned target).
        clock.Advance(TimeSpan.FromMinutes(50));
        var outbox = new ReadingNotificationOutbox(h.DbFactory, clock);
        (await outbox.EnqueueTargetReachedAsync()).Should().Be(1);

        // 8. Import receipt (seeded directly; the import command pipeline is
        //    out of scope for the backup round-trip).
        await using (var db = h.NewDbContext())
        {
            db.ReadingImportReceipts.Add(new ReadingImportReceipt
            {
                SourceFingerprint = "import-fp-1",
                ResultJson = "{\"source\":\"hermes\",\"imported\":3}",
            });
            await db.SaveChangesAsync();
        }
    }

    private static async Task CompleteRatedSessionAsync(
        ReadingTrainingService service,
        MutableClock clock,
        Guid assignmentId,
        ReadingMode mode,
        int reportedMinutes,
        int effort,
        int focus,
        int? rating)
    {
        var planned = (ReadingSessionDto)(await service.PlanSessionAsync(
            new("ui", $"plan-{Guid.NewGuid():N}", assignmentId, mode, 0))).Data!;
        await service.StartSessionAsync(new("ui", $"start-{Guid.NewGuid():N}", planned.Id));
        clock.Advance(TimeSpan.FromMinutes(reportedMinutes + 5));
        await service.CompleteSessionAsync(new("ui", $"complete-{Guid.NewGuid():N}", reportedMinutes));
        await service.RateSessionAsync(new("ui", $"rate-{Guid.NewGuid():N}", effort, focus, rating));
    }

    private static async Task<Guid> AddBookAsync(BackupHarness h, string title, string? author)
    {
        await using var db = h.NewDbContext();
        var book = new PhysicalBookModel { Title = title, Author = author };
        db.Books.Add(book);
        await db.SaveChangesAsync();
        return book.Id;
    }

    // --- State snapshot (authoritative DB) ---------------------------------

    private static async Task<TrainingStateSnapshot> SnapshotStateAsync(NostosDbContext db)
    {
        var programme = await db.ReadingProgrammes.AsNoTracking().SingleAsync();
        var assignments = await db.ReadingBookAssignments.AsNoTracking().ToListAsync();
        var sessions = await db.ReadingSessions.AsNoTracking().ToListAsync();
        var captures = await db.ReadingCaptures.AsNoTracking().ToListAsync();
        var reviews = await db.ReadingWeeklyReviews.AsNoTracking().ToListAsync();
        var decisions = await db.ReadingModeDecisions.AsNoTracking().ToListAsync();
        var notifications = await db.ReadingNotifications.AsNoTracking().ToListAsync();
        var receipts = await db.ReadingCommandReceipts.AsNoTracking().ToListAsync();
        var importReceipts = await db.ReadingImportReceipts.AsNoTracking().ToListAsync();
        var books = await db.Books.AsNoTracking().ToListAsync();

        return new TrainingStateSnapshot(
            Assignments: assignments.Count,
            Sessions: sessions.Count,
            Captures: captures.Count,
            Reviews: reviews.Count,
            Decisions: decisions.Count,
            Notifications: notifications.Count,
            CommandReceipts: receipts.Count,
            ImportReceipts: importReceipts.Count,
            OpenSessions: sessions.Count(s => s.OpenSlot != null),
            Programme: new ProgrammeState(
                programme.StateVersion,
                programme.TimezoneId,
                programme.EnduranceTargetMinutes,
                programme.DeepTargetMinutes,
                programme.RecoveryTargetMinutes,
                programme.EnduranceEstablishedMinutes,
                programme.DeepEstablishedMinutes,
                programme.RecoveryEstablishedMinutes,
                programme.EnduranceConsecutiveIncreases,
                programme.DeepConsecutiveIncreases,
                programme.DeloadActive,
                programme.DeloadStartedAt,
                programme.CreatedAt,
                programme.UpdatedAt),
            AssignmentRows: assignments
                .Select(a => new AssignmentState(a.Id, a.BookId, a.Mode, a.Status, a.QueueOrder, a.DefaultSlot, a.CreatedAt, a.StartedAt, a.CompletedAt))
                .ToList(),
            SessionRows: sessions
                .Select(s => new SessionState(
                    s.Id, s.BookAssignmentId, s.BookId, s.Mode, s.Status, s.OpenSlot,
                    s.TargetMinutes, s.PlannedTargetMinutes, s.Constraint,
                    s.PlannedAt, s.StartedAt, s.LastStartedAt, s.PausedAt, s.CompletedAt,
                    s.RatingRequestedAt, s.AccumulatedSeconds, s.MeasuredSeconds,
                    s.ReportedMinutes, s.Effort, s.Focus, s.Rating, s.RatingsSkipped,
                    s.NoticeSent, s.CreatedAt, s.UpdatedAt))
                .ToList(),
            CaptureRows: captures
                .Select(c => new CaptureState(c.Id, c.Text, c.Type, c.BookId, c.SessionId, c.ExternalId, c.Resolved, c.PromotedNoteId, c.CreatedAt))
                .ToList(),
            ReviewRows: reviews
                .Select(r => new ReviewState(r.Id, r.WeekKey, r.CommittedAt, r.StateVersionAfter, r.TotalVolumeMinutes, r.PreviousWeekVolumeMinutes))
                .ToList(),
            DecisionRows: decisions
                .Select(d => new DecisionState(
                    d.Id, d.WeeklyReviewId, d.Mode, d.TargetBeforeMinutes, d.TargetAfterMinutes,
                    d.DecisionKind, d.Reason, d.QualifyingCount, d.CompletionRate,
                    d.MedianEffort, d.MedianFocus, d.NextConsecutiveIncreases))
                .ToList(),
            NotificationRows: notifications
                .Select(n => new NotificationState(n.Id, n.Kind, n.PayloadJson, n.DedupeKey, n.CreatedAt, n.LeaseUntil, n.AckedAt))
                .ToList(),
            ReceiptRows: receipts
                .Select(r => new ReceiptState(r.ClientId, r.IdempotencyKey, r.CommandKind, r.ResponseJson, r.CreatedAt))
                .ToList(),
            ImportReceiptRows: importReceipts
                .Select(r => new ImportReceiptState(r.SourceFingerprint, r.ResultJson, r.CreatedAt))
                .ToList(),
            BookRows: books
                .Select(b => new BookState(b.Id, b.Title, b.Author))
                .ToList());
    }

    [Fact]
    public async Task RestoreBackup_RoundTripsBookFiles_WhenIncludeBookFiles()
    {
        using var h = BackupHarness.Create(includeBookFiles: true);

        var bookDir = Path.Combine(h.ContentRoot, "Storage", "books", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(bookDir);
        var payload = "EPUB-FILE-PAYLOAD-quixotic-42"u8.ToArray();
        var bookFile = Path.Combine(bookDir, "book.epub");
        await File.WriteAllBytesAsync(bookFile, payload);

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);

        // Destructively remove the live file (simulates a lost book file).
        File.Delete(bookFile);

        var restored = await h.Service.RestoreBackupAsync(created.Id);
        restored.Success.Should().BeTrue(restored.Message);

        File.Exists(bookFile).Should().BeTrue();
        (await File.ReadAllBytesAsync(bookFile)).Should().Equal(payload);
    }

    // --- Harness -----------------------------------------------------------

    private sealed class BackupHarness : IDisposable
    {
        public string ContentRoot { get; }
        public string DatabasePath { get; }
        public DbContextOptions<NostosDbContext> Options { get; }
        public MutableClock Clock { get; } = new(new DateTime(2026, 8, 5, 10, 0, 0, DateTimeKind.Utc));

        private readonly ServiceProvider _provider;

        private BackupHarness(
            string contentRoot,
            string databasePath,
            DbContextOptions<NostosDbContext> options,
            ServiceProvider provider)
        {
            ContentRoot = contentRoot;
            DatabasePath = databasePath;
            Options = options;
            _provider = provider;
        }

        public BackupService Service => _provider.GetRequiredService<BackupService>();
        public BackupSettingsProvider Settings => _provider.GetRequiredService<BackupSettingsProvider>();
        public IDbContextFactory<NostosDbContext> DbFactory => _provider.GetRequiredService<IDbContextFactory<NostosDbContext>>();

        public NostosDbContext NewDbContext() => new(Options);

        public static BackupHarness Create(bool includeBookFiles = false)
        {
            var contentRoot = Path.Combine(Path.GetTempPath(), $"nostos-backup-test-{Guid.NewGuid():N}");
            Directory.CreateDirectory(contentRoot);
            var databasePath = Path.Combine(contentRoot, "nostos.db");

            var options = new DbContextOptionsBuilder<NostosDbContext>()
                .UseSqlite($"Data Source={databasePath}")
                .Options;

            var env = new TestWebHostEnvironment
            {
                ApplicationName = "Nostos.Backend",
                EnvironmentName = "Test",
                ContentRootPath = contentRoot,
                WebRootPath = Path.Combine(contentRoot, "wwwroot"),
            };

            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IWebHostEnvironment>(env);
            services.AddSingleton(Microsoft.Extensions.Options.Options.Create(new BackupSettings
            {
                IsEnabled = true,
                Provider = "Local",
                IntervalHours = 168,
                MaxBackups = 10,
                IncludeBookFiles = includeBookFiles,
            }));
            services.AddSingleton(options);
            services.AddScoped<NostosDbContext>(sp =>
                new NostosDbContext(sp.GetRequiredService<DbContextOptions<NostosDbContext>>()));
            services.AddSingleton<IDbContextFactory<NostosDbContext>>(sp =>
                new TestContextFactory(sp.GetRequiredService<DbContextOptions<NostosDbContext>>()));
            services.AddSingleton<BackupSettingsProvider>();
            services.AddSingleton<IFileStorageService>(sp =>
                new FileStorageService(
                    sp.GetRequiredService<IWebHostEnvironment>(),
                    sp.GetRequiredService<ILogger<FileStorageService>>()));
            services.AddSingleton<BackupService>();
            var provider = services.BuildServiceProvider();

            using (var db = provider.GetRequiredService<IDbContextFactory<NostosDbContext>>().CreateDbContext())
                db.Database.EnsureCreated();

            return new BackupHarness(contentRoot, databasePath, options, provider);
        }

        public void Dispose()
        {
            _provider.Dispose();
            SqliteConnection.ClearAllPools();
            try
            {
                Directory.Delete(ContentRoot, true);
            }
            catch (IOException)
            {
                // Best-effort cleanup only.
            }
            catch (UnauthorizedAccessException)
            {
                // Best-effort cleanup only.
            }
        }
    }

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);

        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class MutableClock(DateTime utcNow) : IReadingClock
    {
        public DateTime UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan amount) => UtcNow = UtcNow.Add(amount);
    }

    private sealed class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = string.Empty;
        public string ContentRootPath { get; set; } = string.Empty;

        public IFileProvider ContentRootFileProvider { get; set; } =
            new PhysicalFileProvider(Path.GetTempPath());

        public string WebRootPath { get; set; } = Path.GetTempPath();

        public IFileProvider WebRootFileProvider { get; set; } =
            new PhysicalFileProvider(Path.GetTempPath());
    }

    // --- Snapshot DTOs (plain records: FluentAssertions compares by value) --

    private sealed record TrainingStateSnapshot(
        int Assignments,
        int Sessions,
        int Captures,
        int Reviews,
        int Decisions,
        int Notifications,
        int CommandReceipts,
        int ImportReceipts,
        int OpenSessions,
        ProgrammeState Programme,
        List<AssignmentState> AssignmentRows,
        List<SessionState> SessionRows,
        List<CaptureState> CaptureRows,
        List<ReviewState> ReviewRows,
        List<DecisionState> DecisionRows,
        List<NotificationState> NotificationRows,
        List<ReceiptState> ReceiptRows,
        List<ImportReceiptState> ImportReceiptRows,
        List<BookState> BookRows);

    private sealed record ProgrammeState(
        string StateVersion,
        string TimezoneId,
        int EnduranceTargetMinutes,
        int DeepTargetMinutes,
        int RecoveryTargetMinutes,
        int EnduranceEstablishedMinutes,
        int DeepEstablishedMinutes,
        int RecoveryEstablishedMinutes,
        int EnduranceConsecutiveIncreases,
        int DeepConsecutiveIncreases,
        bool DeloadActive,
        DateTime? DeloadStartedAt,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    private sealed record AssignmentState(
        Guid Id, Guid BookId, ReadingMode Mode, ReadingAssignmentStatus Status,
        int QueueOrder, int? DefaultSlot, DateTime CreatedAt, DateTime? StartedAt, DateTime? CompletedAt);

    private sealed record SessionState(
        Guid Id, Guid? BookAssignmentId, Guid BookId, ReadingMode Mode, ReadingSessionStatus Status,
        int? OpenSlot, int TargetMinutes, int PlannedTargetMinutes, ReadingConstraint Constraint,
        DateTime PlannedAt, DateTime? StartedAt, DateTime? LastStartedAt, DateTime? PausedAt,
        DateTime? CompletedAt, DateTime? RatingRequestedAt, int AccumulatedSeconds, int MeasuredSeconds,
        int? ReportedMinutes, int Effort, int Focus, int? Rating, bool RatingsSkipped,
        bool NoticeSent, DateTime CreatedAt, DateTime UpdatedAt);

    private sealed record CaptureState(
        Guid Id, string Text, ReadingCaptureType Type, Guid BookId, Guid? SessionId,
        string? ExternalId, bool Resolved, Guid? PromotedNoteId, DateTime CreatedAt);

    private sealed record ReviewState(
        Guid Id, string WeekKey, DateTime CommittedAt, string StateVersionAfter,
        int TotalVolumeMinutes, int PreviousWeekVolumeMinutes);

    private sealed record DecisionState(
        Guid Id, Guid WeeklyReviewId, ReadingMode Mode, int TargetBeforeMinutes, int TargetAfterMinutes,
        string DecisionKind, string Reason, int QualifyingCount, double CompletionRate,
        int? MedianEffort, int? MedianFocus, int NextConsecutiveIncreases);

    private sealed record NotificationState(
        Guid Id, string Kind, string PayloadJson, string DedupeKey,
        DateTime CreatedAt, DateTime? LeaseUntil, DateTime? AckedAt);

    private sealed record ReceiptState(
        string ClientId, string IdempotencyKey, string CommandKind, string ResponseJson, DateTime CreatedAt);

    private sealed record ImportReceiptState(string SourceFingerprint, string ResultJson, DateTime CreatedAt);

    private sealed record BookState(Guid Id, string Title, string? Author);
}
