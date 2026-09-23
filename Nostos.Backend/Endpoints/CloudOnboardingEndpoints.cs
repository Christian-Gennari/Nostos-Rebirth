using Nostos.Backend.Cloud.Onboarding;
using Nostos.Backend.Security;

namespace Nostos.Backend.Endpoints;

public static class CloudOnboardingEndpoints
{
    public static IEndpointRouteBuilder MapCloudOnboardingEndpoints(
        this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/cloud/onboarding")
            .RequireAuthorization(CloudAuthPolicies.AuthenticatedAccount);

        group.MapGet("/", async (
            ICloudOnboardingService onboarding,
            CancellationToken cancellationToken) =>
            Results.Ok(await onboarding.GetStateAsync(cancellationToken)));

        group.MapPost("/provision", async (
            ICloudOnboardingService onboarding,
            CancellationToken cancellationToken) =>
            await RunAsync(() => onboarding.ProvisionAsync(cancellationToken)));

        group.MapPost("/checkout", async (
            ICloudOnboardingService onboarding,
            CancellationToken cancellationToken) =>
            await RunAsync(() => onboarding.CreateCheckoutAsync(cancellationToken)));

        group.MapPost("/reconcile", async (
            ICloudOnboardingService onboarding,
            CancellationToken cancellationToken) =>
            await RunAsync(() => onboarding.ReconcileSubscriptionAsync(cancellationToken)));

        group.MapPost("/billing-portal", async (
            ICloudOnboardingService onboarding,
            CancellationToken cancellationToken) =>
            await RunAsync(() => onboarding.CreateBillingPortalAsync(cancellationToken)));

        return routes;
    }

    private static async Task<IResult> RunAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return Results.Ok(await action());
        }
        catch (CloudOnboardingActionException exception)
        {
            return Results.Json(
                new
                {
                    error = exception.Code,
                    message = exception.Message,
                },
                statusCode: exception.StatusCode);
        }
    }
}
