using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Hosting;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Billing;

public sealed record CloudBillingCheckoutResponse(
    string PlanId,
    string CheckoutUrl);

public sealed record CloudBillingManagementResponse(
    string Url);

public sealed record CloudBillingActionResponse(
    string Status);

public interface ICloudBillingService
{
    Task<CloudBillingCheckoutResponse> CreateCheckoutAsync(
        NostosPlanId planId,
        CancellationToken cancellationToken = default);

    Task<CloudBillingActionResponse> ChangePlanAsync(
        NostosPlanId planId,
        CancellationToken cancellationToken = default);

    Task<CloudBillingActionResponse> CancelAsync(
        CancellationToken cancellationToken = default);

    Task<CloudBillingManagementResponse> CreateManagementSessionAsync(
        CancellationToken cancellationToken = default);

    Task ReconcileCurrentAsync(CancellationToken cancellationToken = default);
}

public interface ICloudBillingWebhookProcessor
{
    Task<CloudBillingReconciliationOutcome?> ProcessAsync(
        string rawBody,
        string signature,
        CancellationToken cancellationToken = default);
}

public sealed class PaddleBillingService(
    CloudBillingOptions options,
    PaddleApiClient api,
    ICloudBillingStateStore state,
    ICloudControlPlaneStore controlPlane,
    ICloudTenantContextAccessor tenantContext,
    ILogger<PaddleBillingService> logger)
    : ICloudBillingService, ICloudBillingWebhookProcessor
{
    public const string ProviderName = "Paddle";

    public async Task<CloudBillingCheckoutResponse> CreateCheckoutAsync(
        NostosPlanId planId,
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        _ = await controlPlane.GetOrCreateAsync(account.AccountId, cancellationToken);

        var existing = await state.FindAsync(account.AccountId, cancellationToken);
        if (!string.IsNullOrWhiteSpace(existing?.ExternalSubscriptionId))
        {
            throw new InvalidOperationException(
                "This Nostos account already has a billing subscription. Use the plan-change flow instead of creating a second checkout.");
        }

        var plan = options.ResolvePlan(planId);
        var priceId = options.ResolvePaddlePrice(plan.PlanId);

        var transaction = await api.CreateCheckoutTransactionAsync(
            priceId,
            account.AccountId,
            plan.PlanId,
            options.Paddle.CheckoutUrl,
            cancellationToken);

        if (string.IsNullOrWhiteSpace(transaction.Checkout?.Url))
            throw new InvalidOperationException("Paddle did not return a checkout URL.");

        await state.SaveCheckoutAsync(
            account.AccountId,
            ProviderName,
            transaction.Id,
            cancellationToken);

        return new CloudBillingCheckoutResponse(plan.PlanId.Value, transaction.Checkout.Url);
    }

    public async Task<CloudBillingActionResponse> ChangePlanAsync(
        NostosPlanId planId,
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var binding = await RequireBindingAsync(account.AccountId, cancellationToken);
        var current = await api.GetSubscriptionAsync(
            binding.ExternalSubscriptionId!,
            cancellationToken);

        var target = options.ResolvePlan(planId);
        var targetPriceId = options.ResolvePaddlePrice(target.PlanId);
        var basePriceIds = options.Paddle.PriceMappings
            .Select(x => x.PriceId)
            .ToHashSet(StringComparer.Ordinal);

        var replacement = new List<PaddleSubscriptionUpdateItem>();
        var replacedBasePlan = false;

        foreach (var item in current.Items)
        {
            if (basePriceIds.Contains(item.Price.Id))
            {
                if (!replacedBasePlan)
                {
                    replacement.Add(new PaddleSubscriptionUpdateItem(targetPriceId, item.Quantity));
                    replacedBasePlan = true;
                }

                continue;
            }

            replacement.Add(new PaddleSubscriptionUpdateItem(item.Price.Id, item.Quantity));
        }

        if (!replacedBasePlan)
        {
            throw new InvalidOperationException(
                "The current Paddle subscription has no base price mapped to a Nostos plan.");
        }

        var prorationMode = string.Equals(current.Status, "trialing", StringComparison.Ordinal)
            ? "do_not_bill"
            : "prorated_immediately";

        var updated = await api.UpdateSubscriptionAsync(
            current.Id,
            replacement,
            prorationMode,
            cancellationToken);

        await ReconcileSubscriptionAsync(
            account.AccountId,
            updated,
            eventId: null,
            occurredAtUtc: updated.UpdatedAtUtc,
            transactionId: null,
            cancellationToken);

        return new CloudBillingActionResponse(updated.Status);
    }

    public async Task<CloudBillingActionResponse> CancelAsync(
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var binding = await RequireBindingAsync(account.AccountId, cancellationToken);

        var updated = await api.CancelSubscriptionAsync(
            binding.ExternalSubscriptionId!,
            cancellationToken);

        // Paddle normally schedules cancellation for the end of the billing
        // period, so this may remain Active until subscription.canceled arrives.
        await ReconcileSubscriptionAsync(
            account.AccountId,
            updated,
            eventId: null,
            occurredAtUtc: updated.UpdatedAtUtc,
            transactionId: null,
            cancellationToken);

        return new CloudBillingActionResponse(updated.Status);
    }

    public async Task<CloudBillingManagementResponse> CreateManagementSessionAsync(
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var binding = await RequireBindingAsync(account.AccountId, cancellationToken);

        if (string.IsNullOrWhiteSpace(binding.ExternalCustomerId))
        {
            await ReconcileAccountAsync(account.AccountId, cancellationToken);
            binding = await RequireBindingAsync(account.AccountId, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(binding.ExternalCustomerId))
            throw new InvalidOperationException("The Paddle customer is not available yet.");

        var url = await api.CreateCustomerPortalSessionAsync(
            binding.ExternalCustomerId,
            binding.ExternalSubscriptionId!,
            cancellationToken);

        return new CloudBillingManagementResponse(url);
    }

    public async Task ReconcileCurrentAsync(CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        await ReconcileAccountAsync(account.AccountId, cancellationToken);
    }

    public async Task<CloudBillingReconciliationOutcome?> ProcessAsync(
        string rawBody,
        string signature,
        CancellationToken cancellationToken = default)
    {
        if (!PaddleWebhookVerifier.Verify(
            rawBody,
            signature,
            api.WebhookSecret,
            DateTimeOffset.UtcNow))
        {
            throw new PaddleWebhookSignatureException();
        }

        PaddleWebhookEvent webhook;
        try
        {
            webhook = JsonSerializer.Deserialize<PaddleWebhookEvent>(
                rawBody,
                PaddleApiClient.JsonOptions)
                ?? throw new JsonException("Webhook body is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Paddle webhook JSON is invalid.", exception);
        }

        if (!webhook.EventType.StartsWith("subscription.", StringComparison.Ordinal))
            return null;

        var subscription = webhook.Data;
        var accountId = TryGetAccountId(subscription.CustomData);

        if (accountId is null)
        {
            var binding = await state.FindBySubscriptionAsync(
                ProviderName,
                subscription.Id,
                cancellationToken);

            accountId = binding?.AccountId;
        }

        if (accountId is null)
        {
            logger.LogWarning(
                "Ignoring verified Paddle event {EventId}: subscription {SubscriptionId} is not linked to a Nostos account.",
                webhook.EventId,
                subscription.Id);
            return null;
        }

        return await ReconcileSubscriptionAsync(
            accountId.Value,
            subscription,
            webhook.EventId,
            webhook.OccurredAtUtc,
            subscription.TransactionId,
            cancellationToken);
    }

    internal async Task ReconcileAccountAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var binding = await state.FindAsync(accountId, cancellationToken);
        if (binding is null)
            return;

        var subscriptionId = binding.ExternalSubscriptionId;

        if (string.IsNullOrWhiteSpace(subscriptionId)
            && !string.IsNullOrWhiteSpace(binding.ExternalTransactionId))
        {
            var transaction = await api.GetTransactionAsync(
                binding.ExternalTransactionId,
                cancellationToken);
            subscriptionId = transaction.SubscriptionId;
        }

        if (string.IsNullOrWhiteSpace(subscriptionId))
            return;

        var subscription = await api.GetSubscriptionAsync(subscriptionId, cancellationToken);
        var sourceOccurredAtUtc = binding.LastEventOccurredAtUtc is { } last
            && last > subscription.UpdatedAtUtc
                ? last
                : subscription.UpdatedAtUtc;

        await ReconcileSubscriptionAsync(
            accountId,
            subscription,
            eventId: null,
            sourceOccurredAtUtc,
            binding.ExternalTransactionId,
            cancellationToken);
    }

    private async Task<CloudBillingBindingSnapshot> RequireBindingAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var binding = await state.FindAsync(accountId, cancellationToken);
        if (binding is null || string.IsNullOrWhiteSpace(binding.ExternalSubscriptionId))
            throw new InvalidOperationException("This Nostos account has no Paddle subscription yet.");

        return binding;
    }

    private async Task<CloudBillingReconciliationOutcome> ReconcileSubscriptionAsync(
        NostosAccountId accountId,
        PaddleSubscription subscription,
        string? eventId,
        DateTime occurredAtUtc,
        string? transactionId,
        CancellationToken cancellationToken)
    {
        var plan = ResolvePlan(subscription);
        var lifecycle = MapLifecycle(subscription);
        eventId ??= ReconciliationEventId(subscription, lifecycle.Status);

        var change = new CloudSubscriptionChange(
            plan.PlanId,
            lifecycle.Status,
            plan.Entitlements,
            lifecycle.TrialEndsAtUtc,
            lifecycle.GraceEndsAtUtc,
            ChangeSource: "paddle",
            ReconciliationReference: $"paddle:{eventId}");

        var outcome = await state.ApplyProviderEventAsync(
            accountId,
            ProviderName,
            eventId,
            occurredAtUtc,
            transactionId,
            subscription.CustomerId,
            subscription.Id,
            change,
            cancellationToken);

        logger.LogInformation(
            "Paddle subscription event reconciled for account {AccountId}: event {EventId}, outcome {Outcome}, Nostos status {Status}.",
            accountId,
            eventId,
            outcome,
            lifecycle.Status);

        return outcome;
    }

    private CloudBillingPlan ResolvePlan(PaddleSubscription subscription)
    {
        var mapped = subscription.Items
            .Select(item => options.Paddle.PriceMappings.SingleOrDefault(
                mapping => string.Equals(mapping.PriceId, item.Price.Id, StringComparison.Ordinal)))
            .Where(mapping => mapping is not null)
            .Select(mapping => mapping!)
            .DistinctBy(mapping => mapping.PlanId, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (mapped.Count != 1)
        {
            throw new InvalidOperationException(
                $"Paddle subscription '{subscription.Id}' must contain exactly one base price mapped to a Nostos plan; found {mapped.Count}.");
        }

        return options.ResolvePlan(new NostosPlanId(mapped[0].PlanId));
    }

    private PaddleLifecycleMapping MapLifecycle(PaddleSubscription subscription)
    {
        switch (subscription.Status)
        {
            case "trialing":
                var trialEnd = subscription.NextBilledAtUtc
                    ?? throw new InvalidOperationException(
                        $"Trialing Paddle subscription '{subscription.Id}' has no next_billed_at timestamp.");
                return new PaddleLifecycleMapping(
                    CloudSubscriptionStatus.Trial,
                    trialEnd,
                    GraceEndsAtUtc: null);

            case "active":
                return new PaddleLifecycleMapping(
                    CloudSubscriptionStatus.Active,
                    TrialEndsAtUtc: null,
                    GraceEndsAtUtc: null);

            case "past_due":
                var graceEnd = subscription.UpdatedAtUtc.AddHours(options.PastDueGraceHours);
                if (DateTime.UtcNow < graceEnd)
                {
                    return new PaddleLifecycleMapping(
                        CloudSubscriptionStatus.Grace,
                        TrialEndsAtUtc: null,
                        GraceEndsAtUtc: graceEnd);
                }

                return new PaddleLifecycleMapping(
                    CloudSubscriptionStatus.PastDue,
                    TrialEndsAtUtc: null,
                    GraceEndsAtUtc: null);

            case "canceled":
            case "paused":
                return new PaddleLifecycleMapping(
                    CloudSubscriptionStatus.Cancelled,
                    TrialEndsAtUtc: null,
                    GraceEndsAtUtc: null);

            default:
                throw new InvalidOperationException(
                    $"Unsupported Paddle subscription status '{subscription.Status}'.");
        }
    }

    private static NostosAccountId? TryGetAccountId(JsonElement? customData)
    {
        if (customData is not { ValueKind: JsonValueKind.Object } value
            || !value.TryGetProperty("nostos_account_id", out var property)
            || property.ValueKind != JsonValueKind.String
            || !Guid.TryParse(property.GetString(), out var id))
        {
            return null;
        }

        return new NostosAccountId(id);
    }

    private static string ReconciliationEventId(
        PaddleSubscription subscription,
        CloudSubscriptionStatus status) =>
        $"reconcile-{subscription.Id}-{new DateTimeOffset(DateTime.SpecifyKind(subscription.UpdatedAtUtc, DateTimeKind.Utc)).ToUnixTimeMilliseconds()}-{status}";

    private sealed record PaddleLifecycleMapping(
        CloudSubscriptionStatus Status,
        DateTime? TrialEndsAtUtc,
        DateTime? GraceEndsAtUtc);
}

