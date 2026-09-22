using FluentAssertions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services.Ai;
using Xunit;

namespace Nostos.Backend.Tests.Assistant;

/// <summary>
/// Per-turn execution ceilings (#406): the predicate, the price epoch and the meter
/// snapshot that feeds it. The VALUES are selected from the external Gemini 3.8 Flash
/// low-thinking measurement; these tests pin the behaviour those values switch on, so
/// a mis-set ceiling fails here rather than in production.
/// </summary>
public sealed class AssistantExecutionBudgetTests
{
    private static AssistantExecutionUsage Usage(
        int upstreamCalls = 2,
        int? promptTokens = 1_000,
        int? outputTokens = 100,
        int? thinkingTokens = null,
        long elapsedMs = 1_000) =>
        new(
            upstreamCalls,
            promptTokens,
            outputTokens,
            thinkingTokens,
            promptTokens is not null && outputTokens is not null ? promptTokens + outputTokens : null,
            elapsedMs);

    [Fact]
    public void Cumulative_token_ceiling_trips_at_or_above_the_configured_total()
    {
        var options = new AssistantOptions { MaxTurnTokens = 1_100 };

        AssistantExecutionBudget.ExceededCeiling(Usage(outputTokens: 99), options).Should().BeNull();
        AssistantExecutionBudget.ExceededCeiling(Usage(outputTokens: 100), options).Should().Be("cumulative-token");
        AssistantExecutionBudget.ExceededCeiling(Usage(promptTokens: 50_000, outputTokens: 400), options).Should().Be("cumulative-token");
    }

    [Fact]
    public void Wall_clock_ceiling_trips_at_or_above_the_configured_elapsed_time()
    {
        var options = new AssistantOptions { MaxTurnElapsedMilliseconds = 1_000 };

        AssistantExecutionBudget.ExceededCeiling(Usage(elapsedMs: 999), options).Should().BeNull();
        AssistantExecutionBudget.ExceededCeiling(Usage(elapsedMs: 1_000), options).Should().Be("wall-clock");
    }

    [Fact]
    public void Estimated_cost_ceiling_trips_at_or_above_the_configured_cost()
    {
        // 1,000 in + 100 out at $0.75 / $3.75 per 1M = $0.001125.
        var tripping = new AssistantOptions { MaxTurnEstimatedCostUsd = 0.001m };
        var notTripping = new AssistantOptions { MaxTurnEstimatedCostUsd = 0.0012m };

        AssistantExecutionBudget.ExceededCeiling(Usage(), tripping).Should().Be("estimated-cost");
        AssistantExecutionBudget.ExceededCeiling(Usage(), notTripping).Should().BeNull();
    }

    [Fact]
    public void A_ceiling_configured_as_zero_or_negative_is_disabled()
    {
        var options = new AssistantOptions
        {
            MaxTurnTokens = 0,
            MaxTurnElapsedMilliseconds = -1,
            MaxTurnEstimatedCostUsd = 0m,
        };

        var huge = Usage(promptTokens: 5_000_000, outputTokens: 5_000_000, elapsedMs: 3_600_000);
        AssistantExecutionBudget.ExceededCeiling(huge, options).Should().BeNull();
    }

    [Fact]
    public void A_missing_usage_field_can_never_trip_the_token_or_cost_ceiling()
    {
        var options = new AssistantOptions
        {
            MaxTurnTokens = 1,
            MaxTurnEstimatedCostUsd = 0.0000001m,
        };

        var unknown = Usage(promptTokens: null, outputTokens: null);
        unknown.ReportedTotalTokens.Should().BeNull();

        AssistantExecutionBudget.ExceededCeiling(unknown, options).Should().BeNull(
            "unknown usage is not over budget — the hard iteration ceiling still bounds the turn");
    }

    [Fact]
    public void Ceilings_are_evaluated_in_a_documented_order()
    {
        var options = new AssistantOptions
        {
            MaxTurnTokens = 1,
            MaxTurnElapsedMilliseconds = 1,
            MaxTurnEstimatedCostUsd = 0.0000001m,
        };

        AssistantExecutionBudget.ExceededCeiling(Usage(), options).Should().Be("cumulative-token");
    }

    [Fact]
    public void Pricing_uses_the_recorded_epoch_prices()
    {
        AssistantPricing.EstimateCostUsd(1_000_000, 1_000_000).Should().Be(4.50m);
        AssistantPricing.EstimateCostUsd(null, 1).Should().BeNull();
        AssistantPricing.EstimateCostUsd(1, null).Should().BeNull();
        AssistantPricing.PriceEpoch.Should().Contain("2026-09-22");
    }

    [Fact]
    public void Default_ceiling_values_are_inert_until_the_external_measurement_sets_them()
    {
        var options = new AssistantOptions();

        options.MaxToolIterations.Should().Be(6);
        options.MaxTurnTokens.Should().Be(0, "the measured value replaces this, and this test, deliberately");
        options.MaxTurnElapsedMilliseconds.Should().Be(0);
        options.MaxTurnEstimatedCostUsd.Should().Be(0m);
    }

    [Fact]
    public void Meter_snapshot_reports_live_usage_and_keeps_unknown_dimensions_unknown()
    {
        var meter = new AssistantExecutionMeter();
        meter.RecordUpstreamRequest();
        meter.RecordCompletion(new LlmCompletion("hi", "stop", [], PromptTokens: 10, CompletionTokens: 5));

        var snapshot = meter.Snapshot();
        snapshot.UpstreamCallCount.Should().Be(1);
        snapshot.ReportedTotalTokens.Should().Be(15);

        Thread.Sleep(30);
        meter.Snapshot().ElapsedMilliseconds.Should().BeGreaterThanOrEqualTo(30);

        var unknownMeter = new AssistantExecutionMeter();
        unknownMeter.RecordUpstreamRequest();
        unknownMeter.RecordCompletion(new LlmCompletion("hi", "stop", []));
        unknownMeter.Snapshot().ReportedTotalTokens.Should().BeNull();
        unknownMeter.Snapshot().PromptTokens.Should().BeNull();

        var finished = meter.Finish(AssistantTurnStopReason.Completed);
        finished.UpstreamCallCount.Should().Be(1);
        finished.ReportedTotalTokens.Should().Be(15);
        finished.StopReason.Should().Be(AssistantTurnStopReason.Completed);
    }
}
