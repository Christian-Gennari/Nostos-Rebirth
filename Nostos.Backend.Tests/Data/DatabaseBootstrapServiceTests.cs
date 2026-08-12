using System.Data;
using System.Data.Common;
using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models.ReadingTraining;
using Xunit;

namespace Nostos.Backend.Tests.Data;

// Real temporary-file SQLite tests for the production database bootstrap
// (Nostos.Backend/Data/DatabaseBootstrapService.cs). These deliberately do
// NOT use EnsureCreated (the bootstrap under test must create the schema
// itself), so every database starts as a genuinely empty file.
public sealed class DatabaseBootstrapServiceTests : IDisposable
{
    // TPH note: PhysicalBook/EBook/AudioBook map to the single Books table
    // via the BookType discriminator — no separate derived tables exist.
    private static readonly string[] ExpectedCoreTables =
    [
        "BackupRecords",
        "Books",
        "Collections",
        "Concepts",
        "Notes",
        "NoteConcepts",
        "Writings",
    ];

    private static readonly string[] ExpectedReadingTables =
    [
        "ReadingBookAssignments",
        "ReadingCaptures",
        "ReadingCommandReceipts",
        "ReadingImportReceipts",
        "ReadingModeDecisions",
        "ReadingNotifications",
        "ReadingProgrammes",
        "ReadingSessions",
        "ReadingWeeklyReviews",
    ];

    private readonly List<string> _databasePaths = new();

