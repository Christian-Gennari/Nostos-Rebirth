using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;

// Task 13 E2E fixture helper: bootstrap a brand-new SQLite database for the
// real Nostos backend.
//
// This repository's migration history has no initial baseline migration (the
// oldest migration alters the Books table), so a fresh database cannot be
// bootstrapped with Migrate() — the backend's own integration tests hit the
// same wall and use EnsureCreated() (see
// Nostos.Backend.Tests/ReadingTraining/ReadingTrainingSqliteFixture.cs).
//
// The fixture launcher therefore: 1) creates the schema from the current EF
// model (EnsureCreated), and 2) marks every known migration as applied in
// __EFMigrationsHistory. The backend's startup Migrate() then becomes a no-op
// and the DB behaves exactly like an incrementally migrated production DB.
//
// Usage: dotnet <Nostos.E2eDbBootstrap.dll> <path-to-nostos.db>
if (args.Length != 1)
{
    Console.Error.WriteLine("usage: Nostos.E2eDbBootstrap <database-path>");
    return 2;
}

var dbPath = Path.GetFullPath(args[0]);
var dir = Path.GetDirectoryName(dbPath);
if (dir is not null)
{
    Directory.CreateDirectory(dir);
}

var options = new DbContextOptionsBuilder<NostosDbContext>()
    .UseSqlite($"Data Source={dbPath}")
    .Options;

await using var db = new NostosDbContext(options);

db.Database.EnsureCreated();

await db.Database.ExecuteSqlRawAsync(
    """
    CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
        "MigrationId" TEXT NOT NULL CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY,
        "ProductVersion" TEXT NOT NULL
    );
    """);

var migrationIds = db.Database.GetMigrations().ToList();
if (migrationIds.Count == 0)
{
    Console.Error.WriteLine("[db-bootstrap] no migrations resolved from the backend assembly; refusing to continue");
    return 1;
}

foreach (var id in migrationIds)
{
    await db.Database.ExecuteSqlRawAsync(
        """
        INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
        VALUES ({0}, {1})
        """,
        id,
        "10.0.0");
}

Console.WriteLine($"[db-bootstrap] schema created at {dbPath}; {migrationIds.Count} migrations marked applied");
return 0;
