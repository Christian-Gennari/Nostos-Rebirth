using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Storage;

namespace Nostos.Backend.Health;

public static class NostosCloudHealthRegistration
{
    public static IServiceCollection AddNostosCloudHealthChecks(this IServiceCollection services)
    {
        services.AddHealthChecks()
            .AddCheck<CloudControlPlaneReadinessCheck>(
                "control-plane",
                tags: [NostosHealthCheckTags.Readiness])
            .AddCheck<CloudObjectStorageReadinessCheck>(
                "object-storage",
                tags: [NostosHealthCheckTags.Readiness]);

        return services;
    }
}

public sealed class CloudControlPlaneReadinessCheck(
    IDbContextFactory<CloudControlPlaneDbContext> contexts) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var db = await contexts.CreateDbContextAsync(cancellationToken);
            return await db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("control_plane_unavailable");
        }
        catch
        {
            return HealthCheckResult.Unhealthy("control_plane_unavailable");
        }
    }
}

public sealed class CloudObjectStorageReadinessCheck(
    ICloudObjectStorageBootstrapper storage) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await storage.EnsureReadyAsync(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch
        {
            return HealthCheckResult.Unhealthy("object_storage_unavailable");
        }
    }
}
