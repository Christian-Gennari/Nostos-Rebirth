using Nostos.Backend.Cloud.Recovery;

namespace Nostos.Backend.Configuration;

public static class CloudRecoveryScheduleRegistration
{
    /// <summary>
    /// Registers the Cloud scheduled backup worker and its dependencies.
    /// Returns services unchanged in SelfHosted mode.
    /// </summary>
    public static IServiceCollection AddNostosCloudRecoverySchedule(
        this IServiceCollection services,
        IConfiguration configuration,
        DeploymentDescriptor deployment)
    {
        if (deployment.Mode != DeploymentMode.Cloud)
            return services;

        var options = CloudRecoveryScheduleOptions.FromConfiguration(configuration);

        services.AddSingleton(options);
        services.AddScoped<CloudBackupSweepRunner>();
        services.AddHostedService<CloudScheduledBackupWorker>();

        return services;
    }
}
