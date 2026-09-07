using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nostos.Backend.Data;

namespace Nostos.Backend.Tests.Support;

public sealed class LibraryEndpointFactory : WebApplicationFactory<Program>
{
    public const string SpaShellMarker = "<!doctype html>";
    private readonly string _dbPath;

    public string DatabasePath => _dbPath;

    public LibraryEndpointFactory()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"nostos-library-tests-{Guid.NewGuid():N}.db");
        LibraryEndpointBootstrap.EnsureSchemaAndHistory(_dbPath);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((ctx, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={_dbPath}",
                ["Mcp:Enabled"] = "false",
            });
        });
        builder.ConfigureServices(services =>
        {
            var descriptors = services
                .Where(d => d.ServiceType == typeof(DbContextOptions<NostosDbContext>)
                         || d.ServiceType == typeof(IDbContextFactory<NostosDbContext>))
                .ToList();
            foreach (var descriptor in descriptors)
            {
                services.Remove(descriptor);
            }

            services.AddDbContextFactory<NostosDbContext>(options =>
            {
                options.UseSqlite($"Data Source={_dbPath}");
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            foreach (var suffix in new[] { "", "-shm", "-wal" })
            {
                var file = _dbPath + suffix;
                try
                {
                    if (File.Exists(file)) File.Delete(file);
                }
                catch (IOException)
                {
                    // Best-effort cleanup only.
                }
            }
        }
    }
}

internal static class LibraryEndpointBootstrap
{
    private static readonly object Lock = new();

    public static void EnsureSchemaAndHistory(string dbPath)
    {
        lock (Lock)
        {
            var options = new DbContextOptionsBuilder<NostosDbContext>()
                .UseSqlite($"Data Source={dbPath}")
                .Options;
            using var db = new NostosDbContext(options);
            db.Database.EnsureCreated();

            var migrationsAssembly = db.GetService<IMigrationsAssembly>();
            var allMigrations = migrationsAssembly.Migrations.Keys.OrderBy(id => id).ToList();

            db.Database.ExecuteSqlRaw(
                "CREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (" +
                "\"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY, " +
                "\"ProductVersion\" TEXT NOT NULL)");

            foreach (var migrationId in allMigrations)
            {
                db.Database.ExecuteSqlRaw(
                    "INSERT OR IGNORE INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ({0}, {1})",
                    migrationId,
                    "10.0.0");
            }
        }
    }
}
