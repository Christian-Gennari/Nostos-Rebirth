using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nostos.Backend.Cloud;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Persistence;
using Nostos.Backend.Cloud.Provisioning;
using Nostos.Backend.Data;
using Nostos.Backend.Security;

namespace Nostos.Backend.Configuration;

public static class CloudPersistenceRegistration
{
    public static IServiceCollection AddNostosCloudPersistence(
        this IServiceCollection services,
        IConfiguration configuration,
        Func<string, string?>? environmentReader = null)
    {
        var options = CloudControlPlaneOptions.FromConfiguration(configuration);
        var connections = options.ResolveConnections(environmentReader);

        services.AddSingleton(options);
        services.AddSingleton(connections);

        services.AddDbContextFactory<CloudControlPlaneDbContext>(db =>
            db.UseNpgsql(connections.ControlPlane));

        services.AddSingleton<CloudControlPlaneStore>();
        services.AddSingleton<ICloudControlPlaneStore>(
            sp => sp.GetRequiredService<CloudControlPlaneStore>());

        // #395 registered a fail-closed placeholder. Once the real control
        // plane exists, authorization reads account state from this store.
        services.Replace(ServiceDescriptor.Singleton<ICloudAccountStatusStore>(
            sp => sp.GetRequiredService<CloudControlPlaneStore>()));

        services.AddSingleton<ICloudControlPlaneBootstrapper, CloudControlPlaneBootstrapper>();

        services.AddSingleton<ICloudCustomerConnectionFactory, CloudCustomerConnectionFactory>();
        services.AddSingleton<ICloudCustomerDatabaseProvisioner, CloudCustomerDatabaseProvisioner>();

        services.AddSingleton<CloudTenantDbContextFactory>();
        services.AddSingleton<IDbContextFactory<NostosDbContext>>(
            sp => sp.GetRequiredService<CloudTenantDbContextFactory>());

        // Existing repositories and domain services consume a scoped
        // NostosDbContext. In Cloud this scoped context is created from the
        // trusted tenant-aware factory above.
        services.AddScoped(sp =>
            sp.GetRequiredService<IDbContextFactory<NostosDbContext>>().CreateDbContext());

        return services;
    }
}
