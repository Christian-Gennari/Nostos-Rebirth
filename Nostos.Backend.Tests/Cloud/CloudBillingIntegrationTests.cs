using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nostos.Backend.Cloud.Billing;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudBillingIntegrationTests
{
    private const string ConnectionEnvironmentVariable = "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudBilling")]
    public async Task Billing_reconciliation_is_idempotent_ordered_account_isolated_and_updates_entitlements()
    {
        var rootConnection = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(rootConnection))
            return;

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var controlPlaneDatabase = $"nostos_cp_bill_{suffix}";

        var rootBuilder = new NpgsqlConnectionStringBuilder(rootConnection);
        var adminConnection = rootBuilder.ConnectionString;

        try
        {
            await CreateDatabaseAsync(adminConnection, controlPlaneDatabase);

            var controlPlaneBuilder = new NpgsqlConnectionStringBuilder(rootConnection)
            {
                Database = controlPlaneDatabase,
            };

            var dbOptions = new DbContextOptionsBuilder<CloudControlPlaneDbContext>()
                .UseNpgsql(controlPlaneBuilder.ConnectionString)
                .Options;
            var factory = new TestControlPlaneDbContextFactory(dbOptions);
            var bootstrapper = new CloudControlPlaneBootstrapper(factory);
            await bootstrapper.EnsureReadyAsync();

            var resourceOptions = new CloudControlPlaneOptions
            {
                CustomerDatabasePrefix = $"ntu_bill_{suffix}",
                StorageNamespacePrefix = $"tests/billing/{suffix}",
            };
            var resources = new CloudControlPlaneStore(factory, resourceOptions);
            var accountA = Account($"billing-a-{suffix}");
            var accountB = Account($"billing-b-{suffix}");
            var resourceA = await resources.GetOrCreateAsync(accountA);
            var resourceB = await resources.GetOrCreateAsync(accountB);

            var billing = new CloudBillingStateStore(factory);
            var subscriptions = new CloudSubscriptionStore(factory);
            var occurredAt = DateTime.UtcNow.AddMinutes(-2);
            var active = Change(
                "pro",
                CloudSubscriptionStatus.Active,
                ai: true,
                storage: 50_000,
                reference: "paddle:evt_active");

            var applied = await billing.ApplyProviderEventAsync(
                accountA,
                PaddleBillingService.ProviderName,
                "evt_active",
                occurredAt,
                "txn_a",
                "ctm_a",
                "sub_shared",
                active);

            applied.Should().Be(CloudBillingReconciliationOutcome.Applied);

            var subscriptionA = await subscriptions.FindAsync(accountA);
            subscriptionA.Should().NotBeNull();
            subscriptionA!.PlanId.Should().Be(new NostosPlanId("pro"));
            subscriptionA.Status.Should().Be(CloudSubscriptionStatus.Active);

            var entitlements = await new CloudEntitlementService(
                new FixedTenantContextAccessor(accountA),
                subscriptions).GetEntitlementsAsync();

            entitlements.CloudAccess.Should().BeTrue();
            entitlements.ManagedAiEnabled.Should().BeTrue();
            entitlements.StorageBytesLimit.Should().Be(50_000);

            var duplicate = await billing.ApplyProviderEventAsync(
                accountA,
                PaddleBillingService.ProviderName,
                "evt_active",
                occurredAt,
                "txn_a",
                "ctm_a",
                "sub_shared",
                active);

            duplicate.Should().Be(CloudBillingReconciliationOutcome.Duplicate);
            (await subscriptions.ListAuditAsync(accountA)).Should().HaveCount(1);

            var stale = await billing.ApplyProviderEventAsync(
                accountA,
                PaddleBillingService.ProviderName,
                "evt_stale",
                occurredAt.AddMinutes(-1),
                "txn_a",
                "ctm_a",
                "sub_shared",
                Change(
                    "basic",
                    CloudSubscriptionStatus.Active,
                    ai: false,
                    storage: 1_000,
                    reference: "paddle:evt_stale"));

            stale.Should().Be(CloudBillingReconciliationOutcome.IgnoredStale);
            (await subscriptions.FindAsync(accountA))!.PlanId
                .Should().Be(new NostosPlanId("pro"));
            (await subscriptions.ListAuditAsync(accountA)).Should().HaveCount(1);

            Func<Task> crossAccount = async () =>
                await billing.ApplyProviderEventAsync(
                    accountB,
                    PaddleBillingService.ProviderName,
                    "evt_cross_account",
                    occurredAt.AddMinutes(1),
                    "txn_b",
                    "ctm_b",
                    "sub_shared",
                    Change(
                        "basic",
                        CloudSubscriptionStatus.Active,
                        ai: false,
                        storage: 1_000,
                        reference: "paddle:evt_cross_account"));

            await crossAccount.Should()
                .ThrowAsync<InvalidOperationException>()
                .WithMessage("*more than one Nostos account*");
            (await subscriptions.FindAsync(accountB)).Should().BeNull();

            var canceled = await billing.ApplyProviderEventAsync(
                accountA,
                PaddleBillingService.ProviderName,
                "evt_cancel",
                occurredAt.AddMinutes(2),
                "txn_a",
                "ctm_a",
                "sub_shared",
                Change(
                    "pro",
                    CloudSubscriptionStatus.Cancelled,
                    ai: true,
                    storage: 50_000,
                    reference: "paddle:evt_cancel"));

            canceled.Should().Be(CloudBillingReconciliationOutcome.Applied);

            var denied = await new CloudEntitlementService(
                new FixedTenantContextAccessor(accountA),
                subscriptions).GetEntitlementsAsync();

            denied.Should().Be(CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.Cancelled));

            // Billing transitions operate only in the control plane. They never
            // delete the tenant mapping or reach into the customer database.
            var resourceAfterCancellationA = await resources.FindAsync(accountA);
            var resourceAfterCancellationB = await resources.FindAsync(accountB);
            resourceAfterCancellationA!.ResourceId.Should().Be(resourceA.ResourceId);
            resourceAfterCancellationA.DatabaseName.Should().Be(resourceA.DatabaseName);
            resourceAfterCancellationB!.ResourceId.Should().Be(resourceB.ResourceId);
            resourceAfterCancellationB.DatabaseName.Should().Be(resourceB.DatabaseName);

            (await subscriptions.ListAuditAsync(accountA))
                .Select(x => x.Status)
                .Should().Equal(
                    CloudSubscriptionStatus.Active,
                    CloudSubscriptionStatus.Cancelled);
        }
        finally
        {
            await DropDatabaseIfExistsAsync(adminConnection, controlPlaneDatabase);
        }
    }

    private static CloudSubscriptionChange Change(
        string plan,
        CloudSubscriptionStatus status,
        bool ai,
        long storage,
        string reference) =>
        new(
            new NostosPlanId(plan),
            status,
            new CloudEntitlementSet(
                CloudAccess: true,
                ManagedAiEnabled: ai,
                ManagedAiMonthlyAllowance: ai ? 500 : 0,
                StorageBytesLimit: storage),
            TrialEndsAtUtc: null,
            GraceEndsAtUtc: null,
            ChangeSource: "paddle",
            ReconciliationReference: reference);

    private static NostosAccountId Account(string subject) =>
        NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            subject);

    private static async Task CreateDatabaseAsync(
        string adminConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            $"CREATE DATABASE {QuoteIdentifier(databaseName)}",
            connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseIfExistsAsync(
        string adminConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)} WITH (FORCE)",
            connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private sealed class FixedTenantContextAccessor(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(accountId, "Test account", null);
    }

    private sealed class TestControlPlaneDbContextFactory(
        DbContextOptions<CloudControlPlaneDbContext> options)
        : IDbContextFactory<CloudControlPlaneDbContext>
    {
        public CloudControlPlaneDbContext CreateDbContext() => new(options);

        public ValueTask<CloudControlPlaneDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new CloudControlPlaneDbContext(options));
    }
}
