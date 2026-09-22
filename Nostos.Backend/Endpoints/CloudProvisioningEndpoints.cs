using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Provisioning;
using Nostos.Backend.Security;

namespace Nostos.Backend.Endpoints;

public static class CloudProvisioningEndpoints
{
    public static IEndpointRouteBuilder MapCloudProvisioningEndpoints(
        this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/cloud/provisioning")
            .RequireAuthorization(CloudAuthPolicies.AuthenticatedAccount);

        group.MapGet("/", GetAsync);
        group.MapPost("/", ProvisionAsync);

        return routes;
    }

    private static async Task<IResult> GetAsync(
        ICloudTenantContextAccessor tenant,
        ICloudControlPlaneStore controlPlane,
        CancellationToken cancellationToken)
    {
        var account = tenant.GetRequired();
        var resource = await controlPlane.FindAsync(account.AccountId, cancellationToken);

        return Results.Ok(resource is null
            ? CloudProvisioningResponse.NotStarted
            : ToResponse(resource));
    }

    private static async Task<IResult> ProvisionAsync(
        ICloudTenantContextAccessor tenant,
        ICloudCustomerDatabaseProvisioner provisioner,
        CancellationToken cancellationToken)
    {
        var account = tenant.GetRequired();

        try
        {
            var result = await provisioner.ProvisionAsync(account.AccountId, cancellationToken);
            return Results.Ok(new CloudProvisioningResponse(
                State: result.State.ToString(),
                AccountState: result.AccountStatus.ToString(),
                SchemaVersion: result.SchemaVersion,
                Ready: result.Ready,
                Retryable: result.Retryable,
                FailureCode: null));
        }
        catch (CloudProvisioningException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Cloud account provisioning failed.",
                extensions: new Dictionary<string, object?>
                {
                    ["failureCode"] = exception.FailureCode,
                    ["retryable"] = true,
                });
        }
    }

    private static CloudProvisioningResponse ToResponse(CloudAccountResourceSnapshot resource) =>
        new(
            State: resource.ProvisioningState.ToString(),
            AccountState: resource.AccountStatus.ToString(),
            SchemaVersion: resource.SchemaVersion,
            Ready: resource.IsReady,
            Retryable: resource.ProvisioningState != CloudProvisioningState.Ready,
            FailureCode: resource.FailureCode);
}

public sealed record CloudProvisioningResponse(
    string State,
    string AccountState,
    string? SchemaVersion,
    bool Ready,
    bool Retryable,
    string? FailureCode)
{
    public static CloudProvisioningResponse NotStarted { get; } = new(
        State: "NotStarted",
        AccountState: CloudAccountStatus.Unknown.ToString(),
        SchemaVersion: null,
        Ready: false,
        Retryable: true,
        FailureCode: null);
}