public sealed class PaddleBillingReconciliationWorker(
    IServiceScopeFactory scopeFactory,
    CloudBillingOptions options,
    ILogger<PaddleBillingReconciliationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(
            TimeSpan.FromMinutes(options.ReconciliationIntervalMinutes));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var state = scope.ServiceProvider.GetRequiredService<ICloudBillingStateStore>();
                var service = scope.ServiceProvider.GetRequiredService<PaddleBillingService>();

                var bindings = await state.ListAsync(PaddleBillingService.ProviderName, stoppingToken);
                foreach (var binding in bindings)
                {
                    try
                    {
                        await service.ReconcileAccountAsync(binding.AccountId, stoppingToken);
                    }
                    catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                    {
                        logger.LogWarning(
                            exception,
                            "Paddle reconciliation failed for Nostos account {AccountId}; it will be retried.",
                            binding.AccountId);
                    }
                }
            }
            catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning(exception, "Paddle reconciliation pass failed; it will be retried.");
            }
        }
    }
}

public sealed class PaddleApiClient(
    HttpClient httpClient,
    PaddleBillingSecrets secrets)
{
    public const string HttpClientName = "nostos-cloud-paddle";
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    public string WebhookSecret => secrets.WebhookSecret;

    public async Task<PaddleTransaction> CreateCheckoutTransactionAsync(
        string priceId,
        NostosAccountId accountId,
        NostosPlanId planId,
        string checkoutUrl,
        CancellationToken cancellationToken)
    {
        var request = new
        {
            items = new[] { new { price_id = priceId, quantity = 1 } },
            custom_data = new
            {
                nostos_account_id = accountId.ToString(),
                nostos_plan_id = planId.Value,
            },
            checkout = new { url = checkoutUrl },
        };

        return await SendAsync<PaddleTransaction>(
            HttpMethod.Post,
            "transactions",
            request,
            cancellationToken);
    }

    public Task<PaddleTransaction> GetTransactionAsync(
        string transactionId,
        CancellationToken cancellationToken) =>
        SendAsync<PaddleTransaction>(
            HttpMethod.Get,
            $"transactions/{Uri.EscapeDataString(transactionId)}",
            body: null,
            cancellationToken);

    public Task<PaddleSubscription> GetSubscriptionAsync(
        string subscriptionId,
        CancellationToken cancellationToken) =>
        SendAsync<PaddleSubscription>(
            HttpMethod.Get,
            $"subscriptions/{Uri.EscapeDataString(subscriptionId)}",
            body: null,
            cancellationToken);

    public Task<PaddleSubscription> UpdateSubscriptionAsync(
        string subscriptionId,
        IReadOnlyList<PaddleSubscriptionUpdateItem> items,
        string prorationMode,
        CancellationToken cancellationToken) =>
        SendAsync<PaddleSubscription>(
            HttpMethod.Patch,
            $"subscriptions/{Uri.EscapeDataString(subscriptionId)}",
            new
            {
                items = items.Select(item => new
                {
                    price_id = item.PriceId,
                    quantity = item.Quantity,
                }),
                proration_billing_mode = prorationMode,
                on_payment_failure = "prevent_change",
            },
            cancellationToken);

    public Task<PaddleSubscription> CancelSubscriptionAsync(
        string subscriptionId,
        CancellationToken cancellationToken) =>
        SendAsync<PaddleSubscription>(
            HttpMethod.Post,
            $"subscriptions/{Uri.EscapeDataString(subscriptionId)}/cancel",
            new { },
            cancellationToken);

    public async Task<string> CreateCustomerPortalSessionAsync(
        string customerId,
        string subscriptionId,
        CancellationToken cancellationToken)
    {
        var portal = await SendAsync<PaddlePortalSession>(
            HttpMethod.Post,
            $"customers/{Uri.EscapeDataString(customerId)}/portal-sessions",
            new { subscription_ids = new[] { subscriptionId } },
            cancellationToken);

        if (string.IsNullOrWhiteSpace(portal.Urls?.General?.Overview))
            throw new InvalidOperationException("Paddle did not return a customer portal URL.");

        return portal.Urls.General.Overview;
    }

    private async Task<T> SendAsync<T>(
        HttpMethod method,
        string relativeUrl,
        object? body,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, relativeUrl);
        if (body is not null)
            request.Content = JsonContent.Create(body);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var requestId = response.Headers.TryGetValues("Request-Id", out var values)
                ? values.FirstOrDefault()
                : null;

            throw new PaddleApiException(
                (int)response.StatusCode,
                requestId);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var envelope = await JsonSerializer.DeserializeAsync<PaddleEnvelope<T>>(
            stream,
            JsonOptions,
            cancellationToken);

        return envelope is null
            ? throw new InvalidOperationException("Paddle returned an empty API response.")
            : envelope.Data;
    }
}

