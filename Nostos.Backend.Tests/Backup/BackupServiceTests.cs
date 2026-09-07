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
using Nostos.Backend.Services;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Backup;

// Real backup -> restore integration tests (Task 3): the full BackupService
// runs against a real temporary SQLite database and a real content root, so
// The .nostos archive, vacuumed database and the file-copy restore path
// are all exercised for real. IncludeBookFiles=false keeps the tests free
// of book file payloads.
public sealed class BackupServiceTests
{
    private const string DistinctiveCaptureText = "Distinctive secret capture text, unique: quixotic-42";

    private static readonly JsonSerializerOptions TestJsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    [Fact]
    public async Task BackupArchive_IncludesWhitelistedMetadata_WithExactValues()
    {
        using var h = BackupHarness.Create();
        await SeedBooksAndNotesScenarioAsync(h);

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);

        var archivePath = h.Service.GetLocalArchivePath(created.Id);
        archivePath.Should().NotBeNull();

        using var zip = ZipFile.OpenRead(archivePath!);
        zip.GetEntry("metadata/notes.json").Should().NotBeNull("the .nostos archive must include metadata/notes.json");
        zip.GetEntry("metadata/concepts.json").Should().NotBeNull();
        zip.GetEntry("metadata/collections.json").Should().NotBeNull();
        zip.GetEntry("metadata/writings.json").Should().NotBeNull();
        zip.GetEntry("database/nostos.db").Should().NotBeNull();
        zip.GetEntry("manifest.json").Should().NotBeNull();
        zip.Entries.Should().NotContain(e => e.FullName.StartsWith("books/"), "IncludeBookFiles=false must not copy book files");
    }

    [Fact]
    public async Task RestoreBackup_RoundTripsBooksAndNotes_WithIntegrityAndNoForeignKeyViolations()
    {
        using var h = BackupHarness.Create();
        await SeedBooksAndNotesScenarioAsync(h);

        var created = await h.Service.CreateBackupAsync();
        created.Status.Should().Be(BackupStatus.Completed);
        var backupId = created.Id;

        // Destructively mutate the live database
        await using (var db = h.NewDbContext())
        {
            db.Notes.RemoveRange(db.Notes);
            db.Books.RemoveRange(db.Books);
            await db.SaveChangesAsync();

            (await db.Notes.CountAsync()).Should().Be(0);
            (await db.Books.CountAsync()).Should().Be(0);
        }

        var restored = await h.Service.RestoreBackupAsync(backupId);
        restored.Success.Should().BeTrue(restored.Message);

        await using var after = h.NewDbContext();
        (await after.Books.CountAsync()).Should().Be(2);
        (await after.Notes.CountAsync()).Should().Be(1);

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
    }

    [Fact]
    public async Task Restore_RefusesArchiveWithChecksumMismatch_LeavingLiveDatabaseUntouched()
    {
        using var h = BackupHarness.Create();
        await SeedBooksAndNotesScenarioAsync(h);

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
        (await db.Books.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Restore_FailureAfterEnteringMaintenance_ExitsMaintenanceAndRollsBackWithoutTouchingLiveDatabase()
    {
        using var h = BackupHarness.Create();
        await SeedBooksAndNotesScenarioAsync(h);

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
        (await db.Books.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task CreateBackup_FailsClosed_WhenArchiveFinalizationFails_MarkingRecordFailedWithoutArchive()
    {
        using var h = BackupHarness.Create();
        await SeedBooksAndNotesScenarioAsync(h);

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

    private static async Task SeedBooksAndNotesScenarioAsync(BackupHarness h)
    {
        var candideId = await AddBookAsync(h, "Candide", "Voltaire");
        var ethicsId = await AddBookAsync(h, "Nicomachean Ethics", "Aristotle");

        await using var db = h.NewDbContext();
        db.Notes.Add(new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = candideId,
            Content = "All is for the best in the best of all possible worlds.",
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private static async Task<Guid> AddBookAsync(BackupHarness h, string title, string? author)
    {
        await using var db = h.NewDbContext();
        var book = new PhysicalBookModel { Title = title, Author = author };
        db.Books.Add(book);
        await db.SaveChangesAsync();
        return book.Id;
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

    [Fact]
    public async Task ImportExistingBackups_UsesManifestTimestamp_NotUtcNow()
    {
        using var h = BackupHarness.Create();
        var backupDir = Path.Combine(h.ContentRoot, "Storage", "backups");
        Directory.CreateDirectory(backupDir);

        var archivePath = Path.Combine(backupDir, $"{Guid.NewGuid():N}.nostos");
        var manifestTimestamp = new DateTime(2026, 6, 15, 8, 30, 0, DateTimeKind.Utc);
        // Mirror production: archives are written with camelCase JsonOpts
        // (BackupService line 158), so the test manifest must be camelCase too.
        var manifestJsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        using (var zip = ZipFile.Open(archivePath, ZipArchiveMode.Create))
        {
            var dbEntry = zip.CreateEntry("database/nostos.db");
            await using (var s = dbEntry.Open())
            await using (var w = new StreamWriter(s))
                await w.WriteAsync("not-a-real-db");

            var manifestEntry = zip.CreateEntry("manifest.json");
            await using (var s = manifestEntry.Open())
            {
                var json = JsonSerializer.Serialize(new BackupManifestDto(
                    Version: "1",
                    Timestamp: manifestTimestamp,
                    DatabaseSizeBytes: 0,
                    BookFileCount: 0,
                    TotalSizeBytes: 0,
                    Checksum: ""), manifestJsonOpts);
                await s.WriteAsync(System.Text.Encoding.UTF8.GetBytes(json));
            }
        }
        // The file's write time must NOT win over the manifest timestamp.
        File.SetLastWriteTimeUtc(archivePath, new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc));

        var imported = await h.Service.ImportExistingBackupsAsync();

        imported.Should().ContainSingle();
        imported[0].CreatedAt.Should().Be(manifestTimestamp);
    }

    [Fact]
    public async Task ImportExistingBackups_FallsBackToFileWriteTime_WhenNoManifest()
    {
        using var h = BackupHarness.Create();
        var backupDir = Path.Combine(h.ContentRoot, "Storage", "backups");
        Directory.CreateDirectory(backupDir);

        var archivePath = Path.Combine(backupDir, $"{Guid.NewGuid():N}.nostos");
        using (var zip = ZipFile.Open(archivePath, ZipArchiveMode.Create))
        {
            var dbEntry = zip.CreateEntry("database/nostos.db");
            await using (var s = dbEntry.Open())
            await using (var w = new StreamWriter(s))
                await w.WriteAsync("not-a-real-db");
        }
        var writeTime = new DateTime(2026, 7, 20, 9, 15, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(archivePath, writeTime);

        var imported = await h.Service.ImportExistingBackupsAsync();

        imported.Should().ContainSingle();
        imported[0].CreatedAt.Should().Be(writeTime);
    }

    private sealed class BackupHarness : IDisposable
    {
        public string ContentRoot { get; }
        public string DatabasePath { get; }
        public DbContextOptions<NostosDbContext> Options { get; }

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
}
