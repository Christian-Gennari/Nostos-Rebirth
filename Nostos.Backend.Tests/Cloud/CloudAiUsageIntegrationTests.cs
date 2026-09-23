using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud.Ai;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Ai;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

[Trait("Category", "CloudEntitlements")]
[Trait("Category", "CloudAiUsage")]
public sealed class CloudAiUsageIntegrationTests
{
    private const string ConnectionEnvironmentVariable = "NOSTOS_POSTGRES_SPIKE_CONNECTION";
    private static readonly DateTime FixedNow =
        new(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Usage_is_attributed_to_the_trusted_account_and_cannot_be_settled_by_another()
    {
        await WithDatabaseAsync(async h =>
        {
            var accountA = await h.AddAccountAsync("usage-a", allowance: 2_000_000);
            var accountB = await h.AddAccountAsync("usage-b", allowance: 2_000_000);
            var serviceA = h.Service(accountA);
            var serviceB = h.Service(accountB);

            var completed = await serviceA.BeginLlmTurnAsync();
            await serviceA.CompleteLlmTurnAsync(
                completed,
                new ManagedAiLlmUsage(1, 100, 50, 30, 150, 0, "Completed", "stop"));

            var stranded = await serviceA.BeginLlmTurnAsync();
            await serviceB.CompleteLlmTurnAsync(
                stranded,
                new ManagedAiLlmUsage(1, 100, 50, 30, 150, 0, "Completed", "stop"));

            await using var db = await h.Factory.CreateDbContextAsync();
            (await db.AiUsage.CountAsync(x => x.AccountId == accountA.Value)).Should().Be(1);
            (await db.AiUsage.CountAsync(x => x.AccountId == accountB.Value)).Should().Be(0);
            (await db.AiUsageReservations.CountAsync(
                x => x.Id == stranded!.ReservationId && x.AccountId == accountA.Value)).Should().Be(1);
        });
    }

    [Fact]
    public async Task Gemini_and_STT_usage_are_accounted_separately_with_reported_dimensions()
    {
        await WithDatabaseAsync(async h =>
        {
            var account = await h.AddAccountAsync("dimensions", allowance: 2_000_000);
            var service = h.Service(account);

            var llm = await service.BeginLlmTurnAsync();
            await service.CompleteLlmTurnAsync(
                llm,
                new ManagedAiLlmUsage(
                    2,
                    InputTokens: 100,
                    OutputTokens: 50,
                    ThinkingTokens: 30,
                    ReportedTotalTokens: 150,
                    ToolLoopIterations: 1,
                    ResultCategory: "Completed",
                    ProviderFinishReason: "stop"));

            var stt = await service.BeginSttAsync();
            await service.CompleteSttAsync(
                stt,
                new ManagedAiSttUsage(1, DurationSeconds: 1.25, ResultCategory: "Completed"));

            await using var db = await h.Factory.CreateDbContextAsync();
            var llmRow = await db.AiUsage.SingleAsync(x => x.Kind == "llm");
            llmRow.InputTokens.Should().Be(100);
            llmRow.OutputTokens.Should().Be(50);
            llmRow.ThinkingTokens.Should().Be(30);
            llmRow.ReportedTotalTokens.Should().Be(150);
            llmRow.ToolLoopIterations.Should().Be(1);
            llmRow.EstimatedCostMicrousd.Should().Be(263);
            llmRow.PricingEpoch.Should().Be(CloudAiPricing.GeminiIntroEpoch);

            var sttRow = await db.AiUsage.SingleAsync(x => x.Kind == "stt");
            sttRow.SttDurationMilliseconds.Should().Be(1_250);
            sttRow.InputTokens.Should().BeNull();
            sttRow.EstimatedCostMicrousd.Should().Be(112);
            sttRow.PricingEpoch.Should().Be(CloudAiPricing.GroqWhisperEpoch);
        });
    }

    [Fact]
    public async Task Monthly_allowance_blocks_before_spend_and_concurrent_requests_cannot_bypass_it()
    {
        await WithDatabaseAsync(async h =>
        {
            var account = await h.AddAccountAsync("concurrency", allowance: 50_000);
            var service = h.Service(account);

            var attempts = await Task.WhenAll(
                TryBeginAsync(service),
                TryBeginAsync(service));

            attempts.Count(x => x.Lease is not null).Should().Be(1);
            attempts.Count(x => x.Reason == ManagedAiUsageBlockReason.MonthlyAllowanceExhausted)
                .Should().Be(1);

            await using var db = await h.Factory.CreateDbContextAsync();
            (await db.AiUsageReservations.CountAsync(x => x.AccountId == account.Value))
                .Should().Be(1);
        });
    }

    [Fact]
    public async Task Short_window_rate_limit_is_separate_from_monthly_allowance()
    {
        await WithDatabaseAsync(async h =>
        {
            var usageOptions = h.DefaultUsageOptions();
            usageOptions.LlmRequestsPerWindow = 1;
            var account = await h.AddAccountAsync("rate", allowance: 5_000_000);
            var service = h.Service(account, usageOptions);

            (await service.BeginLlmTurnAsync()).Should().NotBeNull();

            var act = () => service.BeginLlmTurnAsync();
            var exception = (await act.Should().ThrowAsync<ManagedAiUsageException>()).Which;
            exception.Reason.Should().Be(ManagedAiUsageBlockReason.RateLimited);
        });
    }

    [Fact]
    public async Task Operator_switch_and_global_ceiling_stop_new_provider_spend()
    {
        await WithDatabaseAsync(async h =>
        {
            var disabled = h.DefaultUsageOptions();
            disabled.OperatorEnabled = false;
            var accountA = await h.AddAccountAsync("operator-a", allowance: 5_000_000);

            var disabledAct = () => h.Service(accountA, disabled).BeginLlmTurnAsync();
            (await disabledAct.Should().ThrowAsync<ManagedAiUsageException>())
                .Which.Reason.Should().Be(ManagedAiUsageBlockReason.OperatorDisabled);

            var capped = h.DefaultUsageOptions();
            capped.GlobalMonthlyBudgetMicrousd = 50_000;
            var accountB = await h.AddAccountAsync("operator-b", allowance: 5_000_000);
            var accountC = await h.AddAccountAsync("operator-c", allowance: 5_000_000);

            (await h.Service(accountB, capped).BeginLlmTurnAsync()).Should().NotBeNull();

            var capAct = () => h.Service(accountC, capped).BeginLlmTurnAsync();
            (await capAct.Should().ThrowAsync<ManagedAiUsageException>())
                .Which.Reason.Should().Be(ManagedAiUsageBlockReason.OperatorBudgetExhausted);
        });
    }

    [Fact]
    public async Task Unknown_failed_provider_cost_remains_unknown_but_consumes_conservative_quota()
    {
        await WithDatabaseAsync(async h =>
        {
            var account = await h.AddAccountAsync("failure", allowance: 5_000_000);
            var service = h.Service(account);
            var lease = await service.BeginLlmTurnAsync();

            await service.CompleteLlmTurnAsync(
                lease,
                new ManagedAiLlmUsage(
                    1,
                    InputTokens: null,
                    OutputTokens: null,
                    ThinkingTokens: null,
                    ReportedTotalTokens: null,
                    ToolLoopIterations: 0,
                    ResultCategory: "ProviderError",
                    ProviderFinishReason: null));

            await using var db = await h.Factory.CreateDbContextAsync();
            var row = await db.AiUsage.SingleAsync();
            row.UpstreamRequestCount.Should().Be(1);
            row.EstimatedCostMicrousd.Should().BeNull();
            row.QuotaChargeMicrousd.Should().Be(50_000);
            row.ResultCategory.Should().Be("ProviderError");
        });
    }

    [Fact]
    public async Task Near_limit_status_and_UTC_month_rollover_are_product_level_only()
    {
        await WithDatabaseAsync(async h =>
        {
            var account = await h.AddAccountAsync("status", allowance: 100_000);
            await using (var db = await h.Factory.CreateDbContextAsync())
            {
                db.AiUsage.Add(new CloudAiUsageRecord
                {
                    AccountId = account.Value,
                    Kind = "llm",
                    Provider = "google",
                    Model = "gemini-3.8-flash",
                    PricingEpoch = CloudAiPricing.GeminiIntroEpoch,
                    StartedAtUtc = FixedNow.AddMinutes(-10),
                    CompletedAtUtc = FixedNow.AddMinutes(-10),
                    PeriodStartUtc = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                    UpstreamRequestCount = 1,
                    InputTokens = 1,
                    OutputTokens = 1,
                    ReportedTotalTokens = 2,
                    ToolLoopIterations = 0,
                    EstimatedCostMicrousd = 80_000,
                    QuotaChargeMicrousd = 80_000,
                    ResultCategory = "Completed",
                });
                await db.SaveChangesAsync();
            }

            var status = await h.Service(account).GetStatusAsync();
            status.State.Should().Be(ManagedAiUsageStates.NearLimit);
            status.RenewsAtUtc.Should().Be(new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc));

            h.Clock.Set(new DateTimeOffset(2026, 10, 1, 0, 0, 1, TimeSpan.Zero));
            var rolled = await h.Service(account).GetStatusAsync();
            rolled.State.Should().Be(ManagedAiUsageStates.Normal);
            rolled.RenewsAtUtc.Should().Be(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc));
        });
    }

    [Fact]
    public async Task Grace_can_spend_until_entitlement_changes_to_cancelled_then_data_is_retained()
    {
        await WithDatabaseAsync(async h =>
        {
            var account = await h.AddAccountAsync(
                "lifecycle",
                allowance: 5_000_000,
                status: CloudSubscriptionStatus.Grace,
                graceEndsAtUtc: DateTime.UtcNow.AddDays(1));

            var service = h.Service(account);
            var lease = await service.BeginLlmTurnAsync();
            lease.Should().NotBeNull();

            await h.Subscriptions.ApplyChangeAsync(
                account,
                new CloudSubscriptionChange(
                    new NostosPlanId("usage-plan"),
                    CloudSubscriptionStatus.Cancelled,
                    new CloudEntitlementSet(true, true, 5_000_000, 1_000),
                    null,
                    null,
                    "usage-test"));

            var act = () => service.BeginLlmTurnAsync();
            (await act.Should().ThrowAsync<ManagedAiUsageException>())
                .Which.Reason.Should().Be(ManagedAiUsageBlockReason.NotEntitled);

            await using var db = await h.Factory.CreateDbContextAsync();
            (await db.AiUsageReservations.CountAsync(x => x.AccountId == account.Value))
                .Should().Be(1, "cancellation denies future spend but never deletes accounting/customer state");
        });
    }

    private static async Task<(ManagedAiUsageLease? Lease, ManagedAiUsageBlockReason? Reason)> TryBeginAsync(
        IManagedAiUsageService service)
    {
        try
        {
            return (await service.BeginLlmTurnAsync(), null);
        }
        catch (ManagedAiUsageException exception)
        {
            return (null, exception.Reason);
        }
    }

    private static async Task WithDatabaseAsync(Func<Harness, Task> body)
    {
        var rootConnection = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(rootConnection))
            return;

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var databaseName = $"nostos_cp_ai_{suffix}";
        var root = new NpgsqlConnectionStringBuilder(rootConnection);
        var admin = root.ConnectionString;

        try
        {
            await CreateDatabaseAsync(admin, databaseName);
            var database = new NpgsqlConnectionStringBuilder(rootConnection)
            {
                Database = databaseName,
            };

            var dbOptions = new DbContextOptionsBuilder<CloudControlPlaneDbContext>()
                .UseNpgsql(database.ConnectionString)
                .Options;
            var factory = new TestFactory(dbOptions);
            await new CloudControlPlaneBootstrapper(factory).EnsureReadyAsync();

            await body(new Harness(factory, suffix));
        }
        finally
        {
            await DropDatabaseIfExistsAsync(admin, databaseName);
        }
    }

    private sealed class Harness
    {
        private readonly string _suffix;
        public TestFactory Factory { get; }
        public MutableTimeProvider Clock { get; } = new(new DateTimeOffset(FixedNow));
        public CloudSubscriptionStore Subscriptions { get; }

        public Harness(TestFactory factory, string suffix)
        {
            Factory = factory;
            _suffix = suffix;
            Subscriptions = new CloudSubscriptionStore(factory);
        }

        public CloudManagedAiUsageOptions DefaultUsageOptions() => new()
        {
            OperatorEnabled = true,
            GlobalMonthlyBudgetMicrousd = 100_000_000,
            RateWindowSeconds = 60,
            LlmRequestsPerWindow = 20,
            SttRequestsPerWindow = 10,
            SttReservationSeconds = 300,
            NearLimitPercent = 80,
        };

        public async Task<NostosAccountId> AddAccountAsync(
            string subject,
            long allowance,
            CloudSubscriptionStatus status = CloudSubscriptionStatus.Active,
            DateTime? graceEndsAtUtc = null)
        {
            var account = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                $"{subject}-{_suffix}");

            var resources = new CloudControlPlaneStore(
                Factory,
                new CloudControlPlaneOptions
                {
                    CustomerDatabasePrefix = $"ntu_ai_{_suffix}",
                    StorageNamespacePrefix = $"tests/ai/{_suffix}",
                });
            await resources.GetOrCreateAsync(account);

            await Subscriptions.ApplyChangeAsync(
                account,
                new CloudSubscriptionChange(
                    new NostosPlanId("usage-plan"),
                    status,
                    new CloudEntitlementSet(
                        CloudAccess: true,
                        ManagedAiEnabled: true,
                        ManagedAiMonthlyAllowance: allowance,
                        StorageBytesLimit: 1_000),
                    TrialEndsAtUtc: null,
                    GraceEndsAtUtc: graceEndsAtUtc,
                    ChangeSource: "usage-test"));

            return account;
        }

        public CloudManagedAiUsageService Service(
            NostosAccountId account,
            CloudManagedAiUsageOptions? usageOptions = null)
        {
            var tenant = new FixedTenantContext(account);
            var entitlement = new CloudEntitlementService(tenant, Subscriptions);
            return new CloudManagedAiUsageService(
                Factory,
                tenant,
                entitlement,
                new CloudManagedAiOptions(),
                usageOptions ?? DefaultUsageOptions(),
                Clock,
                NullLogger<CloudManagedAiUsageService>.Instance);
        }
    }

    private sealed class FixedTenantContext(NostosAccountId account)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(account, "Usage test", "usage@example.test");
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Set(DateTimeOffset value) => _now = value;
    }

    public sealed class TestFactory(DbContextOptions<CloudControlPlaneDbContext> options)
        : IDbContextFactory<CloudControlPlaneDbContext>
    {
        public CloudControlPlaneDbContext CreateDbContext() => new(options);

        public ValueTask<CloudControlPlaneDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new CloudControlPlaneDbContext(options));
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
}
