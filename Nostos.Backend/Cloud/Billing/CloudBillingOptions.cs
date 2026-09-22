using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Entitlements;

namespace Nostos.Backend.Cloud.Billing;

public sealed class CloudBillingOptions
{
    public const string SectionName = "CloudBilling";

    public string Provider { get; set; } = "Paddle";
    public int PastDueGraceHours { get; set; } = 72;
    public int ReconciliationIntervalMinutes { get; set; } = 15;
    public List<CloudBillingPlanOptions> Plans { get; set; } = [];
    public PaddleBillingOptions Paddle { get; set; } = new();

    public static CloudBillingOptions FromConfiguration(IConfiguration configuration)
    {
        var options =
            configuration.GetSection(SectionName).Get<CloudBillingOptions>()
            ?? new CloudBillingOptions();

        options.Provider = (options.Provider ?? string.Empty).Trim();
        if (!string.Equals(options.Provider, "Paddle", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Nostos Cloud billing currently supports 'Paddle'. The product-facing subscription model remains provider-neutral.");
        }

        options.Provider = "Paddle";

        if (options.PastDueGraceHours is < 0 or > 720)
            throw new InvalidOperationException("'CloudBilling:PastDueGraceHours' must be between 0 and 720.");

        if (options.ReconciliationIntervalMinutes is < 5 or > 1440)
        {
            throw new InvalidOperationException(
                "'CloudBilling:ReconciliationIntervalMinutes' must be between 5 and 1440.");
        }

        if (options.Plans.Count == 0)
            throw new InvalidOperationException("Nostos Cloud billing requires at least one 'CloudBilling:Plans' entry.");

        var seenPlans = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var plan in options.Plans)
        {
            plan.PlanId = (plan.PlanId ?? string.Empty).Trim();
            _ = new NostosPlanId(plan.PlanId);

            if (!seenPlans.Add(plan.PlanId))
                throw new InvalidOperationException($"Duplicate Nostos billing plan id '{plan.PlanId}'.");

            if (plan.ManagedAiMonthlyAllowance < 0 || plan.StorageBytesLimit < 0)
                throw new InvalidOperationException($"Billing plan '{plan.PlanId}' contains a negative entitlement limit.");
        }

        options.Paddle = PaddleBillingOptions.Normalize(options.Paddle, seenPlans);
        return options;
    }

    public CloudBillingPlan ResolvePlan(NostosPlanId planId)
    {
        var plan = Plans.SingleOrDefault(
            x => string.Equals(x.PlanId, planId.Value, StringComparison.OrdinalIgnoreCase));

        if (plan is null)
            throw new InvalidOperationException($"Unknown Nostos billing plan '{planId}'.");

        return new CloudBillingPlan(
            new NostosPlanId(plan.PlanId),
            new CloudEntitlementSet(
                plan.CloudAccess,
                plan.ManagedAiEnabled,
                plan.ManagedAiMonthlyAllowance,
                plan.StorageBytesLimit));
    }

    public CloudBillingPlan ResolvePlanForPaddlePrice(string priceId)
    {
        var mapping = Paddle.PriceMappings.SingleOrDefault(
            x => string.Equals(x.PriceId, priceId, StringComparison.Ordinal));

        if (mapping is null)
            throw new InvalidOperationException($"Paddle price '{priceId}' is not mapped to a Nostos plan.");

        return ResolvePlan(new NostosPlanId(mapping.PlanId));
    }

    public string ResolvePaddlePrice(NostosPlanId planId)
    {
        var mapping = Paddle.PriceMappings.SingleOrDefault(
            x => string.Equals(x.PlanId, planId.Value, StringComparison.OrdinalIgnoreCase));

        if (mapping is null)
            throw new InvalidOperationException($"Nostos plan '{planId}' has no Paddle price mapping.");

        return mapping.PriceId;
    }
}

public sealed class CloudBillingPlanOptions
{
    public string PlanId { get; set; } = string.Empty;
    public bool CloudAccess { get; set; } = true;
    public bool ManagedAiEnabled { get; set; }
    public long ManagedAiMonthlyAllowance { get; set; }
    public long StorageBytesLimit { get; set; }
}

public sealed record CloudBillingPlan(
    NostosPlanId PlanId,
    CloudEntitlementSet Entitlements);

