using Nostos.Backend.Cloud.Billing;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Cloud.Provisioning;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Onboarding;

public static class CloudOnboardingStates
{
    public const string SubscriptionRequired = "subscription_required";
    public const string SubscriptionPending = "subscription_pending";
    public const string SubscriptionInactive = "subscription_inactive";
    public const string ReadyToProvision = "ready_to_provision";
    public const string Provisioning = "provisioning";
    public const string ProvisioningFailed = "provisioning_failed";
    public const string Ready = "ready";
    public const string AccountUnavailable = "account_unavailable";
}

public sealed record CloudOnboardingSnapshot(
    string State,
    string? SubscriptionStatus,
    bool Ready,
    bool CanCheckout,
    bool CanCheckSubscription,
    bool CanManageSubscription,
    bool CanRetry);

public sealed record CloudOnboardingRedirectResponse(string Url);

public sealed class CloudOnboardingActionException(
    string code,
    string message,
    int statusCode,
    Exception? innerException = null)
    : InvalidOperationException(message, innerException)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

public interface ICloudOnboardingService
{
    Task<CloudOnboardingSnapshot> GetStateAsync(
        CancellationToken cancellationToken = default);

    Task<CloudOnboardingSnapshot> ProvisionAsync(
        CancellationToken cancellationToken = default);

    Task<CloudOnboardingRedirectResponse> CreateCheckoutAsync(
        CancellationToken cancellationToken = default);

    Task<CloudOnboardingSnapshot> ReconcileSubscriptionAsync(
        CancellationToken cancellationToken = default);