public static class PaddleWebhookVerifier
{
    public static bool Verify(
        string rawBody,
        string signatureHeader,
        string secret,
        DateTimeOffset now,
        TimeSpan? tolerance = null)
    {
        if (string.IsNullOrWhiteSpace(rawBody)
            || string.IsNullOrWhiteSpace(signatureHeader)
            || string.IsNullOrWhiteSpace(secret))
        {
            return false;
        }

        string? timestampText = null;
        var signatures = new List<string>();

        foreach (var part in signatureHeader.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = part.IndexOf('=');
            if (separator <= 0 || separator == part.Length - 1)
                continue;

            var key = part[..separator].Trim();
            var value = part[(separator + 1)..].Trim();

            if (key == "ts")
                timestampText = value;
            else if (key == "h1")
                signatures.Add(value);
        }

        if (!long.TryParse(timestampText, out var timestamp) || signatures.Count == 0)
            return false;

        var acceptedTolerance = tolerance ?? TimeSpan.FromSeconds(5);
        var signedAt = DateTimeOffset.FromUnixTimeSeconds(timestamp);
        if ((now - signedAt).Duration() > acceptedTolerance)
            return false;

        var signedPayload = $"{timestamp}:{rawBody}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToHexString(
            hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload)))
            .ToLowerInvariant();

        var expectedBytes = Encoding.ASCII.GetBytes(expected);
        foreach (var candidate in signatures)
        {
            var candidateBytes = Encoding.ASCII.GetBytes(candidate);
            if (candidateBytes.Length == expectedBytes.Length
                && CryptographicOperations.FixedTimeEquals(candidateBytes, expectedBytes))
            {
                return true;
            }
        }

        return false;
    }
}

