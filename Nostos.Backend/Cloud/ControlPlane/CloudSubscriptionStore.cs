using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.ControlPlane;

public interface ICloudSubscriptionStore
{
    Task<CloudSubscriptionSnapshot?> FindAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task ApplyChangeAsync(
        NostosAccountId accountId,
        CloudSubscriptionChange change,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CloudSubscriptionAuditSnapshot>> ListAuditAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Persists current subscription state and its immutable audit trail in the
/// Cloud control plane. No payment secrets or customer library content are
/// stored here.
/// </summary>
public sealed class CloudSubscriptionStore(
    IDbContextFactory<CloudControlPlaneDbContext> factory) : ICloudSubscriptionStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<CloudSubscriptionSnapshot?> FindAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var row = await db.Subscriptions
            .AsNoTracking()
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        return row is null ? null : Snapshot(row);
    }

    public async Task ApplyChangeAsync(
        NostosAccountId accountId,
        CloudSubscriptionChange change,
        CancellationToken cancellationToken = default)
    {
        change.Validate();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);

        if (!await db.AccountResources.AnyAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken))
        {
            throw new InvalidOperationException(
                $"Cloud account '{accountId}' has no control-plane resource mapping.");
        }

        var now = DateTime.UtcNow;
        var entitlementsJson = Serialize(change.Entitlements);
        var current = await db.Subscriptions
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        if (current is null)
        {
            current = new CloudSubscription
            {
                AccountId = accountId.Value,
            };
            db.Subscriptions.Add(current);
        }

        current.PlanId = change.PlanId.Value;
        current.Status = change.Status;
        current.EntitlementsJson = entitlementsJson;
        current.TrialEndsAtUtc = change.TrialEndsAtUtc;
        current.GraceEndsAtUtc = change.GraceEndsAtUtc;
        current.UpdatedAtUtc = now;

        db.SubscriptionAudit.Add(new CloudSubscriptionAuditEvent
        {
            AccountId = accountId.Value,
            PlanId = change.PlanId.Value,
            Status = change.Status,
            EntitlementsJson = entitlementsJson,
            TrialEndsAtUtc = change.TrialEndsAtUtc,
            GraceEndsAtUtc = change.GraceEndsAtUtc,
            ChangeSource = change.ChangeSource.Trim(),
            ReconciliationReference = string.IsNullOrWhiteSpace(change.ReconciliationReference)
                ? null
                : change.ReconciliationReference.Trim(),
            ChangedAtUtc = now,
        });

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<CloudSubscriptionAuditSnapshot>> ListAuditAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var rows = await db.SubscriptionAudit
            .AsNoTracking()
            .Where(x => x.AccountId == accountId.Value)
            .OrderBy(x => x.ChangedAtUtc)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(AuditSnapshot).ToList();
    }

    private static CloudSubscriptionSnapshot Snapshot(CloudSubscription row) =>
        new(
            new NostosAccountId(row.AccountId),
            new NostosPlanId(row.PlanId),
            row.Status,
            Deserialize(row.EntitlementsJson),
            Utc(row.TrialEndsAtUtc),
            Utc(row.GraceEndsAtUtc),
            Utc(row.UpdatedAtUtc));

    private static CloudSubscriptionAuditSnapshot AuditSnapshot(CloudSubscriptionAuditEvent row) =>
        new(
            row.Id,
            new NostosAccountId(row.AccountId),
            new NostosPlanId(row.PlanId),
            row.Status,
            Deserialize(row.EntitlementsJson),
            Utc(row.TrialEndsAtUtc),
            Utc(row.GraceEndsAtUtc),
            row.ChangeSource,
            row.ReconciliationReference,
            Utc(row.ChangedAtUtc));

    private static string Serialize(CloudEntitlementSet entitlements) =>
        JsonSerializer.Serialize(entitlements, JsonOptions);

    private static CloudEntitlementSet Deserialize(string json) =>
        JsonSerializer.Deserialize<CloudEntitlementSet>(json, JsonOptions)
        ?? throw new InvalidOperationException("Control-plane entitlement JSON is invalid.");

    private static DateTime Utc(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static DateTime? Utc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
}
