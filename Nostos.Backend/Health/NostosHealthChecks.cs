using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;

namespace Nostos.Backend.Health;

public static class NostosHealthCheckTags
{
    public const string Readiness = "ready";
}

public static class NostosHealthRegistration
{
    public static IServiceCollection AddNostosHealthChecks(
        this IServiceCollection services,
        DeploymentDescriptor deployment)
    {
        var checks = services.AddHealthChecks();

        if (deployment.Mode == DeploymentMode.SelfHosted)
        {
            checks.AddCheck<SelfHostedDatabaseReadinessCheck>(
                "sqlite",
                tags: [NostosHealthCheckTags.Readiness]);
        }
        else
        {
            checks.AddCheck<CloudControlPlaneReadinessCheck>(
                "control-plane",
                tags: [NostosHealthCheckTags.Readiness]);
            checks.AddCheck<CloudObjectStorageReadinessCheck>(
                "object-storage",
                tags: [NostosHealthCheckTags.Readiness]);
        }

        return services;
    }
}

public sealed class SelfHostedDatabaseReadinessCheck(
    IDbContextFactory<NostosDbContext> contexts) : IHealthCheck
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
                : HealthCheckResult.Unhealthy("database_unavailable");
        }
        catch
        {
            return HealthCheckResult.Unhealthy("database_unavailable");
        }
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

public static class NostosHealthResponseWriter
{
    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json";
        var status = report.Status == HealthStatus.Healthy ? "ok" : "unavailable";
        return context.Response.WriteAsync(
            JsonSerializer.Serialize(new { status }),
            context.RequestAborted);
    }
}