public sealed class PaddleApiException(
    int statusCode,
    string? requestId) : Exception(
        requestId is null
            ? $"Paddle API request failed with HTTP {statusCode}."
            : $"Paddle API request failed with HTTP {statusCode} (request {requestId}).")
{
    public int StatusCode { get; } = statusCode;
    public string? RequestId { get; } = requestId;
}

public sealed class PaddleWebhookSignatureException
    : Exception("Paddle webhook signature verification failed.");

public sealed record PaddleSubscriptionUpdateItem(
    string PriceId,
    int Quantity);

public sealed class PaddleEnvelope<T>
{
    [JsonPropertyName("data")]
    public required T Data { get; init; }
}

public sealed class PaddleTransaction
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("subscription_id")]
    public string? SubscriptionId { get; init; }

    [JsonPropertyName("checkout")]
    public PaddleCheckout? Checkout { get; init; }
}

public sealed class PaddleCheckout
{
    [JsonPropertyName("url")]
    public string? Url { get; init; }
}

public sealed class PaddleWebhookEvent
{
    [JsonPropertyName("event_id")]
    public required string EventId { get; init; }

    [JsonPropertyName("event_type")]
    public required string EventType { get; init; }

    [JsonPropertyName("occurred_at")]
    public DateTime OccurredAtUtc { get; init; }

