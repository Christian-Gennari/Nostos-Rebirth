using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudSubscriptionIntegrationTests
{
    private const string ConnectionEnvironmentVariable = "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudEntitlements")]
    public async Task Existing_control_plane_is_upgraded_additively_and_subscription_changes_are_auditable()
    {
        var rootConnection = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(rootConnection))
            return;

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var controlPlaneDatabase = $"nostos_cp_ent_{suffix}";

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
                CustomerDatabasePrefix = $"ntu_ent_{suffix}",
                StorageNamespacePrefix = $"tests/entitlements/{suffix}",
            };
            var resources = new CloudControlPlaneStore(factory, resourceOptions);

            var account = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                $"entitlements-{suffix}");
            var originalResource = await resources.GetOrCreateAsync(account);

            // Simulate a #396-era control plane: AccountResources exists, while
            // the #403 commercial tables do not. Re-running bootstrap must add
            // them without replacing or mutating the existing resource row.
            await using (var db = await factory.CreateDbContextAsync())
            {
                await db.Database.ExecuteSqlRawAsync(
                    """
                    DROP TABLE IF EXISTS "CloudSubscriptionAudit";
                    DROP TABLE IF EXISTS "CloudSubscriptions";
                    """);
            }

            await bootstrapper.EnsureReadyAsync();

            var resourceAfterUpgrade = await resources.FindAsync(account);
            resourceAfterUpgrade.Should().NotBeNull();
            resourceAfterUpgrade!.ResourceId.Should().Be(originalResource.ResourceId);
            resourceAfterUpgrade.DatabaseName.Should().Be(originalResource.DatabaseName);
            resourceAfterUpgrade.StorageNamespace.Should().Be(originalResource.StorageNamespace);

            var subscriptions = new CloudSubscriptionStore(factory);

            await subscriptions.ApplyChangeAsync(
                account,
                new CloudSubscriptionChange(
                    new NostosPlanId("test-plan-a"),
                    CloudSubscriptionStatus.Active,
                    new CloudEntitlementSet(
                        CloudAccess: true,
                        ManagedAiEnabled: false,
                        ManagedAiMonthlyAllowance: 0,
                        StorageBytesLimit: 1_024),
                    TrialEndsAtUtc: null,
                    GraceEndsAtUtc: null,
                    ChangeSource: "integration-test"));

            var first = await subscriptions.FindAsync(account);
            first.Should().NotBeNull();
            first!.PlanId.Should().Be(new NostosPlanId("test-plan-a"));
            first.Status.Should().Be(CloudSubscriptionStatus.Active);
            first.Entitlements.StorageBytesLimit.Should().Be(1_024);

            await subscriptions.ApplyChangeAsync(
                account,
                new CloudSubscriptionChange(
                    new NostosPlanId("test-plan-b"),
                    CloudSubscriptionStatus.Grace,
                    new CloudEntitlementSet(
                        CloudAccess: true,
                        ManagedAiEnabled: true,
                        ManagedAiMonthlyAllowance: 500,
                        StorageBytesLimit: 4_096),
                    TrialEndsAtUtc: null,
                    GraceEndsAtUtc: DateTime.UtcNow.AddDays(3),
                    ChangeSource: "integration-test",
                    ReconciliationReference: "reconcile-test-2"));

            var updated = await subscriptions.FindAsync(account);
            updated.Should().NotBeNull();
            updated!.PlanId.Should().Be(new NostosPlanId("test-plan-b"));
            updated.Status.Should().Be(CloudSubscriptionStatus.Grace);
            updated.Entitlements.ManagedAiEnabled.Should().BeTrue();
            updated.Entitlements.ManagedAiMonthlyAllowance.Should().Be(500);
            updated.Entitlements.StorageBytesLimit.Should().Be(4_096);

            var audit = await subscriptions.ListAuditAsync(account);
            audit.Should().HaveCount(2);
            audit.Select(x => x.PlanId.Value)
                .Should().Equal("test-plan-a", "test-plan-b");
            audit.Select(x => x.Status)
                .Should().Equal(
                    CloudSubscriptionStatus.Active,
                    CloudSubscriptionStatus.Grace);
            audit[1].ReconciliationReference.Should().Be("reconcile-test-2");
        }
        finally
        {
            await DropDatabaseIfExistsAsync(adminConnection, controlPlaneDatabase);
        }
    }

    private static async Task CreateDatabaseAsync(string adminConnection, string databaseName)
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
