using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Aggregates content-free turn execution metrics into structured Markdown and JSON summaries.
///
/// Statistics are computed over <em>final attempts</em> only: for every (scenario, repetition) pair
/// the last recorded attempt is the turn as the user experienced it. Failed attempts are counted
/// separately and never enter the percentile tables, so a provider error can not skew a distribution.
/// </summary>
public static class MeasurementSummary
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>
    /// Calculates nearest-rank percentile over non-null values. Ignores null values.
    /// Returns null if the collection contains no non-null elements.
    /// </summary>
    public static double? CalculatePercentile(IEnumerable<double?> source, double percentile)
    {
        var nonNull = source.Where(v => v.HasValue).Select(v => v!.Value).OrderBy(v => v).ToList();
        if (nonNull.Count == 0)
        {
            return null;
        }

        var rank = (int)Math.Ceiling(percentile / 100.0 * nonNull.Count);
        rank = Math.Clamp(rank, 1, nonNull.Count);
        return nonNull[rank - 1];
    }

    /// <summary>
    /// Calculates nearest-rank percentile over decimal values. Ignores null values.
    /// </summary>
    public static decimal? CalculatePercentile(IEnumerable<decimal?> source, double percentile)
    {
        var nonNull = source.Where(v => v.HasValue).Select(v => v!.Value).OrderBy(v => v).ToList();
        if (nonNull.Count == 0)
        {
            return null;
        }

        var rank = (int)Math.Ceiling(percentile / 100.0 * nonNull.Count);
        rank = Math.Clamp(rank, 1, nonNull.Count);
        return nonNull[rank - 1];
    }

    /// <summary>The last attempt for every (scenario, repetition) pair.</summary>
    public static List<TurnMetricsRow> FinalAttemptRows(IEnumerable<TurnMetricsRow> rows) =>
        rows.GroupBy(r => (r.Scenario, r.Repetition))
            .Select(g => g.OrderBy(r => r.Attempt).Last())
            .ToList();

    /// <summary>Final attempts that produced a real execution; provider failures are excluded.</summary>
    public static List<TurnMetricsRow> StatRows(IEnumerable<TurnMetricsRow> rows) =>
        FinalAttemptRows(rows).Where(r => r.StopReason != "ProviderError").ToList();

    /// <summary>
    /// The measured constant number of tokens the live transport adds to every upstream
    /// call (zero on the direct API). See <see cref="MeasurementEnvironment.PreambleOffsetTokens"/>.
    /// </summary>
    public static int PreambleOffset => MeasurementEnvironment.PreambleOffsetTokens;

    /// <summary>
    /// A turn's token and cost figures with the transport preamble removed. Output and
    /// thinking tokens are unaffected; the cost is re-derived from the corrected input so
    /// the figure matches what the direct API would have charged.
    /// </summary>
    public static (int? InputTokens, int? OutputTokens, int? ThinkingTokens, int? TotalTokens, decimal? CostUsd)
        CorrectedForPreamble(TurnMetricsRow row)
    {
        if (PreambleOffset <= 0 || row.InputTokens is null)
        {
            return (row.InputTokens, row.OutputTokens, row.ThinkingTokens, row.ReportedTotalTokens, row.EstimatedCostUsd);
        }

        var input = Math.Max(0, row.InputTokens.Value - (PreambleOffset * row.UpstreamCalls));
        var output = row.OutputTokens;
        var thinking = row.ThinkingTokens;

        return (
            input,
            output,
            thinking,
            input + (output ?? 0) + (thinking ?? 0),
            MeasurementPricing.EstimateCostUsd(input, output));
    }

    public static string BuildMarkdown(IEnumerable<TurnMetricsRow> rows, string runId, bool fake)
    {
        var allRows = rows.ToList();
        var finalRows = FinalAttemptRows(allRows);
        var statRows = finalRows.Where(r => r.StopReason != "ProviderError").ToList();
        var failedTurns = finalRows.Count - statRows.Count;
        var retryAttempts = allRows.Count - finalRows.Count;

        var sb = new StringBuilder();

        if (fake)
        {
            sb.AppendLine("# FAKE MODE — NOT A MEASUREMENT");
            sb.AppendLine();
        }

        sb.AppendLine($"# Assistant Per-Turn Execution Measurement Summary — Run `{runId}`");
        sb.AppendLine();
        sb.AppendLine($"- Recorded attempts: {allRows.Count}");
        sb.AppendLine($"- Final turns measured: {finalRows.Count} (provider-error turns: {failedTurns})");
        sb.AppendLine($"- Retry attempts beyond the first per turn: {retryAttempts}");
        if (PreambleOffset > 0)
        {
            sb.AppendLine($"- Transport: `{MeasurementEnvironment.LiveTransport}` with a measured constant preamble of {PreambleOffset} token(s) per upstream call. Raw token and cost figures include it; the direct-API equivalent is shown under every table.");
        }

        sb.AppendLine();

        var scenarioGroups = statRows
            .GroupBy(r => r.Scenario)
            .OrderBy(g => g.Key)
            .ToList();

        sb.AppendLine("## Per-Scenario Results");
        sb.AppendLine();

        foreach (var group in scenarioGroups)
        {
            var scenarioFinal = finalRows.Count(r => r.Scenario == group.Key);
            var scenarioAll = allRows.Count(r => r.Scenario == group.Key);

            sb.AppendLine($"### Scenario: `{group.Key}`");
            sb.AppendLine();
            AppendStatsTable(
                sb,
                group.OrderBy(r => r.Repetition).ToList(),
                failed: scenarioFinal - group.Count(),
                retries: scenarioAll - scenarioFinal);
            sb.AppendLine();
        }

        sb.AppendLine("## Pooled engineering sample (equal scenario mix — NOT a production traffic distribution)");
        sb.AppendLine();
        AppendStatsTable(sb, statRows, failedTurns, retryAttempts);
        sb.AppendLine();

        sb.AppendLine("## Missing Provider Usage Fields");
        sb.AppendLine();
        sb.AppendLine($"- Final turns analysed: {statRows.Count}");
        sb.AppendLine($"- Rows with unknown InputTokens: {statRows.Count(r => !r.InputTokens.HasValue)}");
        sb.AppendLine($"- Rows with unknown OutputTokens: {statRows.Count(r => !r.OutputTokens.HasValue)}");
        sb.AppendLine($"- Rows with unknown ThinkingTokens: {statRows.Count(r => !r.ThinkingTokens.HasValue)}");
        sb.AppendLine($"- Rows with unknown ReportedTotalTokens: {statRows.Count(r => !r.ReportedTotalTokens.HasValue)}");
        sb.AppendLine($"- Rows with empty ProviderFinishReason: {statRows.Count(r => string.IsNullOrWhiteSpace(r.ProviderFinishReason))}");
        sb.AppendLine();
        sb.AppendLine("**Provider finish reasons (final turns):**");
        foreach (var reason in statRows
                     .GroupBy(r => string.IsNullOrWhiteSpace(r.ProviderFinishReason) ? "(none reported)" : r.ProviderFinishReason)
                     .OrderBy(g => g.Key))
        {
            sb.AppendLine($"- `{reason.Key}`: {reason.Count()} ({Percent(reason.Count(), statRows.Count):F1}%)");
        }

        return sb.ToString();
    }

    public static void Write(string runDirectory, string runId, bool fake)
    {
        Directory.CreateDirectory(runDirectory);
        var rows = new List<TurnMetricsRow>();

        var csvFiles = Directory.GetFiles(runDirectory, "rows-*.csv");
        foreach (var file in csvFiles)
        {
            var lines = File.ReadAllLines(file);
            foreach (var line in lines.Skip(1))
            {
                var row = TurnMetricsRow.TryParseCsv(line);
                if (row is not null)
                {
                    rows.Add(row);
                }
            }
        }

        var markdown = BuildMarkdown(rows, runId, fake);
        File.WriteAllText(Path.Combine(runDirectory, "summary.md"), markdown, Encoding.UTF8);

        var jsonObject = BuildJsonSummary(rows, runId, fake);
        File.WriteAllText(Path.Combine(runDirectory, "summary.json"), JsonSerializer.Serialize(jsonObject, JsonOptions), Encoding.UTF8);
    }

    private static void AppendStatsTable(StringBuilder sb, List<TurnMetricsRow> rows, int failed, int retries)
    {
        var n = rows.Count;
        var matchedCount = rows.Count(r => r.FlowMatched);

        sb.AppendLine($"- **Final turns (n)**: {n} (failed: {failed}; retry attempts recorded: {retries})");
        sb.AppendLine($"- **Flow matched**: {matchedCount}/{n} ({Percent(matchedCount, n):F1}%)");
        sb.AppendLine();

        sb.AppendLine("| Metric | Median (p50) | p90 | p99 |");
        sb.AppendLine("| --- | --- | --- | --- |");

        var upstreamCalls = rows.Select(r => (double?)r.UpstreamCalls).ToList();
        sb.AppendLine($"| Upstream Calls | {FormatDouble(CalculatePercentile(upstreamCalls, 50))} | {FormatDouble(CalculatePercentile(upstreamCalls, 90))} | {FormatDouble(CalculatePercentile(upstreamCalls, 99))} |");

        var inputTokens = rows.Select(r => (double?)r.InputTokens).ToList();
        sb.AppendLine($"| Input Tokens | {FormatDouble(CalculatePercentile(inputTokens, 50))} | {FormatDouble(CalculatePercentile(inputTokens, 90))} | {FormatDouble(CalculatePercentile(inputTokens, 99))} |");

        var outputTokens = rows.Select(r => (double?)r.OutputTokens).ToList();
        sb.AppendLine($"| Output Tokens | {FormatDouble(CalculatePercentile(outputTokens, 50))} | {FormatDouble(CalculatePercentile(outputTokens, 90))} | {FormatDouble(CalculatePercentile(outputTokens, 99))} |");

        var thinkingTokens = rows.Select(r => (double?)r.ThinkingTokens).ToList();
        sb.AppendLine($"| Thinking Tokens | {FormatDouble(CalculatePercentile(thinkingTokens, 50))} | {FormatDouble(CalculatePercentile(thinkingTokens, 90))} | {FormatDouble(CalculatePercentile(thinkingTokens, 99))} |");

        var totalTokens = rows.Select(r => (double?)r.ReportedTotalTokens).ToList();
        sb.AppendLine($"| Reported Total Tokens | {FormatDouble(CalculatePercentile(totalTokens, 50))} | {FormatDouble(CalculatePercentile(totalTokens, 90))} | {FormatDouble(CalculatePercentile(totalTokens, 99))} |");

        var elapsedMs = rows.Select(r => (double?)r.ElapsedMs).ToList();
        sb.AppendLine($"| Elapsed Time (ms) | {FormatDouble(CalculatePercentile(elapsedMs, 50))} | {FormatDouble(CalculatePercentile(elapsedMs, 90))} | {FormatDouble(CalculatePercentile(elapsedMs, 99))} |");

        var costUsd = rows.Select(r => r.EstimatedCostUsd).ToList();
        sb.AppendLine($"| Estimated Cost (USD) | {FormatDecimal(CalculatePercentile(costUsd, 50))} | {FormatDecimal(CalculatePercentile(costUsd, 90))} | {FormatDecimal(CalculatePercentile(costUsd, 99))} |");

        if (PreambleOffset > 0)
        {
            var corrected = rows.Select(CorrectedForPreamble).ToList();
            var correctedInput = corrected.Select(c => (double?)c.InputTokens).ToList();
            var correctedTotal = corrected.Select(c => (double?)c.TotalTokens).ToList();
            var correctedCost = corrected.Select(c => c.CostUsd).ToList();

            sb.AppendLine();
            sb.AppendLine($"**Direct-API equivalent — the transport's constant {PreambleOffset} token(s) per upstream call removed:**");
            sb.AppendLine();
            sb.AppendLine("| Metric | Median (p50) | p90 | p99 |");
            sb.AppendLine("| --- | --- | --- | --- |");
            sb.AppendLine($"| Input Tokens | {FormatDouble(CalculatePercentile(correctedInput, 50))} | {FormatDouble(CalculatePercentile(correctedInput, 90))} | {FormatDouble(CalculatePercentile(correctedInput, 99))} |");
            sb.AppendLine($"| Total Tokens | {FormatDouble(CalculatePercentile(correctedTotal, 50))} | {FormatDouble(CalculatePercentile(correctedTotal, 90))} | {FormatDouble(CalculatePercentile(correctedTotal, 99))} |");
            sb.AppendLine($"| Estimated Cost (USD) | {FormatDecimal(CalculatePercentile(correctedCost, 50))} | {FormatDecimal(CalculatePercentile(correctedCost, 90))} | {FormatDecimal(CalculatePercentile(correctedCost, 99))} |");
        }

        sb.AppendLine();
        var over2 = rows.Count(r => r.UpstreamCalls > 2);
        var over4 = rows.Count(r => r.UpstreamCalls > 4);
        var gte6 = rows.Count(r => r.UpstreamCalls >= 6);

        sb.AppendLine("**Upstream Call Ceilings:**");
        sb.AppendLine($"- > 2 calls: {over2} ({Percent(over2, n):F1}%)");
        sb.AppendLine($"- > 4 calls: {over4} ({Percent(over4, n):F1}%)");
        sb.AppendLine($"- >= 6 calls: {gte6} ({Percent(gte6, n):F1}%)");

        sb.AppendLine();
        var histogram = rows
            .GroupBy(r => r.UpstreamCalls)
            .OrderBy(g => g.Key)
            .Select(g => $"{g.Key} call(s) → {g.Count()}");
        sb.AppendLine($"- Upstream call histogram: {string.Join(", ", histogram)}");
        var toolHistogram = rows
            .GroupBy(r => r.ToolCalls)
            .OrderBy(g => g.Key)
            .Select(g => $"{g.Key} → {g.Count()}");
        sb.AppendLine($"- Tool call histogram: {string.Join(", ", toolHistogram)}");

        sb.AppendLine();
        sb.AppendLine("**Loop / stop patterns:**");
        foreach (var reason in rows.GroupBy(r => r.StopReason).OrderBy(g => g.Key))
        {
            sb.AppendLine($"- `{reason.Key}`: {reason.Count()} ({Percent(reason.Count(), n):F1}%)");
        }
    }

    private static object BuildJsonSummary(List<TurnMetricsRow> allRows, string runId, bool fake)
    {
        var finalRows = FinalAttemptRows(allRows);
        var statRows = finalRows.Where(r => r.StopReason != "ProviderError").ToList();

        var scenarioGroups = statRows
            .GroupBy(r => r.Scenario)
            .ToDictionary(
                g => g.Key,
                g => SummarizeGroup(
                    g.ToList(),
                    failed: finalRows.Count(r => r.Scenario == g.Key) - g.Count(),
                    retries: allRows.Count(r => r.Scenario == g.Key) - finalRows.Count(r => r.Scenario == g.Key)));

        return new
        {
            RunId = runId,
            Fake = fake,
            GeneratedAt = DateTime.UtcNow,
            RecordedAttempts = allRows.Count,
            FinalTurns = finalRows.Count,
            FailedTurns = finalRows.Count - statRows.Count,
            RetryAttempts = allRows.Count - finalRows.Count,
            Scenarios = scenarioGroups,
            Pooled = SummarizeGroup(statRows, finalRows.Count - statRows.Count, allRows.Count - finalRows.Count),
            MissingFields = new
            {
                MissingInputTokens = statRows.Count(r => !r.InputTokens.HasValue),
                MissingOutputTokens = statRows.Count(r => !r.OutputTokens.HasValue),
                MissingThinkingTokens = statRows.Count(r => !r.ThinkingTokens.HasValue),
                MissingReportedTotalTokens = statRows.Count(r => !r.ReportedTotalTokens.HasValue),
                MissingFinishReason = statRows.Count(r => string.IsNullOrWhiteSpace(r.ProviderFinishReason))
            }
        };
    }

    private static object SummarizeGroup(List<TurnMetricsRow> rows, int failed, int retries)
    {
        var n = rows.Count;
        var matchedCount = rows.Count(r => r.FlowMatched);

        var upstreamCalls = rows.Select(r => (double?)r.UpstreamCalls).ToList();
        var inputTokens = rows.Select(r => (double?)r.InputTokens).ToList();
        var outputTokens = rows.Select(r => (double?)r.OutputTokens).ToList();
        var thinkingTokens = rows.Select(r => (double?)r.ThinkingTokens).ToList();
        var totalTokens = rows.Select(r => (double?)r.ReportedTotalTokens).ToList();
        var elapsedMs = rows.Select(r => (double?)r.ElapsedMs).ToList();
        var costUsd = rows.Select(r => r.EstimatedCostUsd).ToList();

        var corrected = rows.Select(CorrectedForPreamble).ToList();
        var correctedInput = corrected.Select(c => (double?)c.InputTokens).ToList();
        var correctedTotal = corrected.Select(c => (double?)c.TotalTokens).ToList();
        var correctedCost = corrected.Select(c => c.CostUsd).ToList();

        return new
        {
            N = n,
            NFailed = failed,
            NRetryAttempts = retries,
            FlowMatchedCount = matchedCount,
            FlowMatchedPercent = Percent(matchedCount, n),
            UpstreamCalls = new { P50 = CalculatePercentile(upstreamCalls, 50), P90 = CalculatePercentile(upstreamCalls, 90), P99 = CalculatePercentile(upstreamCalls, 99) },
            InputTokens = new { P50 = CalculatePercentile(inputTokens, 50), P90 = CalculatePercentile(inputTokens, 90), P99 = CalculatePercentile(inputTokens, 99) },
            OutputTokens = new { P50 = CalculatePercentile(outputTokens, 50), P90 = CalculatePercentile(outputTokens, 90), P99 = CalculatePercentile(outputTokens, 99) },
            ThinkingTokens = new { P50 = CalculatePercentile(thinkingTokens, 50), P90 = CalculatePercentile(thinkingTokens, 90), P99 = CalculatePercentile(thinkingTokens, 99) },
            ReportedTotalTokens = new { P50 = CalculatePercentile(totalTokens, 50), P90 = CalculatePercentile(totalTokens, 90), P99 = CalculatePercentile(totalTokens, 99) },
            ElapsedMs = new { P50 = CalculatePercentile(elapsedMs, 50), P90 = CalculatePercentile(elapsedMs, 90), P99 = CalculatePercentile(elapsedMs, 99) },
            EstimatedCostUsd = new { P50 = CalculatePercentile(costUsd, 50), P90 = CalculatePercentile(costUsd, 90), P99 = CalculatePercentile(costUsd, 99) },
            UpstreamCallsGt2 = rows.Count(r => r.UpstreamCalls > 2),
            UpstreamCallsGt4 = rows.Count(r => r.UpstreamCalls > 4),
            UpstreamCallsGte6 = rows.Count(r => r.UpstreamCalls >= 6),
            CorrectedForPreamble = PreambleOffset > 0
                ? new
                {
                    PreambleOffsetTokensPerUpstreamCall = PreambleOffset,
                    InputTokens = new { P50 = CalculatePercentile(correctedInput, 50), P90 = CalculatePercentile(correctedInput, 90), P99 = CalculatePercentile(correctedInput, 99) },
                    TotalTokens = new { P50 = CalculatePercentile(correctedTotal, 50), P90 = CalculatePercentile(correctedTotal, 90), P99 = CalculatePercentile(correctedTotal, 99) },
                    EstimatedCostUsd = new { P50 = CalculatePercentile(correctedCost, 50), P90 = CalculatePercentile(correctedCost, 90), P99 = CalculatePercentile(correctedCost, 99) }
                }
                : null,
            UpstreamCallHistogram = rows.GroupBy(r => r.UpstreamCalls).OrderBy(g => g.Key).ToDictionary(g => g.Key.ToString(CultureInfo.InvariantCulture), g => g.Count()),
            StopReasons = rows.GroupBy(r => r.StopReason).ToDictionary(g => g.Key, g => g.Count())
        };
    }

    private static double Percent(int count, int total) => total > 0 ? count * 100.0 / total : 0.0;

    private static string FormatDouble(double? val) =>
        val.HasValue ? val.Value.ToString("0.##", CultureInfo.InvariantCulture) : "null";

    private static string FormatDecimal(decimal? val) =>
        val.HasValue ? "$" + val.Value.ToString("0.######", CultureInfo.InvariantCulture) : "null";
}