    [JsonPropertyName("data")]
    public required PaddleSubscription Data { get; init; }
}

public sealed class PaddleSubscription
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("customer_id")]
    public string? CustomerId { get; init; }

    [JsonPropertyName("transaction_id")]
    public string? TransactionId { get; init; }

    [JsonPropertyName("custom_data")]
    public JsonElement? CustomData { get; init; }

    [JsonPropertyName("next_billed_at")]
    public DateTime? NextBilledAtUtc { get; init; }

    [JsonPropertyName("updated_at")]
    public DateTime UpdatedAtUtc { get; init; }

    [JsonPropertyName("items")]
    public List<PaddleSubscriptionItem> Items { get; init; } = [];
}

public sealed class PaddleSubscriptionItem
{
    [JsonPropertyName("quantity")]
    public int Quantity { get; init; } = 1;

    [JsonPropertyName("price")]
    public required PaddlePrice Price { get; init; }
}

public sealed class PaddlePrice
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }
}

public sealed class PaddlePortalSession
{
    [JsonPropertyName("urls")]
    public PaddlePortalUrls? Urls { get; init; }
}

public sealed class PaddlePortalUrls
{
    [JsonPropertyName("general")]
    public PaddlePortalGeneralUrls? General { get; init; }
}

public sealed class PaddlePortalGeneralUrls
{
    [JsonPropertyName("overview")]
    public string? Overview { get; init; }
}
