using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Billing;

public sealed class CloudBillingBinding
{
    public Guid AccountId { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string? ExternalTransactionId { get; set; }
    public string? ExternalCustomerId { get; set; }
    public string? ExternalSubscriptionId { get; set; }
    public DateTime? LastEventOccurredAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}

public sealed class CloudBillingEventReceipt
{
    public string Provider { get; set; } = string.Empty;
    public string EventId { get; set; } = string.Empty;
    public Guid AccountId { get; set; }
    public string? ExternalSubscriptionId { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    public string Outcome { get; set; } = string.Empty;
    public DateTime ProcessedAtUtc { get; set; }
}

public sealed record CloudBillingBindingSnapshot(
    NostosAccountId AccountId,
    string Provider,
    string? ExternalTransactionId,
    string? ExternalCustomerId,
    string? ExternalSubscriptionId,
    DateTime? LastEventOccurredAtUtc,
    DateTime UpdatedAtUtc);

public enum CloudBillingReconciliationOutcome
{
    Applied,
    Duplicate,
    IgnoredStale,
}

public interface ICloudBillingStateStore
{
    Task<CloudBillingBindingSnapshot?> FindAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task<CloudBillingBindingSnapshot?> FindBySubscriptionAsync(
        string provider,
        string externalSubscriptionId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CloudBillingBindingSnapshot>> ListAsync(
        string provider,
        CancellationToken cancellationToken = default);

    Task SaveCheckoutAsync(
        NostosAccountId accountId,
        string provider,
        string externalTransactionId,
        CancellationToken cancellationToken = default);

    Task<CloudBillingReconciliationOutcome> ApplyProviderEventAsync(
        NostosAccountId accountId,
        string provider,
        string eventId,
        DateTime occurredAtUtc,
        string? externalTransactionId,
        string? externalCustomerId,
        string externalSubscriptionId,
        CloudSubscriptionChange change,
        CancellationToken cancellationToken = default);
}

public sealed class CloudBillingStateStore(
    IDbContextFactory<CloudControlPlaneDbContext> factory) : ICloudBillingStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<CloudBillingBindingSnapshot?> FindAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var row = await db.BillingBindings
            .AsNoTracking()
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        return row is null ? null : Snapshot(row);
    }

    public async Task<CloudBillingBindingSnapshot?> FindBySubscriptionAsync(
        string provider,
        string externalSubscriptionId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var row = await db.BillingBindings
            .AsNoTracking()
            .SingleOrDefaultAsync(
                x => x.Provider == provider && x.ExternalSubscriptionId == externalSubscriptionId,
                cancellationToken);

        return row is null ? null : Snapshot(row);
    }

    public async Task<IReadOnlyList<CloudBillingBindingSnapshot>> ListAsync(
        string provider,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var rows = await db.BillingBindings
            .AsNoTracking()
            .Where(x => x.Provider == provider)
            .OrderBy(x => x.AccountId)
            .ToListAsync(cancellationToken);

        return rows.Select(Snapshot).ToList();
    }

    public async Task SaveCheckoutAsync(
        NostosAccountId accountId,
        string provider,
        string externalTransactionId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);

        if (!await db.AccountResources.AnyAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken))
        {
            throw new InvalidOperationException(
                $"Cloud account '{accountId}' has no control-plane resource mapping.");
        }

