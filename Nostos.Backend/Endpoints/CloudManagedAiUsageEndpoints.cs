using Nostos.Backend.Security;
using Nostos.Backend.Services.Ai;

namespace Nostos.Backend.Endpoints;

/// <summary>
/// Small product-level usage contract for Cloud Settings. It deliberately does
/// not expose provider credentials, token ledgers, model debugging, or raw cost.
/// </summary>
public static class CloudManagedAiUsageEndpoints
{
    public const string Route = "/api/cloud/ai/usage";

    public static IEndpointRouteBuilder MapCloudManagedAiUsageEndpoints(
        this IEndpointRouteBuilder routes)
    {
        routes.MapGet(Route, GetUsageAsync)
            .RequireAuthorization(CloudAuthPolicies.AuthenticatedAccount);
        return routes;
    }

    private static async Task<IResult> GetUsageAsync(
        IManagedAiUsageService usage,
        CancellationToken cancellationToken)
    {
        var status = await usage.GetStatusAsync(cancellationToken);
        return Results.Ok(new CloudManagedAiUsageResponse(
            status.State,
            status.RenewsAtUtc));
    }

    public sealed record CloudManagedAiUsageResponse(
        string State,
        DateTime? RenewsAtUtc);
}