    private string CreateDatabasePath()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nostos-bootstrap-{Guid.NewGuid():N}.db");
        _databasePaths.Add(path);
        return path;
    }

    private static NostosDbContext CreateContext(string databasePath)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={databasePath}")
            .Options;
        return new NostosDbContext(options);
    }

    [Fact]
    public async Task FreshEmptyDatabase_BootstrapCreatesFullSchemaAndCompleteHistory()
    {
        var path = CreateDatabasePath(); // file does not exist yet
        await using var db = CreateContext(path);
        var service = new DatabaseBootstrapService(db);

        await service.EnsureReadyAsync();

        var tables = TableNames(db);
        tables.Should().Contain(ExpectedCoreTables);
        tables.Should().Contain(ExpectedReadingTables);
        tables.Should().Contain("__EFMigrationsHistory");

        var history = HistoryRows(db);
        var migrations = db.Database.GetMigrations().ToList();
        migrations.Should().NotBeEmpty();
        history.Should().HaveCount(migrations.Count);
        history.Select(h => h.Id).Distinct().Should().HaveCount(migrations.Count);
        history.Select(h => h.Id).Should().Equal(migrations);
        history.Should().OnlyContain(h => !string.IsNullOrWhiteSpace(h.Version));
    }

    [Fact]
    public async Task ZeroByteEmptyFile_IsTreatedAsTrulyEmptyAndBootstrapped()
    {
        var path = CreateDatabasePath();
        await File.WriteAllBytesAsync(path, Array.Empty<byte>());
        await using var db = CreateContext(path);

        await new DatabaseBootstrapService(db).EnsureReadyAsync();

        TableNames(db).Should().Contain(ExpectedCoreTables);
        TableNames(db).Should().Contain(ExpectedReadingTables);
        HistoryRows(db).Should().HaveCount(db.Database.GetMigrations().Count());
    }

    [Fact]
    public async Task SecondRun_IsIdempotent()
    {
        var path = CreateDatabasePath();
        await using var db = CreateContext(path);
        var service = new DatabaseBootstrapService(db);

        await service.EnsureReadyAsync();
        var tablesBefore = TableNames(db);
        var historyBefore = HistoryRows(db);

        await service.EnsureReadyAsync();

        TableNames(db).Should().Equal(tablesBefore);
        HistoryRows(db).Should().Equal(historyBefore);
    }

    [Fact]
    public async Task AfterBootstrap_OrdinaryMigrateSucceeds()
    {
        var path = CreateDatabasePath();
        await using var db = CreateContext(path);
        await new DatabaseBootstrapService(db).EnsureReadyAsync();

        await db.Database.MigrateAsync();

        HistoryRows(db).Should().HaveCount(db.Database.GetMigrations().Count());
    }

    [Fact]
    public async Task ExistingDatabaseWithHistoryAndData_UsesNormalMigrationPathAndPreservesData()
    {
        var path = CreateDatabasePath();
        await using var db = CreateContext(path);

        // A production-shaped database: bootstrapped, then with real data and
        // a migration history that predates the newest migration.
        await new DatabaseBootstrapService(db).EnsureReadyAsync();

        var programme = new ReadingProgramme
        {
            Id = ReadingProgramme.WellKnownId,
            SingletonSlot = ReadingProgramme.SingletonSentinel,
            TimezoneId = "Europe/Stockholm",
            StateVersion = "7",
            EnduranceTargetMinutes = 45,
        };
        db.ReadingProgrammes.Add(programme);
        await db.SaveChangesAsync();

        var migrations = db.Database.GetMigrations().ToList();
        var newestMigrationId = migrations[^1];
        var oldestMigrationId = migrations[0];

        // Simulate a database created before the newest migration shipped:
        // history stops at migration N-1, and one row carries a custom
        // ProductVersion marker that a rebaseline would rewrite.
        await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" = {0}", newestMigrationId);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE \"__EFMigrationsHistory\" SET \"ProductVersion\" = 'custom-probe' WHERE \"MigrationId\" = {0}",
            oldestMigrationId);

        // The bootstrap above created the CURRENT model (including the newest
        // migration's objects). Roll the schema back to the pre-newest state
        // so the ordinary migration path really has something to apply.
        if (newestMigrationId.Contains("AddLibraryCommandSurface"))
        {
            await db.Database.ExecuteSqlRawAsync(
                "DROP INDEX \"IX_Books_NormalizedIsbn\"; DROP INDEX \"IX_Books_NormalizedAsin\"; " +
                "DROP TABLE \"LibraryCommandReceipts\"; DROP TABLE \"LibraryStates\"; " +
                "ALTER TABLE \"Books\" DROP COLUMN \"NormalizedIsbn\"; " +
                "ALTER TABLE \"Books\" DROP COLUMN \"NormalizedAsin\";");
        }

        await new DatabaseBootstrapService(db).EnsureReadyAsync();

        // Data survived the normal migration path.
        db.ReadingProgrammes.SingleOrDefault(p => p.Id == ReadingProgramme.WellKnownId)
            .Should().NotBeNull();

        // The missing migration was applied through the ordinary path and the
        // history is complete again.
        var history = HistoryRows(db);
        history.Should().HaveCount(migrations.Count);
        history.Should().Contain(h => h.Id == newestMigrationId);

        // Never rebaselined: the custom marker and untouched rows survive.
        history.Should().Contain(h => h.Id == oldestMigrationId && h.Version == "custom-probe");

        // The ordinary path also remains a no-op on the next run.
        await new DatabaseBootstrapService(db).EnsureReadyAsync();
        HistoryRows(db).Should().HaveCount(migrations.Count);
    }

    [Fact]
    public async Task PartialNonEmptySchema_IsRejectedAndNotSilentlyStamped()
    {
        var path = CreateDatabasePath();
        await using (var raw = new SqliteConnection($"Data Source={path}"))
        {
            await raw.OpenAsync();
            await using (var command = raw.CreateCommand())
            {
                // A bare, partial legacy schema: only Books, no history.
                command.CommandText =
                    "CREATE TABLE Books (Id TEXT NOT NULL PRIMARY KEY, Title TEXT NOT NULL)";
                await command.ExecuteNonQueryAsync();
            }
        }

        await using var db = CreateContext(path);
        var exception = await Record.ExceptionAsync(() => new DatabaseBootstrapService(db).EnsureReadyAsync());

        // Rejected: the ordinary migration path fails closed on a schema it
        // cannot migrate.
        exception.Should().NotBeNull();
        exception!.GetBaseException().Should().BeOfType<SqliteException>();

        // Not silently stamped: no complete baseline was written and the
        // partial schema was left in place.
        var tables = TableNames(db);
        tables.Should().Contain("Books");
        tables.Should().NotContain(ExpectedReadingTables);

        var history = HistoryRows(db);
        history.Should().OnlyContain(h => h.Id != db.Database.GetMigrations().Last());
        history.Should().HaveCountLessThan(db.Database.GetMigrations().Count());
    }

    public void Dispose()
    {
        foreach (var path in _databasePaths)
        {
            foreach (var suffix in new[] { "", "-shm", "-wal" })
            {
                try
                {
                    File.Delete(path + suffix);
                }
                catch (IOException)
                {
                    // Best-effort cleanup only.
                }
            }
        }
    }

    // TableNames excludes __EFMigrationsLock: the lock table is an EF-internal
    // artifact created by the first Migrate() run, not part of the domain
    // schema, so it must not disturb schema-equality assertions.
    private static List<string> TableNames(NostosDbContext db)
    {
        var names = new List<string>();
        ExecuteReader(db,
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__EFMigrationsLock' ORDER BY name",
            reader => names.Add(reader.GetString(0)));
        return names;
    }

    private static List<(string Id, string Version)> HistoryRows(NostosDbContext db)
    {
        var rows = new List<(string, string)>();
        ExecuteReader(db,
            "SELECT \"MigrationId\", \"ProductVersion\" FROM \"__EFMigrationsHistory\" ORDER BY \"MigrationId\"",
            reader => rows.Add((reader.GetString(0), reader.GetString(1))));
        return rows;
    }

    private static void ExecuteReader(NostosDbContext db, string sql, Action<DbDataReader> read)
    {
        var connection = db.Database.GetDbConnection();
        var wasOpen = connection.State == ConnectionState.Open;
        if (!wasOpen)
        {
            connection.Open();
        }

        try
        {
            using var command = connection.CreateCommand();
            command.CommandText = sql;
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                read(reader);
            }
        }
        finally
        {
            if (!wasOpen)
            {
                connection.Close();
            }
        }
    }
}
