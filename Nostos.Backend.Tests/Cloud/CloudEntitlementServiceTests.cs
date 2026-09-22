using FluentAssertions;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudEntitlementServiceTests
{
    [Fact]
    public async Task Active_account_receives_configured_entitlements()
    {
        var account = Account("active");
        var store = new InMemorySubscriptionStore(
            Subscription(
                account,
                CloudSubscriptionStatus.Active,
                new CloudEntitlementSet(
                    CloudAccess: true,
                    ManagedAiEnabled: true,
                    ManagedAiMonthlyAllowance: 250,
                    StorageBytesLimit: 10_000)));

        var service = Service(account, store);

        var result = await service.GetEntitlementsAsync();

        result.Should().Be(new CloudEntitlementSnapshot(
            CloudSubscriptionStatus.Active,
            CloudAccess: true,
            ManagedAiEnabled: true,
            ManagedAiMonthlyAllowance: 250,
            StorageBytesLimit: 10_000));
    }

    [Fact]
    public async Task Trial_account_has_access_until_trial_deadline()
    {
        var account = Account("trial");
        var store = new InMemorySubscriptionStore(
            Subscription(
                account,
                CloudSubscriptionStatus.Trial,
                StandardEntitlements,
                trialEndsAtUtc: DateTime.UtcNow.AddHours(1)));

        var result = await Service(account, store).GetEntitlementsAsync();

        result.SubscriptionStatus.Should().Be(CloudSubscriptionStatus.Trial);
        result.CloudAccess.Should().BeTrue();
    }

    [Fact]
    public async Task Zero_managed_ai_allowance_is_represented_without_inventing_usage_metering()
    {
        var account = Account("limited");
        var store = new InMemorySubscriptionStore(
            Subscription(
                account,
                CloudSubscriptionStatus.Active,
                new CloudEntitlementSet(
                    CloudAccess: true,
                    ManagedAiEnabled: true,
                    ManagedAiMonthlyAllowance: 0,
                    StorageBytesLimit: 2_048)));

        var result = await Service(account, store).GetEntitlementsAsync();

        result.ManagedAiEnabled.Should().BeTrue();
        result.ManagedAiMonthlyAllowance.Should().Be(0);
        result.StorageBytesLimit.Should().Be(2_048);
    }

    [Fact]
    public async Task Grace_account_keeps_access_until_grace_deadline()
    {
        var account = Account("grace");
        var store = new InMemorySubscriptionStore(
            Subscription(
                account,
                CloudSubscriptionStatus.Grace,
                StandardEntitlements,
                graceEndsAtUtc: DateTime.UtcNow.AddHours(1)));

        var result = await Service(account, store).GetEntitlementsAsync();

        result.SubscriptionStatus.Should().Be(CloudSubscriptionStatus.Grace);
        result.CloudAccess.Should().BeTrue();
    }

    [Fact]
    public async Task Past_due_account_is_denied_without_mutating_subscription_data()
    {
        var account = Account("past-due");
        var subscription = Subscription(
            account,
            CloudSubscriptionStatus.PastDue,
            StandardEntitlements);
        var store = new InMemorySubscriptionStore(subscription);

        var result = await Service(account, store).GetEntitlementsAsync();

        result.Should().Be(CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.PastDue));
        (await store.FindAsync(account))!.Entitlements.Should().Be(StandardEntitlements);
    }

    [Theory]
    [InlineData(CloudSubscriptionStatus.Cancelled)]
    [InlineData(CloudSubscriptionStatus.Expired)]
    public async Task Cancelled_or_expired_account_is_denied_without_deleting_state(
        CloudSubscriptionStatus status)
    {
        var account = Account(status.ToString());
        var subscription = Subscription(account, status, StandardEntitlements);
        var store = new InMemorySubscriptionStore(subscription);

        var result = await Service(account, store).GetEntitlementsAsync();

        result.Should().Be(CloudEntitlementSnapshot.Denied(status));
        (await store.FindAsync(account)).Should().NotBeNull();
    }

    [Fact]
    public async Task Expired_trial_or_grace_window_fails_closed()
    {
        var trial = Account("trial-expired");
        var grace = Account("grace-expired");
        var store = new InMemorySubscriptionStore(
            Subscription(
                trial,
                CloudSubscriptionStatus.Trial,
                StandardEntitlements,
                trialEndsAtUtc: DateTime.UtcNow.AddHours(-1)),
            Subscription(
                grace,
                CloudSubscriptionStatus.Grace,
                StandardEntitlements,
                graceEndsAtUtc: DateTime.UtcNow.AddHours(-1)));

        (await Service(trial, store).GetEntitlementsAsync())
            .Should().Be(CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.Expired));

        (await Service(grace, store).GetEntitlementsAsync())
            .Should().Be(CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.Expired));
    }

    [Fact]
    public async Task Plan_change_updates_effective_entitlements_without_plan_checks_in_product_code()
    {
        var account = Account("plan-change");
        var store = new InMemorySubscriptionStore(
            Subscription(
                account,
                CloudSubscriptionStatus.Active,
                new CloudEntitlementSet(true, false, 0, 1_024),
                planId: "test-plan-a"));

        var service = Service(account, store);
        (await service.GetEntitlementsAsync()).ManagedAiEnabled.Should().BeFalse();

        await store.ApplyChangeAsync(
            account,
            new CloudSubscriptionChange(
                new NostosPlanId("test-plan-b"),
                CloudSubscriptionStatus.Active,
                new CloudEntitlementSet(true, true, 500, 4_096),
                TrialEndsAtUtc: null,
                GraceEndsAtUtc: null,
                ChangeSource: "test"));

        var updated = await service.GetEntitlementsAsync();

        updated.ManagedAiEnabled.Should().BeTrue();
        updated.ManagedAiMonthlyAllowance.Should().Be(500);
        updated.StorageBytesLimit.Should().Be(4_096);
    }

    [Fact]
    public async Task Entitlement_service_can_only_read_the_trusted_current_account()
    {
        var accountA = Account("tenant-a");
        var accountB = Account("tenant-b");
        var store = new InMemorySubscriptionStore(
            Subscription(
                accountA,
                CloudSubscriptionStatus.Active,
                new CloudEntitlementSet(true, false, 0, 1_000),
                planId: "tenant-a-plan"),
            Subscription(
                accountB,
                CloudSubscriptionStatus.Active,
                new CloudEntitlementSet(true, true, 9_999, 9_999),
                planId: "tenant-b-plan"));

        var result = await Service(accountA, store).GetEntitlementsAsync();

        result.ManagedAiEnabled.Should().BeFalse();
        result.ManagedAiMonthlyAllowance.Should().Be(0);
        result.StorageBytesLimit.Should().Be(1_000);
    }

    [Fact]
    public void Product_facing_api_requires_no_plan_or_payment_provider_identifiers()
    {
        var method = typeof(ICloudEntitlementService)
            .GetMethod(nameof(ICloudEntitlementService.GetEntitlementsAsync));

        method.Should().NotBeNull();
        method!.GetParameters()
            .Select(parameter => parameter.ParameterType)
            .Should().Equal(typeof(CancellationToken));

        typeof(CloudEntitlementSnapshot)
            .GetProperties()
            .Select(property => property.Name)
            .Should().NotContain(name =>
                name.Contains("Plan", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Stripe", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Paddle", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Clerk", StringComparison.OrdinalIgnoreCase));
    }

    private static readonly CloudEntitlementSet StandardEntitlements =
        new(
            CloudAccess: true,
            ManagedAiEnabled: true,
            ManagedAiMonthlyAllowance: 100,
            StorageBytesLimit: 8_192);

    private static NostosAccountId Account(string subject) =>
        NostosAccountId.FromExternalIdentity("https://identity.example.test", subject);

    private static CloudEntitlementService Service(
        NostosAccountId accountId,
        ICloudSubscriptionStore store) =>
        new(
            new FixedTenantContextAccessor(
                new NostosAccountContext(accountId, "Test account", null)),
            store);

    private static CloudSubscriptionSnapshot Subscription(
        NostosAccountId accountId,
        CloudSubscriptionStatus status,
        CloudEntitlementSet entitlements,
        DateTime? trialEndsAtUtc = null,
        DateTime? graceEndsAtUtc = null,
        string planId = "test-plan") =>
        new(
            accountId,
            new NostosPlanId(planId),
            status,
            entitlements,
            trialEndsAtUtc,
            graceEndsAtUtc,
            DateTime.UtcNow);

    private sealed class FixedTenantContextAccessor(NostosAccountContext account)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() => account;
    }

    private sealed class InMemorySubscriptionStore(params CloudSubscriptionSnapshot[] subscriptions)
        : ICloudSubscriptionStore
    {
        private readonly Dictionary<NostosAccountId, CloudSubscriptionSnapshot> _subscriptions =
            subscriptions.ToDictionary(x => x.AccountId);

        public Task<CloudSubscriptionSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default)
        {
            _subscriptions.TryGetValue(accountId, out var subscription);
            return Task.FromResult(subscription);
        }

        public Task ApplyChangeAsync(
            NostosAccountId accountId,
            CloudSubscriptionChange change,
            CancellationToken cancellationToken = default)
        {
            change.Validate();
            _subscriptions[accountId] = new CloudSubscriptionSnapshot(
                accountId,
                change.PlanId,
                change.Status,
                change.Entitlements,
                change.TrialEndsAtUtc,
                change.GraceEndsAtUtc,
                DateTime.UtcNow);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<CloudSubscriptionAuditSnapshot>> ListAuditAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudSubscriptionAuditSnapshot>>([]);
    }
}
