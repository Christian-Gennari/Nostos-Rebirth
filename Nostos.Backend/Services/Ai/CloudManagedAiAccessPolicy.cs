using Nostos.Backend.Cloud.Entitlements;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Official Cloud consults the hosted entitlement implementation. The public
/// product contract and SelfHosted policy live in Nostos.Product.
/// </summary>
public sealed class CloudManagedAiAccessPolicy(ICloudEntitlementService entitlements)
    : IManagedAiAccessPolicy
{
    public async Task<bool> IsAllowedAsync(CancellationToken ct = default)
    {
        var snapshot = await entitlements.GetEntitlementsAsync(ct);
        return snapshot.CloudAccess && snapshot.ManagedAiEnabled;
    }
}