        var row = await db.BillingBindings
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        if (row is null)
        {
            row = new CloudBillingBinding
            {
                AccountId = accountId.Value,
                Provider = provider,
            };
            db.BillingBindings.Add(row);
        }
        else if (!string.Equals(row.Provider, provider, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Cloud account '{accountId}' is already bound to billing provider '{row.Provider}'.");
        }

        row.ExternalTransactionId = externalTransactionId;
        row.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<CloudBillingReconciliationOutcome> ApplyProviderEventAsync(
        NostosAccountId accountId,
        string provider,
        string eventId,
        DateTime occurredAtUtc,
        string? externalTransactionId,
        string? externalCustomerId,
        string externalSubscriptionId,
        CloudSubscriptionChange change,
        CancellationToken cancellationToken = default)
    {
        change.Validate();

        if (occurredAtUtc.Kind != DateTimeKind.Utc)
            throw new ArgumentException("Billing event timestamps must be UTC.", nameof(occurredAtUtc));

        ArgumentException.ThrowIfNullOrWhiteSpace(provider);
        ArgumentException.ThrowIfNullOrWhiteSpace(eventId);
        ArgumentException.ThrowIfNullOrWhiteSpace(externalSubscriptionId);

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        if (await db.BillingEvents.AnyAsync(
            x => x.Provider == provider && x.EventId == eventId,
            cancellationToken))
        {
            await transaction.CommitAsync(cancellationToken);
            return CloudBillingReconciliationOutcome.Duplicate;
        }

        if (!await db.AccountResources.AnyAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken))
        {
            throw new InvalidOperationException(
                $"Cloud account '{accountId}' has no control-plane resource mapping.");
        }

        var now = DateTime.UtcNow;
        var binding = await db.BillingBindings
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        if (binding is null)
        {
            binding = new CloudBillingBinding
            {
                AccountId = accountId.Value,
                Provider = provider,
            };
            db.BillingBindings.Add(binding);
        }
        else if (!string.Equals(binding.Provider, provider, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Cloud account '{accountId}' is already bound to billing provider '{binding.Provider}'.");
        }

        var conflicting = await db.BillingBindings
            .AsNoTracking()
            .AnyAsync(
                x => x.Provider == provider
                    && x.ExternalSubscriptionId == externalSubscriptionId
                    && x.AccountId != accountId.Value,
                cancellationToken);
        if (conflicting)
        {
            throw new InvalidOperationException(
                "A billing subscription cannot be reconciled into more than one Nostos account.");
        }

        if (binding.LastEventOccurredAtUtc is { } last
            && occurredAtUtc < DateTime.SpecifyKind(last, DateTimeKind.Utc))
        {
            db.BillingEvents.Add(Receipt(
                provider,
                eventId,
                accountId,
                externalSubscriptionId,
                occurredAtUtc,
                CloudBillingReconciliationOutcome.IgnoredStale,
                now));

            await SaveAndCommitAsync(db, transaction, provider, eventId, cancellationToken);
            return CloudBillingReconciliationOutcome.IgnoredStale;
        }

        binding.ExternalTransactionId = externalTransactionId ?? binding.ExternalTransactionId;
        binding.ExternalCustomerId = externalCustomerId ?? binding.ExternalCustomerId;
        binding.ExternalSubscriptionId = externalSubscriptionId;
        binding.LastEventOccurredAtUtc = occurredAtUtc;
        binding.UpdatedAtUtc = now;

        var entitlementsJson = JsonSerializer.Serialize(change.Entitlements, JsonOptions);
        var subscription = await db.Subscriptions
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        if (subscription is null)
        {
            subscription = new CloudSubscription { AccountId = accountId.Value };
            db.Subscriptions.Add(subscription);
        }

        subscription.PlanId = change.PlanId.Value;
        subscription.Status = change.Status;
        subscription.EntitlementsJson = entitlementsJson;
        subscription.TrialEndsAtUtc = change.TrialEndsAtUtc;
        subscription.GraceEndsAtUtc = change.GraceEndsAtUtc;
        subscription.UpdatedAtUtc = now;

        db.SubscriptionAudit.Add(new CloudSubscriptionAuditEvent
        {
            AccountId = accountId.Value,
            PlanId = change.PlanId.Value,
            Status = change.Status,
            EntitlementsJson = entitlementsJson,
            TrialEndsAtUtc = change.TrialEndsAtUtc,
            GraceEndsAtUtc = change.GraceEndsAtUtc,
            ChangeSource = change.ChangeSource.Trim(),
            ReconciliationReference = change.ReconciliationReference,
            ChangedAtUtc = now,
        });

        db.BillingEvents.Add(Receipt(
            provider,
            eventId,
            accountId,
            externalSubscriptionId,
            occurredAtUtc,
            CloudBillingReconciliationOutcome.Applied,
            now));

        await SaveAndCommitAsync(db, transaction, provider, eventId, cancellationToken);
        return CloudBillingReconciliationOutcome.Applied;
    }

    private static async Task SaveAndCommitAsync(
        CloudControlPlaneDbContext db,
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        string provider,
        string eventId,
        CancellationToken cancellationToken)
    {
        // The (Provider, EventId) primary key is the final concurrency guard.
        // If two identical deliveries race, one transaction may receive a
        // unique-constraint failure and return 5xx; Paddle safely retries it,
        // and the next attempt observes the committed receipt as Duplicate.
        // We deliberately do not turn a failed transaction into success.
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static CloudBillingEventReceipt Receipt(
        string provider,
        string eventId,
        NostosAccountId accountId,
        string externalSubscriptionId,
        DateTime occurredAtUtc,
        CloudBillingReconciliationOutcome outcome,
        DateTime processedAtUtc) =>
        new()
        {
            Provider = provider,
            EventId = eventId,
            AccountId = accountId.Value,
            ExternalSubscriptionId = externalSubscriptionId,
            OccurredAtUtc = occurredAtUtc,
            Outcome = outcome.ToString(),
            ProcessedAtUtc = processedAtUtc,
        };

    private static CloudBillingBindingSnapshot Snapshot(CloudBillingBinding row) =>
        new(
            new NostosAccountId(row.AccountId),
            row.Provider,
            row.ExternalTransactionId,
            row.ExternalCustomerId,
            row.ExternalSubscriptionId,
            Utc(row.LastEventOccurredAtUtc),
            DateTime.SpecifyKind(row.UpdatedAtUtc, DateTimeKind.Utc));

    private static DateTime? Utc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
}
