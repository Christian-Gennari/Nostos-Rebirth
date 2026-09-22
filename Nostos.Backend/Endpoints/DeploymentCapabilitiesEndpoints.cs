using Nostos.Backend.Configuration;

namespace Nostos.Backend.Endpoints;

/// <summary>
/// Server-authoritative runtime capabilities used by the shared frontend to
/// adapt to SelfHosted vs Cloud without separate Angular builds or hostname
/// guesses.
///
/// This endpoint intentionally returns Nostos product capabilities rather than
/// database/provider/vendor details.
/// </summary>
public static class DeploymentCapabilitiesEndpoints
{
    public const string Route = "/api/runtime/capabilities";

    public static IEndpointRouteBuilder MapDeploymentCapabilitiesEndpoints(
        this IEndpointRouteBuilder routes)
    {
        routes.MapGet(Route, (DeploymentDescriptor deployment) =>
            Results.Ok(ToResponse(deployment)));
        return routes;
    }

    public static DeploymentCapabilitiesResponse ToResponse(DeploymentDescriptor deployment) =>
        new(
            DeploymentMode: deployment.Mode.ToString(),
            RequiresAuthentication: deployment.Capabilities.RequiresAuthentication,
            CanConfigureAiProvider: deployment.Capabilities.CanConfigureAiProvider,
            ManagedAi: deployment.Capabilities.ManagedAi,
            ManagedVoiceTranscription: deployment.Capabilities.ManagedVoiceTranscription,
            UsesCloudStorage: deployment.Capabilities.UsesCloudStorage,
            SupportsLocalBackupConfiguration: deployment.Capabilities.SupportsLocalBackupConfiguration,
            UsageMeteringAvailable: deployment.Capabilities.UsageMeteringAvailable);
}

public sealed record DeploymentCapabilitiesResponse(
    string DeploymentMode,
    bool RequiresAuthentication,
    bool CanConfigureAiProvider,
    bool ManagedAi,
    bool ManagedVoiceTranscription,
    bool UsesCloudStorage,
    bool SupportsLocalBackupConfiguration,
    bool UsageMeteringAvailable);