public sealed class PaddleBillingOptions
{
    public string Environment { get; set; } = "Sandbox";
    public string ApiKeyEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_BILLING_PADDLE_API_KEY";
    public string WebhookSecretEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET";
    public string CheckoutUrl { get; set; } = string.Empty;
    public List<PaddlePriceMappingOptions> PriceMappings { get; set; } = [];

    internal static PaddleBillingOptions Normalize(
        PaddleBillingOptions? value,
        IReadOnlySet<string> planIds)
    {
        var options = value ?? new PaddleBillingOptions();

        options.Environment = (options.Environment ?? string.Empty).Trim();
        if (options.Environment is not ("Sandbox" or "Live"))
        {
            throw new InvalidOperationException(
                "'CloudBilling:Paddle:Environment' must be 'Sandbox' or 'Live'.");
        }

        options.ApiKeyEnvironmentVariable = RequireVariableName(
            options.ApiKeyEnvironmentVariable,
            "ApiKeyEnvironmentVariable");
        options.WebhookSecretEnvironmentVariable = RequireVariableName(
            options.WebhookSecretEnvironmentVariable,
            "WebhookSecretEnvironmentVariable");

        if (!Uri.TryCreate(options.CheckoutUrl?.Trim(), UriKind.Absolute, out var checkout)
            || !string.Equals(checkout.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "'CloudBilling:Paddle:CheckoutUrl' must be an absolute HTTPS URL on a Paddle-approved domain.");
        }

        options.CheckoutUrl = checkout.AbsoluteUri;

        if (options.PriceMappings.Count == 0)
        {
            throw new InvalidOperationException(
                "Nostos Cloud billing requires at least one 'CloudBilling:Paddle:PriceMappings' entry.");
        }

        var prices = new HashSet<string>(StringComparer.Ordinal);
        var mappedPlans = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var mapping in options.PriceMappings)
        {
            mapping.PriceId = (mapping.PriceId ?? string.Empty).Trim();
            mapping.PlanId = (mapping.PlanId ?? string.Empty).Trim();

            if (!mapping.PriceId.StartsWith("pri_", StringComparison.Ordinal)
                || mapping.PriceId.Length < 8)
            {
                throw new InvalidOperationException(
                    $"Paddle price id '{mapping.PriceId}' is invalid; expected a 'pri_' identifier.");
            }

            if (!prices.Add(mapping.PriceId))
                throw new InvalidOperationException($"Duplicate Paddle price mapping '{mapping.PriceId}'.");

            if (!planIds.Contains(mapping.PlanId))
            {
                throw new InvalidOperationException(
                    $"Paddle price '{mapping.PriceId}' maps to unknown Nostos plan '{mapping.PlanId}'.");
            }

            if (!mappedPlans.Add(mapping.PlanId))
            {
                throw new InvalidOperationException(
                    $"Nostos plan '{mapping.PlanId}' has more than one Paddle base-price mapping. " +
                    "Use one base subscription price per Nostos plan in v1.");
            }
        }

        return options;
    }

    public PaddleBillingSecrets ResolveSecrets(Func<string, string?>? environmentReader = null)
    {
        environmentReader ??= Environment.GetEnvironmentVariable;

        var apiKey = environmentReader(ApiKeyEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException(
                $"Paddle billing requires environment variable '{ApiKeyEnvironmentVariable}'.");
        }

        var webhookSecret = environmentReader(WebhookSecretEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(webhookSecret))
        {
            throw new InvalidOperationException(
                $"Paddle billing requires environment variable '{WebhookSecretEnvironmentVariable}'.");
        }

        return new PaddleBillingSecrets(apiKey.Trim(), webhookSecret.Trim());
    }

    public Uri ApiBaseUri =>
        Environment == "Sandbox"
            ? new Uri("https://sandbox-api.paddle.com/")
            : new Uri("https://api.paddle.com/");

    private static string RequireVariableName(string? value, string setting)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            throw new InvalidOperationException(
                $"'CloudBilling:Paddle:{setting}' must name an environment variable.");
        }

        return trimmed;
    }
}

public sealed class PaddlePriceMappingOptions
{
    public string PriceId { get; set; } = string.Empty;
    public string PlanId { get; set; } = string.Empty;
}

public sealed record PaddleBillingSecrets(
    string ApiKey,
    string WebhookSecret);
