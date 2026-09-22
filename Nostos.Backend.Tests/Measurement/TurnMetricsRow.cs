using System.Globalization;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// A single content-free measurement record representing one assistant turn execution attempt.
/// </summary>
public sealed record TurnMetricsRow(
    string RunId,
    string Provider,
    string Scenario,
    int Repetition,
    int Attempt,
    string Model,
    string ThinkingLevel,
    int UpstreamCalls,
    int ToolCalls,
    int ToolLoopIterations,
    int? InputTokens,
    int? OutputTokens,
    int? ThinkingTokens,
    int? ReportedTotalTokens,
    long ElapsedMs,
    string StopReason,
    string ProviderFinishReason,
    decimal? EstimatedCostUsd,
    bool FlowMatched,
    string PriceEpoch)
{
    /// <summary>
    /// The exact list of content-free property and CSV column names in order.
    /// </summary>
    public static readonly IReadOnlyList<string> ContentFreeColumns =
    [
        nameof(RunId),
        nameof(Provider),
        nameof(Scenario),
        nameof(Repetition),
        nameof(Attempt),
        nameof(Model),
        nameof(ThinkingLevel),
        nameof(UpstreamCalls),
        nameof(ToolCalls),
        nameof(ToolLoopIterations),
        nameof(InputTokens),
        nameof(OutputTokens),
        nameof(ThinkingTokens),
        nameof(ReportedTotalTokens),
        nameof(ElapsedMs),
        nameof(StopReason),
        nameof(ProviderFinishReason),
        nameof(EstimatedCostUsd),
        nameof(FlowMatched),
        nameof(PriceEpoch)
    ];

    /// <summary>CSV header line containing all column names comma-joined.</summary>
    public static string Header => string.Join(",", ContentFreeColumns);

    /// <summary>Formats the row as a comma-separated line in invariant culture.</summary>
    public string ToCsvLine()
    {
        var cost = EstimatedCostUsd.HasValue
            ? EstimatedCostUsd.Value.ToString("0.########", CultureInfo.InvariantCulture)
            : string.Empty;

        return string.Join(",",
            RunId,
            Provider,
            Scenario,
            Repetition.ToString(CultureInfo.InvariantCulture),
            Attempt.ToString(CultureInfo.InvariantCulture),
            Model,
            ThinkingLevel,
            UpstreamCalls.ToString(CultureInfo.InvariantCulture),
            ToolCalls.ToString(CultureInfo.InvariantCulture),
            ToolLoopIterations.ToString(CultureInfo.InvariantCulture),
            InputTokens?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            OutputTokens?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            ThinkingTokens?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            ReportedTotalTokens?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            ElapsedMs.ToString(CultureInfo.InvariantCulture),
            StopReason,
            ProviderFinishReason,
            cost,
            FlowMatched ? "true" : "false",
            PriceEpoch);
    }

    /// <summary>Parses a CSV line into a <see cref="TurnMetricsRow"/>, or returns null if malformed.</summary>
    public static TurnMetricsRow? TryParseCsv(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            return null;
        }

        var parts = line.Split(',');
        if (parts.Length != ContentFreeColumns.Count)
        {
            return null;
        }

        try
        {
            return new TurnMetricsRow(
                RunId: parts[0],
                Provider: parts[1],
                Scenario: parts[2],
                Repetition: int.Parse(parts[3], CultureInfo.InvariantCulture),
                Attempt: int.Parse(parts[4], CultureInfo.InvariantCulture),
                Model: parts[5],
                ThinkingLevel: parts[6],
                UpstreamCalls: int.Parse(parts[7], CultureInfo.InvariantCulture),
                ToolCalls: int.Parse(parts[8], CultureInfo.InvariantCulture),
                ToolLoopIterations: int.Parse(parts[9], CultureInfo.InvariantCulture),
                InputTokens: string.IsNullOrWhiteSpace(parts[10]) ? null : int.Parse(parts[10], CultureInfo.InvariantCulture),
                OutputTokens: string.IsNullOrWhiteSpace(parts[11]) ? null : int.Parse(parts[11], CultureInfo.InvariantCulture),
                ThinkingTokens: string.IsNullOrWhiteSpace(parts[12]) ? null : int.Parse(parts[12], CultureInfo.InvariantCulture),
                ReportedTotalTokens: string.IsNullOrWhiteSpace(parts[13]) ? null : int.Parse(parts[13], CultureInfo.InvariantCulture),
                ElapsedMs: long.Parse(parts[14], CultureInfo.InvariantCulture),
                StopReason: parts[15],
                ProviderFinishReason: parts[16],
                EstimatedCostUsd: string.IsNullOrWhiteSpace(parts[17]) ? null : decimal.Parse(parts[17], CultureInfo.InvariantCulture),
                FlowMatched: bool.Parse(parts[18]),
                PriceEpoch: parts[19]);
        }
        catch
        {
            return null;
        }
    }
}
