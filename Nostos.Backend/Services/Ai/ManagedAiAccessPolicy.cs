using Nostos.Backend.Cloud.Entitlements;

namespace Nostos.Backend.Services.Ai;

public interface IManagedAiAccessPolicy
{
    Task<bool> IsAllowedAsync(CancellationToken ct = default);
}

/// <summary>SelfHosted remains BYOK and never requires a Nostos subscription.</summary>
public sealed class SelfHostedManagedAiAccessPolicy : IManagedAiAccessPolicy
{
    public Task<bool> IsAllowedAsync(CancellationToken ct = default) => Task.FromResult(true);
}

/// <summary>
/// Cloud consults #403's effective entitlement. Monthly consumption and rate
/// limits deliberately remain #405; a zero allowance is not interpreted here.
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
