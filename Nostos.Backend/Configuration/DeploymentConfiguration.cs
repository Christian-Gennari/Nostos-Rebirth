using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;

namespace Nostos.Backend.Configuration;

/// <summary>
/// The deployment shape of the running Nostos server.
///
/// This is deliberately a small closed set. Product/domain code should depend
/// on explicit capabilities or infrastructure abstractions rather than parsing
/// configuration strings or checking host names.
/// </summary>
public enum DeploymentMode
{
    SelfHosted,
    Cloud,
}

/// <summary>
/// Product-visible differences between deployment modes.
///
/// These are stable Nostos capabilities, not infrastructure vendor names.
/// </summary>
public sealed record DeploymentCapabilities(
    bool RequiresAuthentication,
    bool CanConfigureAiProvider,
    bool ManagedAi,
    bool ManagedVoiceTranscription,
    bool UsesCloudStorage,
    bool SupportsLocalBackupConfiguration,
    bool UsageMeteringAvailable);

/// <summary>
/// Server-authoritative deployment descriptor resolved once during startup.
/// </summary>
public sealed record DeploymentDescriptor(
    DeploymentMode Mode,
    DeploymentCapabilities Capabilities)
{
    public const string ConfigurationKey = "Nostos:DeploymentMode";

    public static DeploymentDescriptor FromConfiguration(IConfiguration configuration)
    {
        var configured = configuration[ConfigurationKey];

        if (string.IsNullOrWhiteSpace(configured))
            return For(DeploymentMode.SelfHosted);

        if (!Enum.TryParse<DeploymentMode>(configured.Trim(), ignoreCase: true, out var mode)
            || !Enum.IsDefined(mode))
        {
            throw new InvalidOperationException(
                $"Invalid '{ConfigurationKey}' value '{configured}'. " +
                $"Supported values are '{DeploymentMode.SelfHosted}' and '{DeploymentMode.Cloud}'.");
        }

        return For(mode);
    }

    public static DeploymentDescriptor For(DeploymentMode mode) =>
        mode switch
        {
            DeploymentMode.SelfHosted => new(
                mode,
                new DeploymentCapabilities(
                    RequiresAuthentication: false,
                    CanConfigureAiProvider: true,
                    ManagedAi: false,
                    ManagedVoiceTranscription: false,
                    UsesCloudStorage: false,
                    SupportsLocalBackupConfiguration: true,
                    UsageMeteringAvailable: false)),

            DeploymentMode.Cloud => new(
                mode,
                new DeploymentCapabilities(
                    RequiresAuthentication: true,
                    CanConfigureAiProvider: false,
                    ManagedAi: true,
                    ManagedVoiceTranscription: true,
                    UsesCloudStorage: true,
                    SupportsLocalBackupConfiguration: false,
                    UsageMeteringAvailable: true)),

            _ => throw new ArgumentOutOfRangeException(nameof(mode), mode, "Unsupported Nostos deployment mode."),
        };
}

/// <summary>
/// Composition-root helpers for deployment-specific infrastructure.
///
/// Normal feature/domain services should not branch on raw deployment
/// configuration. Provider-specific registrations belong here (or in focused
/// extensions called from here) as Cloud infrastructure is implemented.
/// </summary>
public static class DeploymentServiceRegistration
{
    public static DeploymentDescriptor AddNostosDeployment(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var deployment = DeploymentDescriptor.FromConfiguration(configuration);
        services.AddSingleton(deployment);
        return deployment;
    }

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