    Task<CloudOnboardingRedirectResponse> CreateBillingPortalAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Product-level Cloud entry orchestration.
///
/// This service deliberately composes the existing authentication, entitlement,
/// billing, provisioning and control-plane boundaries. It never accepts an
/// account id, database name, storage namespace or provider identifier from the
/// browser, and it never returns infrastructure identifiers.
/// </summary>
public sealed class CloudOnboardingService(
    ICloudTenantContextAccessor tenantContext,
    ICloudControlPlaneStore controlPlane,
    ICloudEntitlementService entitlements,
    ICloudCustomerDatabaseProvisioner provisioner,
    ICloudBillingService billing,
    ICloudBillingStateStore billingState,
    CloudBillingOptions billingOptions,
    ILogger<CloudOnboardingService> logger)
    : ICloudOnboardingService
{
    public async Task<CloudOnboardingSnapshot> GetStateAsync(
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var resource = await controlPlane.FindAsync(account.AccountId, cancellationToken);

        if (resource?.AccountStatus is CloudAccountStatus.Disabled or CloudAccountStatus.Deleted)
            return AccountUnavailable();

        var entitlement = await entitlements.GetEntitlementsAsync(cancellationToken);
        var binding = await billingState.FindAsync(account.AccountId, cancellationToken);

        if (!entitlement.CloudAccess)
            return SubscriptionState(entitlement, binding);

        if (resource is null)
            return ReadyToProvision(entitlement);

        if (resource.AccountStatus is CloudAccountStatus.Disabled or CloudAccountStatus.Deleted)
            return AccountUnavailable(entitlement.SubscriptionStatus);

        if (resource.IsReady)
            return Ready(entitlement.SubscriptionStatus);

        return resource.ProvisioningState switch
        {
            CloudProvisioningState.Provisioning => Provisioning(entitlement.SubscriptionStatus),
            CloudProvisioningState.Failed => ProvisioningFailed(entitlement.SubscriptionStatus),
            CloudProvisioningState.Pending => ReadyToProvision(entitlement),
            CloudProvisioningState.Ready => ReadyToProvision(entitlement),
            _ => ReadyToProvision(entitlement),
        };
    }

    public async Task<CloudOnboardingSnapshot> ProvisionAsync(
        CancellationToken cancellationToken = default)
    {
        var current = await GetStateAsync(cancellationToken);

        if (current.State is CloudOnboardingStates.Ready
            or CloudOnboardingStates.SubscriptionRequired
            or CloudOnboardingStates.SubscriptionPending
            or CloudOnboardingStates.SubscriptionInactive
            or CloudOnboardingStates.AccountUnavailable)
        {
            return current;
        }

        var account = tenantContext.GetRequired();

        try
        {
            // Provisioning is server-owned work. Do not bind its lifetime to
            // RequestAborted: a browser refresh or dropped connection must not
            // turn an otherwise healthy provisioning run into a failed account.
            await provisioner.ProvisionAsync(account.AccountId, CancellationToken.None);
        }
        catch (CloudProvisioningException exception)
        {
            logger.LogWarning(
                exception,
                "Cloud onboarding provisioning failed for account {AccountId} with bounded code {FailureCode}.",
                account.AccountId,
                exception.FailureCode);
        }

        return await GetStateAsync(cancellationToken);
    }

    public async Task<CloudOnboardingRedirectResponse> CreateCheckoutAsync(
        CancellationToken cancellationToken = default)
    {
        var state = await GetStateAsync(cancellationToken);
        if (state.State != CloudOnboardingStates.SubscriptionRequired || !state.CanCheckout)
        {
            throw new CloudOnboardingActionException(
                "checkout_not_available",
                "Checkout is not available for this account right now. Refresh your subscription status and try again.",
                StatusCodes.Status409Conflict);
        }

        var launchPlans = billingOptions.Plans
            .Where(plan => plan.CloudAccess)
            .ToList();

        if (launchPlans.Count != 1)
        {
            logger.LogError(
                "Cloud onboarding expected exactly one configured launch plan with CloudAccess; found {PlanCount}.",
                launchPlans.Count);

            throw new CloudOnboardingActionException(
                "checkout_unavailable",
                "Cloud checkout is temporarily unavailable.",
                StatusCodes.Status503ServiceUnavailable);
        }

        try
        {
            var result = await billing.CreateCheckoutAsync(
                new NostosPlanId(launchPlans[0].PlanId),
                cancellationToken);

            return new CloudOnboardingRedirectResponse(result.CheckoutUrl);
        }
        catch (PaddleApiException exception)
        {
            logger.LogWarning(exception, "Cloud onboarding checkout provider request failed.");
            throw new CloudOnboardingActionException(
                "billing_unavailable",
                "Checkout is temporarily unavailable. Try again.",
                StatusCodes.Status503ServiceUnavailable,
                exception);
        }
        catch (InvalidOperationException exception)
        {
            logger.LogWarning(exception, "Cloud onboarding could not create checkout.");
            throw new CloudOnboardingActionException(
                "checkout_not_available",
                "Checkout is not available for this account right now. Refresh your subscription status and try again.",
                StatusCodes.Status409Conflict,
                exception);
        }
    }

    public async Task<CloudOnboardingSnapshot> ReconcileSubscriptionAsync(
        CancellationToken cancellationToken = default)
    {
        try
        {
            await billing.ReconcileCurrentAsync(cancellationToken);
        }
        catch (PaddleApiException exception)
        {
            logger.LogWarning(exception, "Cloud onboarding subscription reconciliation failed.");
            throw new CloudOnboardingActionException(
                "billing_unavailable",
                "We couldn't check your subscription right now. Try again.",
                StatusCodes.Status503ServiceUnavailable,
                exception);
        }

        return await GetStateAsync(cancellationToken);
    }

    public async Task<CloudOnboardingRedirectResponse> CreateBillingPortalAsync(
        CancellationToken cancellationToken = default)
    {
        var state = await GetStateAsync(cancellationToken);
        if (!state.CanManageSubscription)
        {
            throw new CloudOnboardingActionException(
                "billing_portal_not_available",
                "Subscription management is not available for this account yet.",
                StatusCodes.Status409Conflict);
        }

        try
        {
            var result = await billing.CreateManagementSessionAsync(cancellationToken);
            return new CloudOnboardingRedirectResponse(result.Url);
        }
        catch (PaddleApiException exception)
        {
            logger.LogWarning(exception, "Cloud onboarding billing portal request failed.");
            throw new CloudOnboardingActionException(
                "billing_unavailable",
                "Subscription management is temporarily unavailable. Try again.",
                StatusCodes.Status503ServiceUnavailable,
                exception);
        }
        catch (InvalidOperationException exception)
        {
            logger.LogWarning(exception, "Cloud onboarding could not open the billing portal.");
            throw new CloudOnboardingActionException(
                "billing_portal_not_available",
                "Subscription management is not available for this account yet.",
                StatusCodes.Status409Conflict,
                exception);
        }
    }

    private static CloudOnboardingSnapshot SubscriptionState(
        CloudEntitlementSnapshot entitlement,
        CloudBillingBindingSnapshot? binding)
    {
        var hasCheckout = !string.IsNullOrWhiteSpace(binding?.ExternalTransactionId);
        var hasSubscription = !string.IsNullOrWhiteSpace(binding?.ExternalSubscriptionId);

        if (entitlement.SubscriptionStatus == CloudSubscriptionStatus.None)
        {
            return new CloudOnboardingSnapshot(
                State: hasCheckout
                    ? CloudOnboardingStates.SubscriptionPending
                    : CloudOnboardingStates.SubscriptionRequired,
                SubscriptionStatus: entitlement.SubscriptionStatus.ToString(),
                Ready: false,
                CanCheckout: !hasCheckout,
                CanCheckSubscription: hasCheckout,
                CanManageSubscription: hasSubscription,
                CanRetry: false);
        }

        return new CloudOnboardingSnapshot(
            State: CloudOnboardingStates.SubscriptionInactive,
            SubscriptionStatus: entitlement.SubscriptionStatus.ToString(),
            Ready: false,
            CanCheckout: false,
            CanCheckSubscription: hasCheckout || hasSubscription,
            CanManageSubscription: hasSubscription,
            CanRetry: false);
    }

    private static CloudOnboardingSnapshot ReadyToProvision(
        CloudEntitlementSnapshot entitlement) =>
        new(
            State: CloudOnboardingStates.ReadyToProvision,
            SubscriptionStatus: entitlement.SubscriptionStatus.ToString(),
            Ready: false,
            CanCheckout: false,
            CanCheckSubscription: false,
            CanManageSubscription: false,
            CanRetry: true);

    private static CloudOnboardingSnapshot Provisioning(
        CloudSubscriptionStatus status) =>
        new(
            State: CloudOnboardingStates.Provisioning,
            SubscriptionStatus: status.ToString(),
            Ready: false,
            CanCheckout: false,
            CanCheckSubscription: false,
            CanManageSubscription: false,
            CanRetry: false);

    private static CloudOnboardingSnapshot ProvisioningFailed(
        CloudSubscriptionStatus status) =>
        new(
            State: CloudOnboardingStates.ProvisioningFailed,
            SubscriptionStatus: status.ToString(),
            Ready: false,
            CanCheckout: false,
            CanCheckSubscription: false,
            CanManageSubscription: false,
            CanRetry: true);

    private static CloudOnboardingSnapshot Ready(
        CloudSubscriptionStatus status) =>
        new(
            State: CloudOnboardingStates.Ready,
            SubscriptionStatus: status.ToString(),
            Ready: true,
            CanCheckout: false,
            CanCheckSubscription: false,
            CanManageSubscription: false,
            CanRetry: false);

    private static CloudOnboardingSnapshot AccountUnavailable(
        CloudSubscriptionStatus? status = null) =>
        new(
            State: CloudOnboardingStates.AccountUnavailable,
            SubscriptionStatus: status?.ToString(),
            Ready: false,
            CanCheckout: false,
            CanCheckSubscription: false,
            CanManageSubscription: false,
            CanRetry: false);
}
