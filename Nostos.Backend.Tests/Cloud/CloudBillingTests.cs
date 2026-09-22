using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Cloud.Billing;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudBillingTests
{
    private const string WebhookSecret = "pdl_ntfset_test_secret";

    [Fact]
    public void Paddle_webhook_signature_verification_uses_raw_body_timestamp_and_constant_time_hash()
    {
        var now = DateTimeOffset.UtcNow;
        const string body = "{\"event_id\":\"evt_test\"}";
        var signature = Sign(body, now);

        PaddleWebhookVerifier.Verify(body, signature, WebhookSecret, now).Should().BeTrue();
        PaddleWebhookVerifier.Verify(body + " ", signature, WebhookSecret, now).Should().BeFalse();
        PaddleWebhookVerifier.Verify(body, "ts=1;h1=bad", WebhookSecret, now).Should().BeFalse();
        PaddleWebhookVerifier.Verify(
            body,
            signature,
            WebhookSecret,
            now.AddSeconds(6)).Should().BeFalse();
    }

    [Fact]
    public async Task Verified_subscription_events_map_trials_plan_changes_grace_past_due_and_cancellation()
    {
        var account = Account("lifecycle");
        var state = new RecordingBillingStateStore();
        var service = Service(account, state, new QueueHandler());
        var t0 = DateTime.UtcNow.AddMinutes(-10);
        var trialEnd = DateTime.UtcNow.AddDays(14);

        await Process(service, Event("evt_trial", account, "sub_lifecycle", "trialing", "pri_basic", t0, t0, trialEnd));
        state.LastChange!.Status.Should().Be(CloudSubscriptionStatus.Trial);
        state.LastChange.TrialEndsAtUtc.Should().Be(trialEnd);
        state.LastChange.PlanId.Should().Be(new NostosPlanId("basic"));

        await Process(service, Event("evt_active", account, "sub_lifecycle", "active", "pri_basic", t0.AddMinutes(1), t0.AddMinutes(1)));
        state.LastChange!.Status.Should().Be(CloudSubscriptionStatus.Active);

        await Process(service, Event("evt_upgrade", account, "sub_lifecycle", "active", "pri_pro", t0.AddMinutes(2), t0.AddMinutes(2)));
        state.LastChange!.PlanId.Should().Be(new NostosPlanId("pro"));

        await Process(service, Event("evt_downgrade", account, "sub_lifecycle", "active", "pri_basic", t0.AddMinutes(3), t0.AddMinutes(3)));
        state.LastChange!.PlanId.Should().Be(new NostosPlanId("basic"));

        var justPastDue = DateTime.UtcNow.AddMinutes(-5);
        await Process(service, Event("evt_grace", account, "sub_lifecycle", "past_due", "pri_basic", t0.AddMinutes(4), justPastDue));
        state.LastChange!.Status.Should().Be(CloudSubscriptionStatus.Grace);
        state.LastChange.GraceEndsAtUtc.Should().BeCloseTo(justPastDue.AddHours(24), TimeSpan.FromSeconds(1));

        var oldPastDue = DateTime.UtcNow.AddDays(-2);
        await Process(service, Event("evt_pastdue", account, "sub_lifecycle", "past_due", "pri_basic", t0.AddMinutes(5), oldPastDue));
        state.LastChange!.Status.Should().Be(CloudSubscriptionStatus.PastDue);

        await Process(service, Event("evt_cancel", account, "sub_lifecycle", "canceled", "pri_basic", t0.AddMinutes(6), t0.AddMinutes(6)));
        state.LastChange!.Status.Should().Be(CloudSubscriptionStatus.Cancelled);
    }

    [Fact]
    public async Task Duplicate_and_out_of_order_webhooks_do_not_reapply_subscription_state()
    {
        var account = Account("ordering");
        var state = new RecordingBillingStateStore();
        var service = Service(account, state, new QueueHandler());
        var newest = DateTime.UtcNow;

        var body = Event("evt_once", account, "sub_order", "active", "pri_pro", newest, newest);
        var first = await Process(service, body);
        var second = await Process(service, body);

        first.Should().Be(CloudBillingReconciliationOutcome.Applied);
        second.Should().Be(CloudBillingReconciliationOutcome.Duplicate);
        state.AppliedCount.Should().Be(1);

        var old = newest.AddMinutes(-5);
        var stale = await Process(
            service,
            Event("evt_old", account, "sub_order", "active", "pri_basic", old, old));

        stale.Should().Be(CloudBillingReconciliationOutcome.IgnoredStale);
        state.LastChange!.PlanId.Should().Be(new NostosPlanId("pro"));
        state.AppliedCount.Should().Be(1);
    }

    [Fact]
    public async Task Invalid_webhook_signature_is_rejected_before_state_changes()
    {
        var account = Account("signature");
        var state = new RecordingBillingStateStore();
        var service = Service(account, state, new QueueHandler());
        var body = Event(
            "evt_bad",
            account,
            "sub_bad",
            "active",
            "pri_basic",
            DateTime.UtcNow,
            DateTime.UtcNow);

        Func<Task> act = async () =>
            await service.ProcessAsync(body, "ts=1;h1=invalid");

        await act.Should().ThrowAsync<PaddleWebhookSignatureException>();
        state.AppliedCount.Should().Be(0);
    }

    [Fact]
    public async Task Billing_event_for_account_a_cannot_move_same_provider_subscription_to_account_b()
    {
        var accountA = Account("account-a");
        var accountB = Account("account-b");
        var state = new RecordingBillingStateStore();
        var serviceA = Service(accountA, state, new QueueHandler());
        var serviceB = Service(accountB, state, new QueueHandler());
        var now = DateTime.UtcNow;

        await Process(serviceA, Event("evt_a", accountA, "sub_shared", "active", "pri_basic", now, now));

        Func<Task> act = async () =>
            await Process(
                serviceB,
                Event("evt_b", accountB, "sub_shared", "active", "pri_pro", now.AddSeconds(1), now.AddSeconds(1)));

        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*more than one Nostos account*");
        state.LastChangeByAccount.Should().NotContainKey(accountB);
    }

    [Fact]
    public async Task Checkout_is_server_created_and_does_not_activate_entitlements_from_browser_return()
    {
        var account = Account("checkout");
        var state = new RecordingBillingStateStore();
        var handler = new QueueHandler();
        handler.Enqueue(
            HttpStatusCode.Created,
            """
            {"data":{"id":"txn_checkout","subscription_id":null,"checkout":{"url":"https://nostos.example.test/pay?_ptxn=txn_checkout"}}}
            """);

        var service = Service(account, state, handler);
        var result = await service.CreateCheckoutAsync(new NostosPlanId("basic"));

        result.PlanId.Should().Be("basic");
        result.CheckoutUrl.Should().Contain("txn_checkout");
        state.Bindings[account].ExternalTransactionId.Should().Be("txn_checkout");
        state.LastChange.Should().BeNull();

        var request = handler.Requests.Should().ContainSingle().Which;
        request.Method.Should().Be(HttpMethod.Post);
        request.Path.Should().Be("/transactions");
        request.Body.Should().Contain("\"price_id\":\"pri_basic\"");
        request.Body.Should().Contain("\"enable_checkout\":true");
        request.Body.Should().Contain(account.ToString());
    }

    [Fact]
    public async Task Upgrade_and_downgrade_replace_only_the_mapped_base_price()
    {
        var account = Account("plan-change");
        var state = new RecordingBillingStateStore();
        state.SeedBinding(account, transactionId: "txn_1", customerId: "ctm_1", subscriptionId: "sub_1");

        var handler = new QueueHandler();
        handler.Enqueue(HttpStatusCode.OK, SubscriptionEnvelope("sub_1", "active", "ctm_1", "pri_basic", DateTime.UtcNow));
        handler.Enqueue(HttpStatusCode.OK, SubscriptionEnvelope("sub_1", "active", "ctm_1", "pri_pro", DateTime.UtcNow.AddSeconds(1)));
        handler.Enqueue(HttpStatusCode.OK, SubscriptionEnvelope("sub_1", "active", "ctm_1", "pri_pro", DateTime.UtcNow.AddSeconds(2)));
        handler.Enqueue(HttpStatusCode.OK, SubscriptionEnvelope("sub_1", "active", "ctm_1", "pri_basic", DateTime.UtcNow.AddSeconds(3)));

        var service = Service(account, state, handler);

        await service.ChangePlanAsync(new NostosPlanId("pro"));
        state.LastChange!.PlanId.Should().Be(new NostosPlanId("pro"));

        await service.ChangePlanAsync(new NostosPlanId("basic"));
        state.LastChange!.PlanId.Should().Be(new NostosPlanId("basic"));

        var patches = handler.Requests.Where(x => x.Method == HttpMethod.Patch).ToList();
        patches.Should().HaveCount(2);
        patches[0].Body.Should().Contain("\"price_id\":\"pri_pro\"");
        patches[0].Body.Should().Contain("\"proration_billing_mode\":\"prorated_immediately\"");
        patches[1].Body.Should().Contain("\"price_id\":\"pri_basic\"");
    }

    [Fact]
    public async Task Cancellation_and_customer_portal_use_provider_api_without_deleting_data()
    {
        var account = Account("management");
        var state = new RecordingBillingStateStore();
        state.SeedBinding(account, transactionId: "txn_1", customerId: "ctm_1", subscriptionId: "sub_1");

        var handler = new QueueHandler();
        handler.Enqueue(HttpStatusCode.OK, SubscriptionEnvelope("sub_1", "active", "ctm_1", "pri_basic", DateTime.UtcNow));
        handler.Enqueue(
            HttpStatusCode.Created,
            """
            {"data":{"urls":{"general":{"overview":"https://customer-portal.paddle.com/session"}}}}
            """);

        var service = Service(account, state, handler);

        var cancellation = await service.CancelAsync();
        cancellation.Status.Should().Be("active");
        state.CustomerDataDeleteCalls.Should().Be(0);

        var portal = await service.CreateManagementSessionAsync();
        portal.Url.Should().StartWith("https://customer-portal.paddle.com/");

        handler.Requests.Should().Contain(x =>
            x.Method == HttpMethod.Post && x.Path == "/subscriptions/sub_1/cancel");
        handler.Requests.Should().Contain(x =>
            x.Method == HttpMethod.Post && x.Path == "/customers/ctm_1/portal-sessions");
    }

    [Fact]
    public async Task Reconciliation_recovers_a_subscription_when_checkout_webhook_was_missed()
    {
        var account = Account("missed-event");
        var state = new RecordingBillingStateStore();
        state.SeedBinding(account, transactionId: "txn_missed", customerId: null, subscriptionId: null);

        var handler = new QueueHandler();
        handler.Enqueue(
            HttpStatusCode.OK,
            """
            {"data":{"id":"txn_missed","subscription_id":"sub_recovered","checkout":{"url":null}}}
            """);
        handler.Enqueue(
            HttpStatusCode.OK,
            SubscriptionEnvelope("sub_recovered", "active", "ctm_recovered", "pri_pro", DateTime.UtcNow));

        var service = Service(account, state, handler);
        await service.ReconcileCurrentAsync();

        state.LastChange!.Status.Should().Be(CloudSubscriptionStatus.Active);
        state.LastChange.PlanId.Should().Be(new NostosPlanId("pro"));
        state.Bindings[account].ExternalSubscriptionId.Should().Be("sub_recovered");
        state.Bindings[account].ExternalCustomerId.Should().Be("ctm_recovered");
    }

    [Fact]
    public void Provider_mapping_uses_Nostos_owned_plan_identity_and_external_ids_stay_out_of_entitlement_api()
    {
        var options = Options();

        options.ResolvePlanForPaddlePrice("pri_pro").PlanId.Should().Be(new NostosPlanId("pro"));
        options.ResolvePaddlePrice(new NostosPlanId("basic")).Should().Be("pri_basic");

        typeof(CloudEntitlementSnapshot)
            .GetProperties()
            .Select(x => x.Name)
            .Should().NotContain(name =>
                name.Contains("Paddle", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Price", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Customer", StringComparison.OrdinalIgnoreCase)
                || name.Contains("SubscriptionId", StringComparison.OrdinalIgnoreCase));
    }

    private static PaddleBillingService Service(
        NostosAccountId account,
        RecordingBillingStateStore state,
        QueueHandler handler)
    {
        var options = Options();
        var client = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://sandbox-api.paddle.com/"),
        };
        var api = new PaddleApiClient(
            client,
            new PaddleBillingSecrets("test-api-key", WebhookSecret));

        return new PaddleBillingService(
            options,
            api,
            state,
            new FakeControlPlaneStore(),
            new FixedTenantContextAccessor(account),
            NullLogger<PaddleBillingService>.Instance);
    }

    private static CloudBillingOptions Options() =>
        new()
        {
            PastDueGraceHours = 24,
            ReconciliationIntervalMinutes = 15,
            Plans =
            [
                new CloudBillingPlanOptions
                {
                    PlanId = "basic",
                    CloudAccess = true,
                    ManagedAiEnabled = false,
                    ManagedAiMonthlyAllowance = 0,
                    StorageBytesLimit = 1_000,
                },
                new CloudBillingPlanOptions
                {
                    PlanId = "pro",
                    CloudAccess = true,
                    ManagedAiEnabled = true,
                    ManagedAiMonthlyAllowance = 500,
                    StorageBytesLimit = 5_000,
                },
            ],
            Paddle = new PaddleBillingOptions
            {
                Environment = "Sandbox",
                CheckoutUrl = "https://nostos.example.test/pay",
                PriceMappings =
                [
                    new PaddlePriceMappingOptions { PriceId = "pri_basic", PlanId = "basic" },
                    new PaddlePriceMappingOptions { PriceId = "pri_pro", PlanId = "pro" },
                ],
            },
        };

    private static async Task<CloudBillingReconciliationOutcome?> Process(
        PaddleBillingService service,
        string body)
    {
        var now = DateTimeOffset.UtcNow;
        return await service.ProcessAsync(body, Sign(body, now));
    }

    private static string Sign(string body, DateTimeOffset now)
    {
        var timestamp = now.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(WebhookSecret));
        var hash = Convert.ToHexString(
            hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}:{body}")))
            .ToLowerInvariant();
        return $"ts={timestamp};h1={hash}";
    }

    private static string Event(
        string eventId,
        NostosAccountId account,
        string subscriptionId,
        string status,
        string priceId,
        DateTime occurredAtUtc,
        DateTime updatedAtUtc,
        DateTime? nextBilledAtUtc = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["event_id"] = eventId,
            ["event_type"] = "subscription.updated",
            ["occurred_at"] = occurredAtUtc,
            ["data"] = new Dictionary<string, object?>
            {
                ["id"] = subscriptionId,
                ["status"] = status,
                ["customer_id"] = $"ctm_{account.Value:N}",
                ["transaction_id"] = null,
                ["custom_data"] = new Dictionary<string, string>
                {
                    ["nostos_account_id"] = account.ToString(),
                },
                ["next_billed_at"] = nextBilledAtUtc,
                ["updated_at"] = updatedAtUtc,
                ["items"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["quantity"] = 1,
                        ["price"] = new Dictionary<string, string>
                        {
                            ["id"] = priceId,
                        },
                    },
                },
            },
        };

        return JsonSerializer.Serialize(payload);
    }

    private static string SubscriptionEnvelope(
        string subscriptionId,
        string status,
        string customerId,
        string priceId,
        DateTime updatedAtUtc) =>
        JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["data"] = new Dictionary<string, object?>
            {
                ["id"] = subscriptionId,
                ["status"] = status,
                ["customer_id"] = customerId,
                ["transaction_id"] = null,
                ["custom_data"] = null,
                ["next_billed_at"] = updatedAtUtc.AddMonths(1),
                ["updated_at"] = updatedAtUtc,
                ["items"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["quantity"] = 1,
                        ["price"] = new Dictionary<string, string>
                        {
                            ["id"] = priceId,
                        },
                    },
                },
            },
        });

    private static NostosAccountId Account(string subject) =>
        NostosAccountId.FromExternalIdentity("https://identity.example.test", subject);

    private sealed class FixedTenantContextAccessor(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(accountId, "Test account", "reader@example.test");
    }

    private sealed class RecordingBillingStateStore : ICloudBillingStateStore
    {
        private readonly HashSet<string> _events = new(StringComparer.Ordinal);
        private readonly Dictionary<NostosAccountId, DateTime> _lastOccurredAt = [];

        public Dictionary<NostosAccountId, CloudBillingBindingSnapshot> Bindings { get; } = [];
        public Dictionary<NostosAccountId, CloudSubscriptionChange> LastChangeByAccount { get; } = [];
        public CloudSubscriptionChange? LastChange { get; private set; }
        public int AppliedCount { get; private set; }
        public int CustomerDataDeleteCalls { get; private set; }

        public void SeedBinding(
            NostosAccountId accountId,
            string? transactionId,
            string? customerId,
            string? subscriptionId)
        {
            Bindings[accountId] = new CloudBillingBindingSnapshot(
                accountId,
                PaddleBillingService.ProviderName,
                transactionId,
                customerId,
                subscriptionId,
                null,
                DateTime.UtcNow);
        }

        public Task<CloudBillingBindingSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(
                Bindings.TryGetValue(accountId, out var value)
                    ? value
                    : null);

        public Task<CloudBillingBindingSnapshot?> FindBySubscriptionAsync(
            string provider,
            string externalSubscriptionId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(
                Bindings.Values.SingleOrDefault(x =>
                    x.Provider == provider
                    && x.ExternalSubscriptionId == externalSubscriptionId));

        public Task<IReadOnlyList<CloudBillingBindingSnapshot>> ListAsync(
            string provider,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudBillingBindingSnapshot>>(
                Bindings.Values.Where(x => x.Provider == provider).ToList());

        public Task SaveCheckoutAsync(
            NostosAccountId accountId,
            string provider,
            string externalTransactionId,
            CancellationToken cancellationToken = default)
        {
            Bindings[accountId] = new CloudBillingBindingSnapshot(
                accountId,
                provider,
                externalTransactionId,
                null,
                null,
                null,
                DateTime.UtcNow);
            return Task.CompletedTask;
        }

        public Task<CloudBillingReconciliationOutcome> ApplyProviderEventAsync(
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
            var eventKey = $"{provider}:{eventId}";
            if (!_events.Add(eventKey))
                return Task.FromResult(CloudBillingReconciliationOutcome.Duplicate);

            var conflicting = Bindings.Values.Any(x =>
                x.Provider == provider
                && x.ExternalSubscriptionId == externalSubscriptionId
                && x.AccountId != accountId);
            if (conflicting)
            {
                throw new InvalidOperationException(
                    "A billing subscription cannot be reconciled into more than one Nostos account.");
            }

            if (_lastOccurredAt.TryGetValue(accountId, out var last)
                && occurredAtUtc < last)
            {
                return Task.FromResult(CloudBillingReconciliationOutcome.IgnoredStale);
            }

            Bindings.TryGetValue(accountId, out var existing);
            Bindings[accountId] = new CloudBillingBindingSnapshot(
                accountId,
                provider,
                externalTransactionId ?? existing?.ExternalTransactionId,
                externalCustomerId ?? existing?.ExternalCustomerId,
                externalSubscriptionId,
                occurredAtUtc,
                DateTime.UtcNow);

            _lastOccurredAt[accountId] = occurredAtUtc;
            LastChange = change;
            LastChangeByAccount[accountId] = change;
            AppliedCount++;
            return Task.FromResult(CloudBillingReconciliationOutcome.Applied);
        }
    }

    private sealed class FakeControlPlaneStore : ICloudControlPlaneStore
    {
        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<CloudAccountResourceSnapshot?>(null);

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CloudAccountResourceSnapshot(
                accountId,
                Guid.NewGuid(),
                "nostos_test",
                "tests/account",
                CloudProvisioningState.Pending,
                CloudAccountStatus.Unknown,
                null,
                null,
                DateTime.UtcNow,
                DateTime.UtcNow,
                null,
                null));

        public Task MarkProvisioningAsync(NostosAccountId accountId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
        public Task MarkReadyAsync(NostosAccountId accountId, string schemaVersion, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
        public Task MarkFailedAsync(NostosAccountId accountId, string failureCode, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
        public Task MarkSchemaVersionAsync(NostosAccountId accountId, string schemaVersion, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
        public Task MarkSchemaFailureAsync(NostosAccountId accountId, string failureCode, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>([]);
    }

    private sealed class QueueHandler : HttpMessageHandler
    {
        private readonly Queue<(HttpStatusCode Status, string Body)> _responses = new();

        public List<CapturedRequest> Requests { get; } = [];

        public void Enqueue(HttpStatusCode status, string body) =>
            _responses.Enqueue((status, body));

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken);

            Requests.Add(new CapturedRequest(
                request.Method,
                request.RequestUri?.AbsolutePath ?? string.Empty,
                body));

            if (_responses.Count == 0)
                throw new InvalidOperationException("No fake Paddle response was queued.");

            var next = _responses.Dequeue();
            return new HttpResponseMessage(next.Status)
            {
                Content = new StringContent(next.Body, Encoding.UTF8, "application/json"),
            };
        }
    }

    private sealed record CapturedRequest(
        HttpMethod Method,
        string Path,
        string Body);
}
