using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;

namespace Nostos.Backend.Configuration;

/// <summary>
/// SelfHosted persistence composition. The public host uses local SQLite; the
/// private hosted executable supplies its own PostgreSQL context factory.
/// </summary>
public static class PersistenceRegistration
{
    public static IServiceCollection AddNostosPersistence(
        this IServiceCollection services,
        string contentRootPath)
    {
        services.AddDbContextFactory<NostosDbContext>(options =>
        {
            var dbPath = Path.Combine(contentRootPath, "nostos.db");
            options.UseSqlite(
                $"Data Source={dbPath}",
                sqlite => sqlite.MigrationsAssembly(
                    typeof(PersistenceRegistration).Assembly.FullName));
        });
        return services;
    }
}
