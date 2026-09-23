namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Pricing schedule and cost estimator for Gemini 3.8 Flash.
/// Prices checked 2026-09-22 against <see cref="SourceUrl"/>; standard tier;
/// $1.50/$7.50 from 2027-01-01; never add thinking tokens again (output already includes them).
/// </summary>
public static class MeasurementPricing
{
    public const decimal InputPerMillionUsd = 0.75m;
    public const decimal OutputPerMillionUsd = 3.75m;
    public const string PriceEpoch = "google-standard-2026-09-22-through-2026-12-31";
    public const string SourceUrl = "https://ai.google.dev/gemini-api/docs/pricing";

    /// <summary>
    /// Computes estimated provider cost in USD, or null if input or output token count is unknown.
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
