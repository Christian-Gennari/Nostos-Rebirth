using Nostos.Backend.Cloud.Billing;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;

namespace Nostos.Backend.Endpoints;

public static class CloudBillingEndpoints
{
    public static IEndpointRouteBuilder MapCloudBillingEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/cloud/billing")
            .RequireAuthorization(CloudAuthPolicies.AuthenticatedAccount);

        group.MapPost("/checkout", CreateCheckoutAsync);
        group.MapPost("/change-plan", ChangePlanAsync);
        group.MapPost("/cancel", CancelAsync);
        group.MapPost("/portal", CreatePortalAsync);
        group.MapPost("/reconcile", ReconcileAsync);

        routes.MapPost("/api/cloud/billing/webhooks/paddle", HandlePaddleWebhookAsync)
            .AllowAnonymous();

        return routes;
    }

    private static async Task<IResult> CreateCheckoutAsync(
        CloudBillingPlanRequest request,
        ICloudBillingService billing,
        CancellationToken cancellationToken)
    {
        if (!TryPlanId(request.PlanId, out var planId, out var error))
            return Results.BadRequest(new { error });

        try
        {
            return Results.Ok(await billing.CreateCheckoutAsync(planId, cancellationToken));
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(new { error = exception.Message });
        }
        catch (PaddleApiException exception)
        {
            return ProviderFailure(exception);
        }
    }

    private static async Task<IResult> ChangePlanAsync(
        CloudBillingPlanRequest request,
        ICloudBillingService billing,
        CancellationToken cancellationToken)
    {
        if (!TryPlanId(request.PlanId, out var planId, out var error))
            return Results.BadRequest(new { error });

        try
        {
            return Results.Ok(await billing.ChangePlanAsync(planId, cancellationToken));
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(new { error = exception.Message });
        }
        catch (PaddleApiException exception)
        {
            return ProviderFailure(exception);
        }
    }

    private static async Task<IResult> CancelAsync(
        ICloudBillingService billing,
        CancellationToken cancellationToken)
    {
        try
        {
            return Results.Ok(await billing.CancelAsync(cancellationToken));
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(new { error = exception.Message });
        }
        catch (PaddleApiException exception)
        {
            return ProviderFailure(exception);
        }
    }

    private static async Task<IResult> CreatePortalAsync(
        ICloudBillingService billing,
        CancellationToken cancellationToken)
    {
        try
        {
            return Results.Ok(await billing.CreateManagementSessionAsync(cancellationToken));
        }
        catch (InvalidOperationException exception)
        {
            return Results.Conflict(new { error = exception.Message });
        }
        catch (PaddleApiException exception)
        {
            return ProviderFailure(exception);
        }
    }

    private static async Task<IResult> ReconcileAsync(
        ICloudBillingService billing,
        CancellationToken cancellationToken)
    {
        try
        {
            await billing.ReconcileCurrentAsync(cancellationToken);
            return Results.NoContent();
        }
        catch (PaddleApiException exception)
        {
            return ProviderFailure(exception);
        }
    }

    private static async Task<IResult> HandlePaddleWebhookAsync(
        HttpRequest request,
        ICloudBillingWebhookProcessor processor,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var signature = request.Headers["Paddle-Signature"].ToString();
        using var reader = new StreamReader(request.Body);
        var rawBody = await reader.ReadToEndAsync(cancellationToken);

        try
        {
            var outcome = await processor.ProcessAsync(
                rawBody,
                signature,
                cancellationToken);

            return Results.Ok(new
            {
                accepted = true,
                outcome = outcome?.ToString() ?? "Ignored",
            });
        }
        catch (PaddleWebhookSignatureException)
        {
            loggerFactory
                .CreateLogger("Nostos.Cloud.Billing.PaddleWebhook")
                .LogWarning("Rejected Paddle webhook with an invalid or expired signature.");
            return Results.Unauthorized();
        }
        catch (InvalidOperationException exception)
        {
            loggerFactory
                .CreateLogger("Nostos.Cloud.Billing.PaddleWebhook")
                .LogError(exception, "Verified Paddle webhook could not be reconciled.");
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static bool TryPlanId(
        string? value,
        out NostosPlanId planId,
        out string error)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            planId = default;
            error = "planId is required.";
            return false;
        }

        try
        {
            planId = new NostosPlanId(value);
            error = string.Empty;
            return true;
        }
        catch (ArgumentException)
        {
            planId = default;
            error = "planId is invalid.";
            return false;
        }
    }

    private static IResult ProviderFailure(PaddleApiException exception) =>
        Results.Problem(
            statusCode: StatusCodes.Status502BadGateway,
            title: "Billing provider request failed.",
            extensions: exception.RequestId is null
                ? null
                : new Dictionary<string, object?>
                {
                    ["providerRequestId"] = exception.RequestId,
                });
}

public sealed record CloudBillingPlanRequest(string PlanId);
