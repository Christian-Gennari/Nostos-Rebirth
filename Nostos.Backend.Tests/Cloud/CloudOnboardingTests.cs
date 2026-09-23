using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Cloud.Billing;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Cloud.Onboarding;
using Nostos.Backend.Cloud.Provisioning;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudOnboardingTests
{
    private static readonly NostosAccountContext Account = new(
        NostosAccountId.FromExternalIdentity("https://identity.example.test", "onboarding-user"),
        "Reader",
        "reader@example.test");

    [Fact]
    public async Task Missing_subscription_blocks_provisioning_and_offers_checkout()
    {
        var harness = new Harness(
            entitlement: CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.None),
            resource: null);

        var state = await harness.Service.GetStateAsync();
        var provisioned = await harness.Service.ProvisionAsync();

        state.State.Should().Be(CloudOnboardingStates.SubscriptionRequired);
        state.CanCheckout.Should().BeTrue();
        state.Ready.Should().BeFalse();
        provisioned.State.Should().Be(CloudOnboardingStates.SubscriptionRequired);
        harness.Provisioner.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Checkout_in_progress_is_server_authoritative_and_does_not_grant_access()
    {
        var harness = new Harness(
            entitlement: CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.None),
            resource: null,
            billingBinding: new CloudBillingBindingSnapshot(
                Account.AccountId,
                PaddleBillingService.ProviderName,
                ExternalTransactionId: "txn_test",
                ExternalCustomerId: null,
                ExternalSubscriptionId: null,
                LastEventOccurredAtUtc: null,
                UpdatedAtUtc: DateTime.UtcNow));

        var state = await harness.Service.GetStateAsync();

        state.State.Should().Be(CloudOnboardingStates.SubscriptionPending);
        state.CanCheckout.Should().BeFalse();
        state.CanCheckSubscription.Should().BeTrue();
        state.Ready.Should().BeFalse();
    }

    [Theory]
    [InlineData(CloudSubscriptionStatus.PastDue)]
    [InlineData(CloudSubscriptionStatus.Cancelled)]
    [InlineData(CloudSubscriptionStatus.Expired)]
    public async Task Inactive_subscription_states_cannot_enter_or_provision(
        CloudSubscriptionStatus status)
    {
        var harness = new Harness(
            entitlement: CloudEntitlementSnapshot.Denied(status),
            resource: ReadyResource());

        var state = await harness.Service.GetStateAsync();

        state.State.Should().Be(CloudOnboardingStates.SubscriptionInactive);
        state.Ready.Should().BeFalse();
        harness.Provisioner.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Entitled_new_account_can_provision_and_retry_without_client_resource_selection()
    {
        var harness = new Harness(
            entitlement: ActiveEntitlement(),
            resource: null);

        harness.Provisioner.OnProvision = () =>
        {
            harness.Store.Resource = ReadyResource();
            return ReadyResult();
        };

        var before = await harness.Service.GetStateAsync();
        var after = await harness.Service.ProvisionAsync();

        before.State.Should().Be(CloudOnboardingStates.ReadyToProvision);
        after.State.Should().Be(CloudOnboardingStates.Ready);
        after.Ready.Should().BeTrue();
        harness.Provisioner.Calls.Should().Be(1);
        harness.Provisioner.LastAccountId.Should().Be(Account.AccountId);
    }

    [Fact]
    public async Task Failed_provisioning_is_product_safe_and_retryable()
    {
        var failed = Resource(
            CloudProvisioningState.Failed,
            CloudAccountStatus.Unknown,
            schemaVersion: null,
            failureCode: "database_create_failed");

        var harness = new Harness(ActiveEntitlement(), failed);

        var state = await harness.Service.GetStateAsync();
        var json = System.Text.Json.JsonSerializer.Serialize(state);

        state.State.Should().Be(CloudOnboardingStates.ProvisioningFailed);
        state.CanRetry.Should().BeTrue();
        json.Should().NotContain("DatabaseName");
        json.Should().NotContain("StorageNamespace");
        json.Should().NotContain("SchemaVersion");
        json.Should().NotContain("database_create_failed");
        json.Should().NotContain("nostos_u_");
    }

    [Fact]
    public async Task Existing_provisioning_and_ready_states_survive_refresh_without_duplicate_work()
    {
        var provisioning = Resource(
            CloudProvisioningState.Provisioning,
            CloudAccountStatus.Unknown);

        var harness = new Harness(ActiveEntitlement(), provisioning);

        var inProgress = await harness.Service.ProvisionAsync();
        harness.Provisioner.Calls.Should().Be(0);
        inProgress.State.Should().Be(CloudOnboardingStates.Provisioning);

        harness.Store.Resource = ReadyResource();
        var ready = await harness.Service.GetStateAsync();

        ready.State.Should().Be(CloudOnboardingStates.Ready);
        ready.Ready.Should().BeTrue();
    }

    [Theory]
    [InlineData(CloudAccountStatus.Disabled)]
    [InlineData(CloudAccountStatus.Deleted)]
    public async Task Disabled_or_deleted_account_cannot_self_reactivate(
        CloudAccountStatus status)
    {
        var harness = new Harness(
            ActiveEntitlement(),
            Resource(CloudProvisioningState.Failed, status));

        var state = await harness.Service.ProvisionAsync();

        state.State.Should().Be(CloudOnboardingStates.AccountUnavailable);
        state.CanRetry.Should().BeFalse();
        harness.Provisioner.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Checkout_uses_the_single_server_configured_cloud_plan()
    {
        var harness = new Harness(
            CloudEntitlementSnapshot.Denied(CloudSubscriptionStatus.None),
            resource: null);

        harness.Billing.Checkout = new CloudBillingCheckoutResponse(
            "cloud-standard",
            "https://checkout.example.test/session");

        var redirect = await harness.Service.CreateCheckoutAsync();

        redirect.Url.Should().Be("https://checkout.example.test/session");
        harness.Billing.LastCheckoutPlan.Should().Be(new NostosPlanId("cloud-standard"));
    }

    private static CloudEntitlementSnapshot ActiveEntitlement() =>
        new(
            CloudSubscriptionStatus.Active,
            CloudAccess: true,
            ManagedAiEnabled: true,
            ManagedAiMonthlyAllowance: 1_000_000,
            StorageBytesLimit: 10_000_000);

    private static CloudAccountResourceSnapshot ReadyResource() =>
        Resource(
            CloudProvisioningState.Ready,
            CloudAccountStatus.Active,
            CloudCustomerSchema.CurrentVersion);

    private static CloudAccountResourceSnapshot Resource(
        CloudProvisioningState provisioningState,
        CloudAccountStatus accountStatus,
        string? schemaVersion = null,
        string? failureCode = null) =>
        new(
            Account.AccountId,
            ResourceId: Guid.NewGuid(),
            DatabaseName: "nostos_u_internal_only",
            StorageNamespace: "accounts/internal-only",
            provisioningState,
            accountStatus,
            schemaVersion,
            failureCode,
            CreatedAtUtc: DateTime.UtcNow,
            UpdatedAtUtc: DateTime.UtcNow,
            LastProvisionAttemptAtUtc: null,
            ReadyAtUtc: provisioningState == CloudProvisioningState.Ready
                ? DateTime.UtcNow
                : null);

    private static CloudProvisioningResult ReadyResult() =>
        new(
            CloudProvisioningState.Ready,
            CloudAccountStatus.Active,
            CloudCustomerSchema.CurrentVersion,
            Ready: true,
            Retryable: false);

    private sealed class Harness
    {
        public Harness(
            CloudEntitlementSnapshot entitlement,
            CloudAccountResourceSnapshot? resource,
            CloudBillingBindingSnapshot? billingBinding = null)
        {
            Store = new FakeControlPlaneStore(resource);
            Provisioner = new FakeProvisioner();
            Billing = new FakeBillingService();
            BillingState = new FakeBillingStateStore(billingBinding);

            var options = new CloudBillingOptions
            {
                Plans =
                [
                    new CloudBillingPlanOptions
                    {
                        PlanId = "cloud-standard",
                        CloudAccess = true,
                        ManagedAiEnabled = true,
                    },
                ],
            };

            Service = new CloudOnboardingService(
                new FakeTenantContext(),
                Store,
                new FakeEntitlementService(entitlement),
                Provisioner,
                Billing,
                BillingState,
                options,
                NullLogger<CloudOnboardingService>.Instance);
        }

        public FakeControlPlaneStore Store { get; }
        public FakeProvisioner Provisioner { get; }
        public FakeBillingService Billing { get; }
        public FakeBillingStateStore BillingState { get; }
        public CloudOnboardingService Service { get; }
    }

    private sealed class FakeTenantContext : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() => Account;
    }

    private sealed class FakeEntitlementService(CloudEntitlementSnapshot snapshot)
        : ICloudEntitlementService
    {
        public Task<CloudEntitlementSnapshot> GetEntitlementsAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(snapshot);
    }

    private sealed class FakeControlPlaneStore(CloudAccountResourceSnapshot? resource)
        : ICloudControlPlaneStore
    {
        public CloudAccountResourceSnapshot? Resource { get; set; } = resource;

        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Resource);

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Resource ?? throw new InvalidOperationException());

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>(
                Resource is null ? [] : [Resource]);
    }

    private sealed class FakeProvisioner : ICloudCustomerDatabaseProvisioner
    {
        public int Calls { get; private set; }
        public NostosAccountId? LastAccountId { get; private set; }
        public Func<CloudProvisioningResult>? OnProvision { get; set; }

        public Task<CloudProvisioningResult> ProvisionAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastAccountId = accountId;
            return Task.FromResult(
                OnProvision?.Invoke()
                ?? new CloudProvisioningResult(
                    CloudProvisioningState.Failed,
                    CloudAccountStatus.Unknown,
                    null,
                    Ready: false,
                    Retryable: true));
        }
    }

    private sealed class FakeBillingService : ICloudBillingService
    {
        public CloudBillingCheckoutResponse Checkout { get; set; } =
            new("cloud-standard", "https://checkout.example.test/default");
        public NostosPlanId? LastCheckoutPlan { get; private set; }

        public Task<CloudBillingCheckoutResponse> CreateCheckoutAsync(
            NostosPlanId planId,
            CancellationToken cancellationToken = default)
        {
            LastCheckoutPlan = planId;
            return Task.FromResult(Checkout);
        }

        public Task<CloudBillingActionResponse> ChangePlanAsync(
            NostosPlanId planId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CloudBillingActionResponse("active"));

        public Task<CloudBillingActionResponse> CancelAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CloudBillingActionResponse("active"));

        public Task<CloudBillingManagementResponse> CreateManagementSessionAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CloudBillingManagementResponse(
                "https://billing.example.test/portal"));

        public Task ReconcileCurrentAsync(
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeBillingStateStore(CloudBillingBindingSnapshot? binding)
        : ICloudBillingStateStore
    {
        public Task<CloudBillingBindingSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(binding);

        public Task<CloudBillingBindingSnapshot?> FindBySubscriptionAsync(
            string provider,
            string externalSubscriptionId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<CloudBillingBindingSnapshot?>(null);

        public Task<IReadOnlyList<CloudBillingBindingSnapshot>> ListAsync(
            string provider,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudBillingBindingSnapshot>>([]);

        public Task SaveCheckoutAsync(
            NostosAccountId accountId,
            string provider,
            string externalTransactionId,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<CloudBillingReconciliationOutcome> ApplyProviderEventAsync(
            NostosAccountId accountId,
            string provider,
            string eventId,
            DateTime occurredAtUtc,
            string? externalTransactionId,
            string? externalCustomerId,
            string externalSubscriptionId,
            CloudSubscriptionChange change,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(CloudBillingReconciliationOutcome.Applied);
    }
}
