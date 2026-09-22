using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.ControlPlane;

/// <summary>
/// Stable Nostos-owned plan identity. Billing adapters map provider products or
/// price ids into this value; provider identifiers never become plan ids.
/// </summary>
public readonly record struct NostosPlanId
{
    public NostosPlanId(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var trimmed = value.Trim();

        if (trimmed.Length > 64)
            throw new ArgumentOutOfRangeException(nameof(value), "Nostos plan ids are limited to 64 characters.");

        Value = trimmed;
    }

    public string Value { get; }

    public override string ToString() => Value;
}

/// <summary>
/// Current commercial state for one Cloud account. Customer library databases
/// must never contain this state.
/// </summary>
public sealed class CloudSubscription
{
    public Guid AccountId { get; set; }
    public string PlanId { get; set; } = string.Empty;
    public CloudSubscriptionStatus Status { get; set; }
    public string EntitlementsJson { get; set; } = string.Empty;
    public DateTime? TrialEndsAtUtc { get; set; }
    public DateTime? GraceEndsAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}

/// <summary>
/// Immutable control-plane audit event for subscription/plan changes.
/// ReconciliationReference is an optional opaque id for a future billing
/// adapter; it is not part of product-facing entitlement APIs.
/// </summary>
public sealed class CloudSubscriptionAuditEvent
{
    public long Id { get; set; }
    public Guid AccountId { get; set; }
    public string PlanId { get; set; } = string.Empty;
    public CloudSubscriptionStatus Status { get; set; }
    public string EntitlementsJson { get; set; } = string.Empty;
    public DateTime? TrialEndsAtUtc { get; set; }
    public DateTime? GraceEndsAtUtc { get; set; }
    public string ChangeSource { get; set; } = string.Empty;
    public string? ReconciliationReference { get; set; }
    public DateTime ChangedAtUtc { get; set; }
}

public sealed record CloudSubscriptionSnapshot(
    NostosAccountId AccountId,
    NostosPlanId PlanId,
    CloudSubscriptionStatus Status,
    CloudEntitlementSet Entitlements,
    DateTime? TrialEndsAtUtc,
    DateTime? GraceEndsAtUtc,
    DateTime UpdatedAtUtc);

public sealed record CloudSubscriptionAuditSnapshot(
    long Id,
    NostosAccountId AccountId,
    NostosPlanId PlanId,
    CloudSubscriptionStatus Status,
    CloudEntitlementSet Entitlements,
    DateTime? TrialEndsAtUtc,
    DateTime? GraceEndsAtUtc,
    string ChangeSource,
    string? ReconciliationReference,
    DateTime ChangedAtUtc);

public sealed record CloudSubscriptionChange(
    NostosPlanId PlanId,
    CloudSubscriptionStatus Status,
    CloudEntitlementSet Entitlements,
    DateTime? TrialEndsAtUtc,
    DateTime? GraceEndsAtUtc,
    string ChangeSource,
    string? ReconciliationReference = null)
{
    public void Validate()
    {
        if (Status is CloudSubscriptionStatus.None)
            throw new ArgumentException("None is an effective no-subscription state and cannot be persisted.", nameof(Status));

        if (Entitlements.ManagedAiMonthlyAllowance < 0)
            throw new ArgumentOutOfRangeException(nameof(Entitlements), "Managed AI allowance cannot be negative.");

        if (Entitlements.StorageBytesLimit < 0)
            throw new ArgumentOutOfRangeException(nameof(Entitlements), "Storage allowance cannot be negative.");

        if (Status == CloudSubscriptionStatus.Trial && TrialEndsAtUtc is null)
            throw new ArgumentException("Trial subscriptions require TrialEndsAtUtc.", nameof(TrialEndsAtUtc));

        if (Status == CloudSubscriptionStatus.Grace && GraceEndsAtUtc is null)
            throw new ArgumentException("Grace subscriptions require GraceEndsAtUtc.", nameof(GraceEndsAtUtc));

        ArgumentException.ThrowIfNullOrWhiteSpace(ChangeSource);

        if (ChangeSource.Trim().Length > 64)
            throw new ArgumentOutOfRangeException(nameof(ChangeSource), "Change source is limited to 64 characters.");

        if (ReconciliationReference?.Length > 160)
        {
            throw new ArgumentOutOfRangeException(
                nameof(ReconciliationReference),
                "Reconciliation reference is limited to 160 characters.");
        }

        EnsureUtc(TrialEndsAtUtc, nameof(TrialEndsAtUtc));
        EnsureUtc(GraceEndsAtUtc, nameof(GraceEndsAtUtc));
    }

    private static void EnsureUtc(DateTime? value, string parameterName)
    {
        if (value is { Kind: not DateTimeKind.Utc })
            throw new ArgumentException("Lifecycle timestamps must be UTC.", parameterName);
    }
}
