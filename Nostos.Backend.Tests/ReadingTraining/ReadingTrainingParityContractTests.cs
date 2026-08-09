using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

public class ReadingTrainingParityContractTests
{
    private static readonly string FixturePath = Path.Combine(
        AppContext.BaseDirectory, "fixtures", "reading-training", "behaviour-v1.json");

    private static async Task<JsonDocument> LoadFixtureAsync()
    {
        var json = await File.ReadAllTextAsync(FixturePath).ConfigureAwait(false);
        return JsonDocument.Parse(json);
    }

    [Fact]
    public async Task Fixture_defines_the_v1_baseline_targets()
    {
        using var doc = await LoadFixtureAsync();
        var root = doc.RootElement;
        root.GetProperty("version").GetInt32().Should().Be(1);

        var defaults = root.GetProperty("defaults");
        defaults.GetProperty("enduranceTargetMinutes").GetInt32().Should().Be(40);
        defaults.GetProperty("deepTargetMinutes").GetInt32().Should().Be(30);
        defaults.GetProperty("recoveryTargetMinutes").GetInt32().Should().Be(20);
    }

    [Fact]
    public async Task Fixture_case_ids_are_unique_and_non_empty()
    {
        using var doc = await LoadFixtureAsync();
        var root = doc.RootElement;
        var ids = root
            .GetProperty("cases")
            .EnumerateArray()
            .Select(c => c.GetProperty("id").GetString())
            .ToList();

        ids.Should().NotBeEmpty();
        ids.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public async Task Fixture_states_match_the_shared_session_status_enum()
    {
        using var doc = await LoadFixtureAsync();
        var root = doc.RootElement;
        var states = root
            .GetProperty("states")
            .EnumerateArray()
            .Select(s => s.GetString())
            .ToList();

        var enumNames = Enum.GetNames<Nostos.Shared.Enums.ReadingSessionStatus>();
        states.Should().BeEquivalentTo(enumNames);
    }
}
