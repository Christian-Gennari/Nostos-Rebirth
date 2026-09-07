using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Data;
using Xunit;

namespace Nostos.Backend.Tests.Data;

// Migration bootstrap verification for issue #51: an existing database
// (production has ~37 applied migrations) has no CreatedAt index on
// LibraryCommandReceipts, and the retention migration must apply cleanly on
// top of it. This builds exactly that state — full current schema minus the
// CreatedAt index, with the migration history claiming every migration the
// migrations assembly knows except the retention one — then runs Migrate()
// and verifies the index.
public sealed class LibraryReceiptRetentionMigrationTests : IDisposable
{
    private const string IndexName = "IX_LibraryCommandReceipts_CreatedAt";

    private readonly List<string> _databasePaths = new();

    [Fact]
    public async Task Retention_migration_applies_cleanly_to_a_pre_retention_database()
    {
        var path = NewDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;

        // The migration ids EF Core itself knows about (the same source
        // Migrate() uses; hand-written migrations without a [Migration]
        // attribute are not part of it).
        var migrationIds = GetMigrationsAssemblyIds(options);
        migrationIds.Should().Contain(name => name.Contains("AddLibraryCommandReceiptRetentionIndex"));
        var retentionMigrationId = migrationIds.First(name => name.Contains("AddLibraryCommandReceiptRetentionIndex"));

        // Build the pre-retention state: schema WITHOUT the CreatedAt index,
        // history claiming every known migration except the retention one.
        await using (var db = new NostosDbContext(options))
        {
            db.Database.EnsureCreated();
            (await IndexCountAsync(path)).Should().Be(1, "the current model creates the index");
            await db.Database.ExecuteSqlRawAsync($"DROP INDEX \"{IndexName}\"");

            // EnsureCreated does not create the migration history table;
            // create the standard EF Core SQLite shape so Migrate() can read
            // it.
            await db.Database.ExecuteSqlRawAsync(
                "CREATE TABLE \"__EFMigrationsHistory\" (" +
                "\"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY, " +
                "\"ProductVersion\" TEXT NOT NULL)");

            foreach (var id in migrationIds)
            {
                await db.Database.ExecuteSqlRawAsync(
                    "INSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ({0}, {1})",
                    id,
                    "10.0.0");
            }
            await db.Database.ExecuteSqlRawAsync(
                "DELETE FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" = {0}",
                retentionMigrationId);
        }

        // Apply pending migrations: exactly the retention migration.
        await using (var db = new NostosDbContext(options))
        {
            await db.Database.MigrateAsync();
        }

        (await IndexCountAsync(path)).Should().Be(1, "the retention migration created the CreatedAt index");
        (await HistoryCountAsync(path)).Should().Be(migrationIds.Count, "exactly one migration was applied");

        // The index must be usable for the retention query shape.
        await using (var db = new NostosDbContext(options))
        {
            var now = DateTime.UtcNow;
            var count = await db.LibraryCommandReceipts.CountAsync(r => r.CreatedAt < now.AddDays(-90));
            count.Should().Be(0);
        }
    }

    private static IReadOnlyList<string> GetMigrationsAssemblyIds(DbContextOptions<NostosDbContext> options)
    {
        using var db = new NostosDbContext(options);
        var assembly = ((IInfrastructure<IServiceProvider>)db).Instance.GetRequiredService<IMigrationsAssembly>();
        return assembly.Migrations.Keys.OrderBy(id => id, StringComparer.Ordinal).ToList();
    }

    private string NewDatabasePath()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nostos-retention-migration-{Guid.NewGuid():N}.db");
        _databasePaths.Add(path);
        return path;
    }

    private static async Task<int> IndexCountAsync(string path)
    {
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*) FROM \"sqlite_master\" WHERE \"type\" = 'index' AND \"name\" = @name";
        command.Parameters.Add(new SqliteParameter("@name", IndexName));
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private static async Task<int> HistoryCountAsync(string path)
    {
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM \"__EFMigrationsHistory\"";
        return Convert.ToInt32(await command.ExecuteScalarAsync());
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
}
