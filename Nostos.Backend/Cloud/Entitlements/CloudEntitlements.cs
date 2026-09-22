using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Entitlements;

/// <summary>
/// Subscription lifecycle understood by Nostos itself. These values are not
/// payment-provider statuses and are intentionally stable across billing adapters.
/// </summary>
public enum CloudSubscriptionStatus
{
    None,
    Trial,
    Active,
    Grace,
    PastDue,
    Cancelled,
    Expired,
}

/// <summary>
/// Server-authoritative capabilities and limits attached to a subscription.
/// Limits are plan data, not usage counters; #405 owns metering and remaining
/// allowance calculations.
/// </summary>
public sealed record CloudEntitlementSet(
    bool CloudAccess,
    bool ManagedAiEnabled,
    long ManagedAiMonthlyAllowance,
    long StorageBytesLimit)
{
    public static CloudEntitlementSet None { get; } = new(
        CloudAccess: false,
        ManagedAiEnabled: false,
        ManagedAiMonthlyAllowance: 0,
        StorageBytesLimit: 0);
}

/// <summary>
/// Effective product-facing entitlement result. Plan identity is deliberately
/// absent: feature code consumes capabilities/limits instead of plan names.
/// </summary>
public sealed record CloudEntitlementSnapshot(
    CloudSubscriptionStatus SubscriptionStatus,
    bool CloudAccess,
    bool ManagedAiEnabled,
    long ManagedAiMonthlyAllowance,
    long StorageBytesLimit)
{
    public static CloudEntitlementSnapshot Denied(CloudSubscriptionStatus status) =>
        new(
            status,
            CloudAccess: false,
            ManagedAiEnabled: false,
            ManagedAiMonthlyAllowance: 0,
            StorageBytesLimit: 0);
}

public interface ICloudEntitlementService
{
    Task<CloudEntitlementSnapshot> GetEntitlementsAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Resolves entitlements only for the trusted account attached to the current
/// Cloud request. Callers cannot supply another account id.
/// </summary>
public sealed class CloudEntitlementService(
    ICloudTenantContextAccessor tenantContext,
    ICloudSubscriptionStore subscriptions) : ICloudEntitlementService
{
    public async Task<CloudEntitlementSnapshot> GetEntitlementsAsync(
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var subscription = await subscriptions.FindAsync(account.AccountId, cancellationToken);

        if (subscription is null)
            return CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.None);

        var now = DateTime.UtcNow;
        var effectiveStatus = subscription.Status switch
        {
            CloudSubscriptionStatus.Trial
                when subscription.TrialEndsAtUtc is { } trialEnd && trialEnd <= now
                => CloudSubscriptionStatus.Expired,

            CloudSubscriptionStatus.Grace
                when subscription.GraceEndsAtUtc is { } graceEnd && graceEnd <= now
                => CloudSubscriptionStatus.Expired,

            _ => subscription.Status,
        };

        if (effectiveStatus is not (
            CloudSubscriptionStatus.Active
            or CloudSubscriptionStatus.Trial
            or CloudSubscriptionStatus.Grace))
        {
            return CloudEntitlementSnapshot.Denied(effectiveStatus);
        }

        var configured = subscription.Entitlements;
        if (!configured.CloudAccess)
            return CloudEntitlementSnapshot.Denied(effectiveStatus);

        return new CloudEntitlementSnapshot(
            effectiveStatus,
            CloudAccess: true,
            ManagedAiEnabled: configured.ManagedAiEnabled,
            ManagedAiMonthlyAllowance: configured.ManagedAiMonthlyAllowance,
            StorageBytesLimit: configured.StorageBytesLimit);
    }
}
