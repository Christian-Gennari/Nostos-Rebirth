using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Support;
using Nostos.Shared.Dtos;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

/// <summary>
/// Full-host coverage for the assistant settings surface
/// <c>/api/settings/assistant</c> (issue #262 §7). The host runs against a real
/// temporary SQLite database, so "stores nothing" is asserted on the file.
/// </summary>
public sealed class AssistantSettingsEndpointTests
{
    [Fact]
    public async Task Get_defaults_to_verbatim_with_no_row()
    {
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory);
        using var client = host.CreateClient();

        var response = await client.GetAsync(AssistantSettingsEndpoints.Route);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<AssistantSettingsResponse>();
        body!.CaptureProcessingMode.Should().Be(ThoughtProcessingModes.Verbatim);
    }

    [Fact]
    public async Task Get_never_leaks_anything_but_the_one_field()
    {
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory);
        using var client = host.CreateClient();

        var response = await client.GetAsync(AssistantSettingsEndpoints.Route);
        var document = await response.Content.ReadFromJsonAsync<JsonElement>();

        var properties = document.EnumerateObject().Select(p => p.Name).ToList();
        properties.Should().Equal("captureProcessingMode");
    }

    [Fact]
    public async Task Put_stores_the_mode_and_round_trips_through_get()
    {
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory);
        using var client = host.CreateClient();

        var put = await client.PutAsJsonAsync(
            AssistantSettingsEndpoints.Route,
            new AssistantSettingsUpdateRequest("light_polish"));

        put.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = await put.Content.ReadFromJsonAsync<AssistantSettingsResponse>();
        updated!.CaptureProcessingMode.Should().Be("light_polish");

        // Durable, not merely echoed.
        var get = await client.GetFromJsonAsync<AssistantSettingsResponse>(
            AssistantSettingsEndpoints.Route);
        get!.CaptureProcessingMode.Should().Be("light_polish");

        using var db = OpenDb(factory.DatabasePath);
        var stored = db.AssistantSettings.AsNoTracking().Single();
        stored.CaptureProcessingMode.Should().Be("light_polish");
    }

    [Fact]
    public async Task Put_refuses_an_unsupported_mode_with_the_typed_problem_title()
    {
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory);
        using var client = host.CreateClient();

        var put = await client.PutAsJsonAsync(
            AssistantSettingsEndpoints.Route,
            new AssistantSettingsUpdateRequest("nonsense"));

        put.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemTitleAsync(put)).Should().Be("invalid_processing_mode");

        // Nothing was stored, and the effective value is still the default.
        var get = await client.GetFromJsonAsync<AssistantSettingsResponse>(
            AssistantSettingsEndpoints.Route);
        get!.CaptureProcessingMode.Should().Be(ThoughtProcessingModes.Verbatim);

        using var db = OpenDb(factory.DatabasePath);
        (await db.AssistantSettings.CountAsync()).Should().Be(0);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static NostosDbContext OpenDb(string path) =>
        new(new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}")
            .Options);

    private static async Task<string?> ProblemTitleAsync(HttpResponseMessage response)
    {
        var document = await response.Content.ReadFromJsonAsync<JsonElement>();
        return document.GetProperty("title").GetString();
    }

    private static WebApplicationFactory<Program> CreateHost(LibraryEndpointFactory factory) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Assistant:Enabled", "true");
            builder.UseSetting("Assistant:ApiKeyEnvironmentVariable", "NOSTOS_ASSISTANT_SETTINGS_TEST_TOKEN");
        });
}
