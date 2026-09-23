using Nostos.Backend.Configuration;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// Per-turn execution ceilings (#406): one runaway or overlong turn is stopped
/// before it spends another upstream call.
///
/// The values live in <see cref="AssistantOptions"/> and are selected from the
/// external Gemini 3.8 Flash low-thinking measurement recorded in
/// <c>docs/cloud/ask-nostos-execution-budget-spike.md</c>. They are deliberately
/// distinct from #405 abuse/rate limits, #403 monthly entitlement and
/// operator/global emergency spend ceilings: this type bounds ONE turn only.
/// </summary>
public static class AssistantExecutionBudget
{
    /// <summary>
    /// Returns the name of the first ceiling the snapshot has reached, or null when
    /// the turn may spend another upstream call. A ceiling configured as zero or
    /// below is disabled.
    ///
    /// Unknown token dimensions cannot trip the token or cost ceiling: a provider
    /// that omitted a usage field must not be read as either "safe" or "over
    /// budget", and the hard iteration ceiling still bounds the turn.
    /// </summary>
    public static string? ExceededCeiling(AssistantExecutionUsage usage, AssistantOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (options.MaxTurnTokens > 0 &&
            usage.ReportedTotalTokens is { } tokens &&
            tokens >= options.MaxTurnTokens)
        {
            return "cumulative-token";
        }

        if (options.MaxTurnElapsedMilliseconds > 0 &&
            usage.ElapsedMilliseconds >= options.MaxTurnElapsedMilliseconds)
        {
            return "wall-clock";
        }

        if (options.MaxTurnEstimatedCostUsd > 0 &&
            AssistantPricing.EstimateCostUsd(usage.PromptTokens, usage.OutputTokens) is { } cost &&
            cost >= options.MaxTurnEstimatedCostUsd)
        {
            return "estimated-cost";
        }

        return null;
    }
}
