using Microsoft.Extensions.Logging;
using Nostos.Backend.Integrations.Assistant;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Structured logger capturing content-free execution metrics emitted by <see cref="AssistantOrchestrator"/>.
/// </summary>
public sealed class MeasurementCaptureLogger : ILogger<AssistantOrchestrator>
{
    /// <summary>Execution metrics captured from the most recent assistant turn.</summary>
    public AssistantExecutionMetrics? LastTurn { get; private set; }

    /// <summary>Clears captured metrics before starting a new turn.</summary>
    public void Reset() => LastTurn = null;

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        if (state is not IReadOnlyList<KeyValuePair<string, object?>> pairs)
        {
            return;
        }

        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        for (var i = 0; i < pairs.Count; i++)
        {
            values[pairs[i].Key] = pairs[i].Value;
        }

        if (!values.ContainsKey("UpstreamCalls"))
        {
            return;
        }

        var upstreamCalls = GetInt(values, "UpstreamCalls");
        var toolCalls = GetInt(values, "ToolCalls");
        var toolLoopIterations = GetInt(values, "ToolLoopIterations");
        var promptTokens = GetNullableInt(values, "PromptTokens");
        var outputTokens = GetNullableInt(values, "OutputTokens");
        var thinkingTokens = GetNullableInt(values, "ThinkingTokens");
        var reportedTotalTokens = GetNullableInt(values, "ReportedTotalTokens");
        var elapsedMs = GetLong(values, "ElapsedMilliseconds");

        var stopReason = values.TryGetValue("StopReason", out var srObj) && srObj is AssistantTurnStopReason parsedReason
            ? parsedReason
            : (AssistantTurnStopReason)Enum.Parse(typeof(AssistantTurnStopReason), srObj?.ToString() ?? nameof(AssistantTurnStopReason.Completed));

        string? finishReason = values.TryGetValue("ProviderFinishReason", out var pfr) ? pfr?.ToString() : null;
        if (finishReason == "(none)")
        {
            finishReason = null;
        }

        LastTurn = new AssistantExecutionMetrics(
            upstreamCalls,
            toolCalls,
            toolLoopIterations,
            promptTokens,
            outputTokens,
            thinkingTokens,
            reportedTotalTokens,
            elapsedMs,
            stopReason,
            finishReason);
    }

    private static int GetInt(IReadOnlyDictionary<string, object?> dict, string key) =>
        dict.TryGetValue(key, out var val) && val is not null ? Convert.ToInt32(val) : 0;

    private static long GetLong(IReadOnlyDictionary<string, object?> dict, string key) =>
        dict.TryGetValue(key, out var val) && val is not null ? Convert.ToInt64(val) : 0L;

    private static int? GetNullableInt(IReadOnlyDictionary<string, object?> dict, string key) =>
        dict.TryGetValue(key, out var val) && val is not null ? Convert.ToInt32(val) : null;
}
