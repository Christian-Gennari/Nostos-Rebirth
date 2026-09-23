using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud.Ai;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Cloud.Privacy;
using Nostos.Backend.Cloud.Runtime;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

[Trait("Category", "CloudProvisioning")]
public sealed class CloudAccountDeletionIntegrationTests
{
    private const string ConnectionEnvironmentVariable =
        "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    public async Task Request_is_14_day_idempotent_recoverable_and_tenant_isolated()
    {
        await WithHarnessAsync(async h =>
        {
            var accountA = await h.AddAccountAsync("delete-a");
            var accountB = await h.AddAccountAsync("delete-b");

            var first = await h.Service.RequestAsync(accountA);
            first.State.Should().Be(CloudAccountDeletionState.GracePeriod);
            first.AccountStatus.Should().Be(CloudAccountStatus.DeletionRequested);
            first.RequestedAtUtc.Should().Be(h.Time.GetUtcNow().UtcDateTime);
            first.EligibleAtUtc.Should().Be(
                h.Time.GetUtcNow().UtcDateTime.AddDays(14));
            first.CanCancel(h.Time.GetUtcNow().UtcDateTime).Should().BeTrue();

            h.Time.Advance(TimeSpan.FromDays(1));
            var repeated = await h.Service.RequestAsync(accountA);
            repeated.RequestedAtUtc.Should().Be(first.RequestedAtUtc);
            repeated.EligibleAtUtc.Should().Be(first.EligibleAtUtc);

            var bBefore = await h.Service.GetAsync(accountB);
            bBefore.State.Should().BeNull();
            bBefore.AccountStatus.Should().Be(CloudAccountStatus.Active);

            var cancelled = await h.Service.CancelAsync(accountA);
            cancelled.State.Should().Be(CloudAccountDeletionState.Cancelled);
            cancelled.AccountStatus.Should().Be(CloudAccountStatus.Active);

            h.Time.Advance(TimeSpan.FromDays(1));
            var requestedAgain = await h.Service.RequestAsync(accountA);
            requestedAgain.State.Should().Be(CloudAccountDeletionState.GracePeriod);
            requestedAgain.RequestedAtUtc.Should().Be(h.Time.GetUtcNow().UtcDateTime);
            requestedAgain.EligibleAtUtc.Should().Be(
                h.Time.GetUtcNow().UtcDateTime.AddDays(14));

            var statusStore = (ICloudAccountStatusStore)h.ControlPlane;
            (await statusStore.GetStatusAsync(accountA, CancellationToken.None))
                .Should().Be(CloudAccountStatus.DeletionRequested);
            (await statusStore.GetStatusAsync(accountB, CancellationToken.None))
                .Should().Be(CloudAccountStatus.Active);
        });
    }

    [Fact]
    public async Task Failed_final_destruction_retries_safely_and_never_mutates_another_tenant()
    {
        await WithHarnessAsync(async h =>
        {
            var accountA = await h.AddAccountAsync("destroy-a");
            var accountB = await h.AddAccountAsync("destroy-b");

            await h.AddCommercialStateAsync(accountA);
            await h.AddCommercialStateAsync(accountB);

            var resourceA = await h.ControlPlane.FindAsync(accountA);
            var resourceB = await h.ControlPlane.FindAsync(accountB);
            resourceA.Should().NotBeNull();
            resourceB.Should().NotBeNull();

            await h.Service.RequestAsync(accountA);
            h.Time.Advance(TimeSpan.FromDays(14).Add(TimeSpan.FromMinutes(1)));

            var due = await h.Service.ListDueAsync();
            due.Should().ContainSingle().Which.Should().Be(accountA);

            h.Destroyer.FailNext = true;
            var failed = await h.Service.TryFinalizeAsync(accountA);

            failed.Should().NotBeNull();
            failed!.State.Should().Be(CloudAccountDeletionState.Failed);
            failed.AccountStatus.Should().Be(CloudAccountStatus.DeletionRequested);
            h.Destroyer.Resources.Should().ContainSingle();
            h.Destroyer.Resources.Single().AccountId.Should().Be(accountA);

            await using (var db = await h.Factory.CreateDbContextAsync())
            {
                (await db.Subscriptions.AnyAsync(x => x.AccountId == accountA.Value))
                    .Should().BeTrue(
                        "control-plane commercial state is retained until physical destruction succeeds");
                (await db.Subscriptions.AnyAsync(x => x.AccountId == accountB.Value))
                    .Should().BeTrue();
            }

            var deleted = await h.Service.TryFinalizeAsync(accountA);
            deleted.Should().NotBeNull();
            deleted!.State.Should().Be(CloudAccountDeletionState.Deleted);
            deleted.AccountStatus.Should().Be(CloudAccountStatus.Deleted);
            deleted.CompletedAtUtc.Should().NotBeNull();

            h.Destroyer.Resources.Should().HaveCount(2);
            h.Destroyer.Resources.Should().OnlyContain(x =>
                x.AccountId == accountA
                && x.ResourceId == resourceA!.ResourceId);

            var bAfter = await h.ControlPlane.FindAsync(accountB);
            bAfter.Should().NotBeNull();
            bAfter!.AccountStatus.Should().Be(CloudAccountStatus.Active);
            bAfter.ResourceId.Should().Be(resourceB!.ResourceId);
            bAfter.DatabaseName.Should().Be(resourceB.DatabaseName);
            bAfter.StorageNamespace.Should().Be(resourceB.StorageNamespace);

            await using var verify = await h.Factory.CreateDbContextAsync();
            (await verify.Subscriptions.AnyAsync(x => x.AccountId == accountA.Value))
                .Should().BeFalse();
            (await verify.SubscriptionAudit.AnyAsync(x => x.AccountId == accountA.Value))
                .Should().BeFalse();
            (await verify.AiUsage.AnyAsync(x => x.AccountId == accountA.Value))
                .Should().BeFalse();

            (await verify.Subscriptions.AnyAsync(x => x.AccountId == accountB.Value))
                .Should().BeTrue();
            (await verify.SubscriptionAudit.AnyAsync(x => x.AccountId == accountB.Value))
                .Should().BeTrue();
            (await verify.AiUsage.AnyAsync(x => x.AccountId == accountB.Value))
                .Should().BeTrue();
        });
    }

