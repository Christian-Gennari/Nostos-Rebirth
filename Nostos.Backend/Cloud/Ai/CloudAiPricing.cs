namespace Nostos.Backend.Cloud.Ai;

public sealed record CloudAiCostEstimate(long Microusd, string PricingEpoch);

/// <summary>
/// Versioned provider-cost facts used for internal spend accounting. Historical
/// rows persist the selected epoch so later price changes do not rewrite history.
/// Unknown provider/model usage remains unknown.
/// </summary>
public static class CloudAiPricing
{
    public const long MicrousdPerUsd = 1_000_000;

    public const string GeminiIntroEpoch = "google-gemini-3.8-flash-2026-intro";
    public const string Gemini2027Epoch = "google-gemini-3.8-flash-2027-standard";
    public const string GroqWhisperEpoch = "groq-whisper-large-v3-turbo-2026-09-23";

    private static readonly DateTime Gemini2027 =
        new(2027, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public static long ToMicrousd(decimal usd) =>
        checked((long)decimal.Ceiling(usd * MicrousdPerUsd));

    public static CloudAiCostEstimate? EstimateLlm(
        string provider,
        string model,
        DateTime startedAtUtc,
        int? inputTokens,
        int? outputTokens)
    {
        if (inputTokens is null || outputTokens is null)
            return null;

        if (!string.Equals(provider, "google", StringComparison.Ordinal)
            || !string.Equals(model, "gemini-3.8-flash", StringComparison.Ordinal))
        {
            return null;
        }

        var (inputPerMillion, outputPerMillion, epoch) = startedAtUtc < Gemini2027
            ? (0.75m, 3.75m, GeminiIntroEpoch)
            : (1.50m, 7.50m, Gemini2027Epoch);

        var usd =
            inputTokens.Value / 1_000_000m * inputPerMillion
            + outputTokens.Value / 1_000_000m * outputPerMillion;
        return new CloudAiCostEstimate(ToMicrousd(usd), epoch);
    }

    public static CloudAiCostEstimate? EstimateStt(
        string provider,
        string model,
        DateTime startedAtUtc,
        double? durationSeconds)
    {
        if (durationSeconds is null || durationSeconds < 0)
            return null;

        if (!string.Equals(provider, "groq", StringComparison.Ordinal)
            || !string.Equals(model, "whisper-large-v3-turbo", StringComparison.Ordinal))
        {
            return null;
        }

        // Groq currently bills a minimum of 10 seconds per transcription.
        var billedSeconds = Math.Max(10d, durationSeconds.Value);
        var usd = (decimal)billedSeconds / 3600m * 0.04m;
        return new CloudAiCostEstimate(ToMicrousd(usd), GroqWhisperEpoch);
    }
}
