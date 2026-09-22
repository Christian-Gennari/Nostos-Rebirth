using System.Diagnostics;
using System.Text;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services.Ai;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Main measurement test runner executing assistant scenarios against live or fake LLM providers.
/// Records one content-free metric row per turn attempt into CSV files and generates run summaries.
/// </summary>
public sealed class AssistantTurnMeasurementTests
{
    [MeasurementFact]
    public async Task Measurement_run()
    {
        var runDir = MeasurementEnvironment.RunDirectory;
        var runId = MeasurementEnvironment.RunId;
        var isFake = MeasurementEnvironment.IsFake;

        if (MeasurementEnvironment.IsSummaryOnly)
        {
            MeasurementSummary.Write(runDir, runId, isFake);
            return;
        }

        Directory.CreateDirectory(runDir);
        var selectedScenarioNumbers = MeasurementEnvironment.ScenarioSelection;
        var csvPath = Path.Combine(runDir, $"rows-{string.Join("-", selectedScenarioNumbers)}.csv");

        var existingRows = new List<TurnMetricsRow>();
        if (File.Exists(csvPath))
        {
            foreach (var line in File.ReadAllLines(csvPath).Skip(1))
            {
                var parsed = TurnMetricsRow.TryParseCsv(line);
                if (parsed is not null)
                {
                    existingRows.Add(parsed);
                }
            }
        }
        else
        {
            File.WriteAllText(csvPath, TurnMetricsRow.Header + Environment.NewLine, Encoding.UTF8);
        }

        var scenarios = selectedScenarioNumbers.Select(MeasurementScenarios.GetByNumber).ToList();
        var reps = MeasurementEnvironment.Repetitions;
        var maxAttempts = MeasurementEnvironment.MaxAttempts;

        var totalTurnCounter = 0;

        foreach (var scenario in scenarios)
        {
            for (var rep = 1; rep <= reps; rep++)
            {
                var existingForPair = existingRows
                    .Where(r => r.Scenario == scenario.Slug && r.Repetition == rep)
                    .OrderBy(r => r.Attempt)
                    .ToList();

                var isComplete = existingForPair.Any(r => r.StopReason != "ProviderError")
                                 || existingForPair.Count >= maxAttempts;

                if (isComplete)
                {
                    continue;
                }

                var startAttempt = existingForPair.Count > 0
                    ? existingForPair.Max(r => r.Attempt) + 1
                    : 1;

                for (var attempt = startAttempt; attempt <= maxAttempts; attempt++)
                {
                    totalTurnCounter++;
                    var stopwatch = Stopwatch.StartNew();
                    using var harness = MeasurementHarness.Create(scenario.Number);
                    var seedResult = await SyntheticLibraryFixture.Seed(harness.DbContext);

                    var context = scenario.ContextFactory(seedResult);
                    var clientId = $"measure-{scenario.Number}-{rep}";
                    var idem = $"measure-{scenario.Number}-{rep}-{attempt}";
                    var request = new AssistantTurnRequest(clientId, idem, scenario.Message, context);

                    harness.LlmMetrics.Reset();

                    AssistantTurnResponse? response = null;
                    Exception? turnException = null;

                    try
                    {
                        response = await harness.Orchestrator.HandleTurnAsync(request);
                    }
                    catch (LlmException ex)
                    {
                        turnException = ex;
                        Console.WriteLine($"[Measurement] provider error: scenario={scenario.Slug} rep={rep} attempt={attempt} code={ex.Code} detail={ex.Message}");
                    }
                    catch (Exception ex)
                    {
                        turnException = ex;
                        Console.WriteLine($"[Measurement] turn error: scenario={scenario.Slug} rep={rep} attempt={attempt} type={ex.GetType().Name} detail={ex.Message}");
                    }

                    stopwatch.Stop();
                    var metrics = harness.LlmMetrics.LastTurn;

                    TurnMetricsRow row;
                    if (turnException is not null && metrics is null)
                    {
                        row = new TurnMetricsRow(
                            RunId: runId,
                            Provider: isFake ? "fake" : "gemini",
                            Scenario: scenario.Slug,
                            Repetition: rep,
                            Attempt: attempt,
                            Model: MeasurementEnvironment.Model,
                            ThinkingLevel: MeasurementEnvironment.ThinkingLevel,
                            UpstreamCalls: harness.UpstreamHttpAttempts,
                            ToolCalls: 0,
                            ToolLoopIterations: 0,
                            InputTokens: null,
                            OutputTokens: null,
                            ThinkingTokens: null,
                            ReportedTotalTokens: null,
                            ElapsedMs: stopwatch.ElapsedMilliseconds,
                            StopReason: "ProviderError",
                            ProviderFinishReason: string.Empty,
                            EstimatedCostUsd: null,
                            FlowMatched: false,
                            PriceEpoch: MeasurementPricing.PriceEpoch);
                    }
                    else
                    {
                        var stopReasonStr = metrics?.StopReason.ToString() ?? (turnException is not null ? "ProviderError" : "Completed");
                        var flowMatched = response is not null && metrics is not null && scenario.FlowMatched(response, metrics);
                        var cost = MeasurementPricing.EstimateCostUsd(metrics?.PromptTokens, metrics?.OutputTokens);

                        row = new TurnMetricsRow(
                            RunId: runId,
                            Provider: isFake ? "fake" : "gemini",
                            Scenario: scenario.Slug,
                            Repetition: rep,
                            Attempt: attempt,
                            Model: MeasurementEnvironment.Model,
                            ThinkingLevel: MeasurementEnvironment.ThinkingLevel,
                            UpstreamCalls: metrics?.UpstreamCallCount ?? 0,
                            ToolCalls: metrics?.ToolCallCount ?? 0,
                            ToolLoopIterations: metrics?.ToolLoopIterations ?? 0,
                            InputTokens: metrics?.PromptTokens,
                            OutputTokens: metrics?.OutputTokens,
                            ThinkingTokens: metrics?.ThinkingTokens,
                            ReportedTotalTokens: metrics?.ReportedTotalTokens,
                            ElapsedMs: metrics?.ElapsedMilliseconds ?? stopwatch.ElapsedMilliseconds,
                            StopReason: stopReasonStr,
                            ProviderFinishReason: metrics?.ProviderFinishReason ?? string.Empty,
                            EstimatedCostUsd: cost,
                            FlowMatched: flowMatched,
                            PriceEpoch: MeasurementPricing.PriceEpoch);
                    }

                    existingRows.Add(row);
                    await File.AppendAllTextAsync(csvPath, row.ToCsvLine() + Environment.NewLine, Encoding.UTF8);

                    if (totalTurnCounter % 10 == 0)
                    {
                        Console.WriteLine($"[Measurement Progress] turn {totalTurnCounter}: scenario {scenario.Slug}, rep {rep}, calls {row.UpstreamCalls}, {row.ElapsedMs}ms");
                    }

                    if (row.StopReason != "ProviderError")
                    {
                        break;
                    }
                }
            }
        }

        MeasurementSummary.Write(runDir, runId, isFake);
    }
}
