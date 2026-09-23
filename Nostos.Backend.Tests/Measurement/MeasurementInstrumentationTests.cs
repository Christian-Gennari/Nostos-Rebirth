using System.Reflection;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Unit tests for measurement harness instrumentation, guarantees, and schema sanitization.
/// Always runs without requiring network access or external credentials.
/// </summary>
public sealed class MeasurementInstrumentationTests
{
    [Fact]
    public void Measurement_row_columns_are_the_exact_content_free_set()
    {
        var expectedColumns = new[]
        {
            "RunId",
            "Provider",
            "Scenario",
            "Repetition",
            "Attempt",
            "Model",
            "ThinkingLevel",
            "UpstreamCalls",
            "ToolCalls",
            "ToolLoopIterations",
            "InputTokens",
            "OutputTokens",
            "ThinkingTokens",
            "ReportedTotalTokens",
            "ElapsedMs",
            "StopReason",
            "ProviderFinishReason",
            "EstimatedCostUsd",
            "FlowMatched",
            "PriceEpoch"
        };

        // Assert constant content-free columns match expected
        TurnMetricsRow.ContentFreeColumns.Should().Equal(expectedColumns);

        // Reflect over TurnMetricsRow public properties
        var publicPropertyNames = typeof(TurnMetricsRow)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .ToList();

        publicPropertyNames.Should().Equal(expectedColumns);
    }

    [Fact]
    public void Nearest_rank_percentiles_compute_expected_values()
    {
        // 1..100 sample: p50=50, p90=90, p99=99
        var sample100 = Enumerable.Range(1, 100).Select(i => (double?)i).ToList();
        MeasurementSummary.CalculatePercentile(sample100, 50).Should().Be(50);
        MeasurementSummary.CalculatePercentile(sample100, 90).Should().Be(90);
        MeasurementSummary.CalculatePercentile(sample100, 99).Should().Be(99);

        // Single value
        List<double?> single = [42.0];
        MeasurementSummary.CalculatePercentile(single, 50).Should().Be(42.0);
        MeasurementSummary.CalculatePercentile(single, 90).Should().Be(42.0);
        MeasurementSummary.CalculatePercentile(single, 99).Should().Be(42.0);

        // Empty input
        List<double?> empty = [];
        MeasurementSummary.CalculatePercentile(empty, 50).Should().BeNull();

        // Null values ignored rather than treated as zero
        List<double?> withNulls = [null, 10.0, null, 20.0, null];
        MeasurementSummary.CalculatePercentile(withNulls, 50).Should().Be(10.0);
        MeasurementSummary.CalculatePercentile(withNulls, 90).Should().Be(20.0);
    }

    [Fact]
    public void SanitizeSchema_removes_unsupported_properties_recursively()
    {
        var inputSchema = JsonNode.Parse("""
        {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "additionalProperties": false,
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                    "default": "example",
                    "examples": ["example search"]
                },
                "nested": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "filter": {
                            "type": "string",
                            "const": "fixed_value"
                        }
                    }
                }
            }
        }
        """);

        inputSchema.Should().NotBeNull();
        var sanitized = GeminiMeasurementLlmProvider.SanitizeSchema(inputSchema!);

        var json = sanitized.ToJsonString();
        json.Should().NotContain("$schema");
        json.Should().NotContain("additionalProperties");
        json.Should().NotContain("default");
        json.Should().NotContain("examples");
        json.Should().NotContain("const");

        // Retains required, properties, type, description
        json.Should().Contain("\"type\":\"object\"");
        json.Should().Contain("\"required\":[\"query\"]");
        json.Should().Contain("\"description\":\"Search query\"");
        json.Should().Contain("\"query\"");
        json.Should().Contain("\"nested\"");
        json.Should().Contain("\"filter\"");
    }
}
