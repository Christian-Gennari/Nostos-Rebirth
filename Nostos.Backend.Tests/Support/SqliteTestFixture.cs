using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;

namespace Nostos.Backend.Tests.Support;

// Reusable temporary-file SQLite fixture. Each database lives in a real
// temporary SQLite file (never the EF in-memory provider) so foreign-key and
// unique-constraint behaviour matches production. The schema is created from
// the EF model (this repository's migration history has no initial baseline
// migration, so a fresh database cannot be bootstrapped with Migrate()).
public sealed class SqliteTestFixture : IDisposable
{
    private readonly List<string> _databasePaths = new();

    public string CreateDatabasePath()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nostos-test-{Guid.NewGuid():N}.db");
        _databasePaths.Add(path);
        return path;
    }

    public NostosDbContext CreateContext(string? databasePath = null)
    {
        var path = databasePath ?? CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options;
        var context = new NostosDbContext(options);
        context.Database.EnsureCreated();
        return context;
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
