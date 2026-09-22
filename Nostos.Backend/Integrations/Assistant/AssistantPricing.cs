namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// Official public standard-tier prices for Gemini 3.8 Flash, used only to bound a
/// single assistant turn by estimated cost.
///
/// Source: <c>https://ai.google.dev/gemini-api/docs/pricing</c>, checked 2026-09-22:
/// $0.75 / 1M input tokens and $3.75 / 1M output tokens. The same page prices
/// $1.50 / $7.50 from 2027-01-01, so the epoch string — not just the numbers — is
/// recorded with every turn measurement; re-pricing is a deliberate, reviewable
/// change. Thinking tokens are already part of the provider's output token count
/// and must never be added again.
///
/// This type exists ONLY to bound one turn. Cloud spend accounting, monthly
/// entitlement (#403) and operator/global emergency ceilings (#405) stay separate.
/// The external measurement harness keeps its own copy of these constants so the
/// instrument stays independent of production code.
/// </summary>
public static class AssistantPricing
{
    public const decimal InputPerMillionUsd = 0.75m;

    public const decimal OutputPerMillionUsd = 3.75m;

    public const string PriceEpoch = "google-standard-2026-09-22-through-2026-12-31";

    /// <summary>
    /// Estimated provider cost in USD for provider-reported usage, or null while
    /// either dimension is unknown. An unknown dimension must never be charged as
    /// zero: the caller treats null as "cannot be evaluated", not as "free".
    /// </summary>
    public static decimal? EstimateCostUsd(int? inputTokens, int? outputTokens)
    {
        if (inputTokens is null || outputTokens is null)
        {
            return null;
        }

        return (inputTokens.Value / 1_000_000m * InputPerMillionUsd)
             + (outputTokens.Value / 1_000_000m * OutputPerMillionUsd);
    }
}
