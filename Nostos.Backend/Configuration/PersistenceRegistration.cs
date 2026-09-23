using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;

namespace Nostos.Backend.Configuration;

/// <summary>
/// Transitional host composition for the two currently supported persistence
/// adapters. The public product owns NostosDbContext; hosts own how a context is
/// created.
/// </summary>
public static class PersistenceRegistration
{
    public static IServiceCollection AddNostosPersistence(
        this IServiceCollection services,
        IConfiguration configuration,
        DeploymentDescriptor deployment,
        string contentRootPath,
        Func<string, string?>? environmentReader = null)
    {
        switch (deployment.Mode)
        {
            case DeploymentMode.SelfHosted:
                services.AddDbContextFactory<NostosDbContext>(options =>
                {
                    var dbPath = Path.Combine(contentRootPath, "nostos.db");
                    options.UseSqlite($"Data Source={dbPath}");
                });
                return services;

            case DeploymentMode.Cloud:
                services.AddNostosCloudPersistence(configuration, environmentReader);
                return services;

            default:
                throw new ArgumentOutOfRangeException(
                    nameof(deployment),
                    deployment.Mode,
                    "Unsupported Nostos deployment mode.");
        }
    }
}
