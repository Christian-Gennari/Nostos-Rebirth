using Nostos.Backend.Cloud.Privacy;

namespace Nostos.Backend.Configuration;

public static class CloudAccountDeletionRegistration
{
    public static IServiceCollection AddNostosCloudAccountDeletion(
        this IServiceCollection services,
        DeploymentDescriptor deployment)
    {
        if (deployment.Mode != DeploymentMode.Cloud)
            return services;

        services.AddSingleton<ICloudAccountDeletionResourceDestroyer,
            CloudAccountDeletionResourceDestroyer>();
        services.AddSingleton<ICloudAccountDeletionPortableExporter,
            CloudAccountDeletionPortableExporter>();
        services.AddSingleton<ICloudAccountDeletionService,
            CloudAccountDeletionService>();
        services.AddSingleton<CloudAccountDeletionSweepRunner>();
        services.AddHostedService<CloudAccountDeletionWorker>();

        return services;
    }
}