    [Fact]
    public async Task Subscription_cancellation_alone_never_enters_account_deletion()
    {
        await WithHarnessAsync(async h =>
        {
            var account = await h.AddAccountAsync("billing-only");
            await h.AddCommercialStateAsync(
                account,
                CloudSubscriptionStatus.Cancelled);

            var state = await h.Service.GetAsync(account);

            state.State.Should().BeNull();
            state.AccountStatus.Should().Be(CloudAccountStatus.Active);

            await using var db = await h.Factory.CreateDbContextAsync();
            (await db.AccountDeletions.AnyAsync(x => x.AccountId == account.Value))
                .Should().BeFalse();
        });
    }

    private static async Task WithHarnessAsync(Func<Harness, Task> action)
    {
        var root = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(root))
            return;

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var databaseName = $"nostos_cp_del_{suffix}";
        var admin = new NpgsqlConnectionStringBuilder(root).ConnectionString;

        try
        {
            await CreateDatabaseAsync(admin, databaseName);

            var builder = new NpgsqlConnectionStringBuilder(root)
            {
                Database = databaseName,
            };
            var dbOptions =
                new DbContextOptionsBuilder<CloudControlPlaneDbContext>()
                    .UseNpgsql(builder.ConnectionString)
                    .Options;
            var factory = new TestFactory(dbOptions);
            await new CloudControlPlaneBootstrapper(factory).EnsureReadyAsync();

            var controlOptions = new CloudControlPlaneOptions
            {
                CustomerDatabasePrefix = $"ntu_del_{suffix}",
                StorageNamespacePrefix = $"tests/deletion/{suffix}",
            };
            var controlPlane = new CloudControlPlaneStore(
                factory,
                controlOptions);
            var destroyer = new FakeDestroyer();
            var time = new MutableTimeProvider(
                new DateTimeOffset(
                    2026, 9, 23, 12, 0, 0,
                    TimeSpan.Zero));
            var service = new CloudAccountDeletionService(
                factory,
                controlPlane,
                destroyer,
                new FakeExporter(),
                new FakeLeaseManager(),
                time,
                NullLogger<CloudAccountDeletionService>.Instance);

            await action(new Harness(
                factory,
                controlPlane,
                controlOptions,
                destroyer,
                time,
                service));
        }
        finally
        {
            await DropDatabaseIfExistsAsync(admin, databaseName);
        }
    }

    private sealed class Harness(
        IDbContextFactory<CloudControlPlaneDbContext> factory,
        CloudControlPlaneStore controlPlane,
        CloudControlPlaneOptions options,
        FakeDestroyer destroyer,
        MutableTimeProvider time,
        ICloudAccountDeletionService service)
    {
        public IDbContextFactory<CloudControlPlaneDbContext> Factory { get; } = factory;
        public CloudControlPlaneStore ControlPlane { get; } = controlPlane;
        public FakeDestroyer Destroyer { get; } = destroyer;
        public MutableTimeProvider Time { get; } = time;
        public ICloudAccountDeletionService Service { get; } = service;

        public async Task<NostosAccountId> AddAccountAsync(string subject)
        {
            var account = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                subject);
            var resourceId = Guid.NewGuid();
            var now = Time.GetUtcNow().UtcDateTime;

            await using var db = await Factory.CreateDbContextAsync();
            db.AccountResources.Add(new CloudAccountResource
            {
                AccountId = account.Value,
                ResourceId = resourceId,
                DatabaseName = options.DatabaseName(resourceId),
                StorageNamespace = options.StorageNamespace(resourceId),
                ProvisioningState = CloudProvisioningState.Ready,
                AccountStatus = CloudAccountStatus.Active,
                SchemaVersion = CloudCustomerSchema.CurrentVersion,
                CreatedAtUtc = now,
                UpdatedAtUtc = now,
                ReadyAtUtc = now,
            });
            await db.SaveChangesAsync();

            return account;
        }

        public async Task AddCommercialStateAsync(
            NostosAccountId accountId,
            CloudSubscriptionStatus status = CloudSubscriptionStatus.Active)
        {
            var now = Time.GetUtcNow().UtcDateTime;

            await using var db = await Factory.CreateDbContextAsync();
            db.Subscriptions.Add(new CloudSubscription
            {
                AccountId = accountId.Value,
                PlanId = "test",
                Status = status,
                EntitlementsJson =
                    """{"cloudAccess":true,"managedAiEnabled":true,"managedAiMonthlyAllowance":1000000,"storageBytesLimit":1000000}""",
                UpdatedAtUtc = now,
            });
            db.SubscriptionAudit.Add(new CloudSubscriptionAuditEvent
            {
                AccountId = accountId.Value,
                PlanId = "test",
                Status = status,
                EntitlementsJson =
                    """{"cloudAccess":true,"managedAiEnabled":true,"managedAiMonthlyAllowance":1000000,"storageBytesLimit":1000000}""",
                ChangeSource = "test",
                ChangedAtUtc = now,
            });
            db.AiUsage.Add(new CloudAiUsageRecord
            {
                AccountId = accountId.Value,
                Kind = "llm",
                Provider = "google",
                Model = "google/gemini-3.8-flash",
                StartedAtUtc = now,
                CompletedAtUtc = now,
                PeriodStartUtc = new DateTime(
                    now.Year,
                    now.Month,
                    1,
                    0,
                    0,
                    0,
                    DateTimeKind.Utc),
                UpstreamRequestCount = 1,
                ToolLoopIterations = 0,
                QuotaChargeMicrousd = 1,
                ResultCategory = "Completed",
            });
            await db.SaveChangesAsync();
        }
    }

    private sealed class FakeDestroyer : ICloudAccountDeletionResourceDestroyer
    {
        public bool FailNext { get; set; }
        public List<CloudAccountResourceSnapshot> Resources { get; } = [];

        public Task DestroyAsync(
            CloudAccountResourceSnapshot resource,
            CancellationToken cancellationToken = default)
        {
            Resources.Add(resource);

            if (FailNext)
            {
                FailNext = false;
                throw new IOException("simulated secret-bearing provider failure");
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FakeExporter : ICloudAccountDeletionPortableExporter
    {
        public Task ExportAsync(
            CloudAccountResourceSnapshot resource,
            Stream destination,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class FakeLeaseManager : ICloudWorkerLeaseManager
    {
        public Task<IAsyncDisposable?> TryAcquireAsync(
            string leaseName,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IAsyncDisposable?>(new Lease());

        private sealed class Lease : IAsyncDisposable
        {
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        private DateTimeOffset _utcNow = utcNow;

        public override DateTimeOffset GetUtcNow() => _utcNow;

        public void Advance(TimeSpan duration) =>
            _utcNow = _utcNow.Add(duration);
    }

    private sealed class TestFactory(
        DbContextOptions<CloudControlPlaneDbContext> options)
        : IDbContextFactory<CloudControlPlaneDbContext>
    {
        public CloudControlPlaneDbContext CreateDbContext() => new(options);

        public ValueTask<CloudControlPlaneDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new CloudControlPlaneDbContext(options));
    }

    private static async Task CreateDatabaseAsync(
        string adminConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText =
            $"CREATE DATABASE {QuoteIdentifier(databaseName)}";
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseIfExistsAsync(
        string adminConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText =
            $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)} WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    private static string QuoteIdentifier(string identifier) =>
        """ + identifier.Replace(""", """", StringComparison.Ordinal) + """;
}
