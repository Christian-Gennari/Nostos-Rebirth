using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Services.Ai;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Endpoints;

/// <summary>
/// Full-host coverage for <c>POST /api/assistant/transcribe</c> (issue #262
/// §2/§3).
///
/// Every test runs against <see cref="FakeSttProvider"/>; the real Groq provider
/// is never called here, because each real transcription is paid and the quota
/// is rationed.
/// </summary>
public sealed class TranscriptionEndpointTests : IDisposable
{
    /// <summary>
    /// A configured key for the duration of every test, so the derived
    /// availability gate is satisfied by default; the unconfigured test clears
    /// it explicitly. Cleared on dispose.
    /// </summary>
    private const string TokenVariable = "NOSTOS_STT_TEST_TOKEN";

    private const string TokenValue = "sentinel-stt-key-value";

    public TranscriptionEndpointTests() =>
        Environment.SetEnvironmentVariable(TokenVariable, TokenValue);

    public void Dispose() =>
        Environment.SetEnvironmentVariable(TokenVariable, null);

    // ------------------------------------------------------------------
    // Happy path
    // ------------------------------------------------------------------

    [Fact]
    public async Task Happy_path_returns_the_transcript()
    {
        var provider = new FakeSttProvider
        {
            Result = new SttResult("the magic mountain", "en", 6.9),
        };

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var response = await PostAsync(client, Audio(256), language: "en");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<TranscriptionEndpoints.TranscriptionResponse>();
        body!.Text.Should().Be("the magic mountain");
        body.Language.Should().Be("en");
        body.DurationSeconds.Should().Be(6.9);

        provider.CallCount.Should().Be(1);
        provider.LastFileName.Should().Be("clip.webm");
        provider.LastContentType.Should().Be("audio/webm");
        provider.LastLanguageHint.Should().Be("en");
    }

    [Fact]
    public async Task The_language_part_is_forwarded_to_the_provider_when_present()
    {
        var provider = new FakeSttProvider();
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        await PostAsync(client, Audio(64));

        provider.LastLanguageHint.Should().BeNull();
    }

    // ------------------------------------------------------------------
    // Request rejections
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_missing_file_is_a_typed_400()
    {
        var provider = new FakeSttProvider();
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("en"), "language");
        var response = await client.PostAsync(TranscriptionEndpoints.Route, form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemTitleAsync(response)).Should().Be(SttErrorCodes.InvalidRequest);
        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task An_oversized_upload_is_rejected_as_data()
    {
        var provider = new FakeSttProvider();
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider, maxUploadBytes: 32);
        using var client = host.CreateClient();

        var response = await PostAsync(client, Audio(4096));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await ProblemTitleAsync(response)).Should().Be(SttErrorCodes.TooLarge);
        provider.CallCount.Should().Be(0);
    }

    // ------------------------------------------------------------------
    // Configuration and provider failures
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_disabled_config_is_a_typed_error_not_a_500()
    {
        var provider = new FakeSttProvider();
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider, enabled: false);
        using var client = host.CreateClient();

        var response = await PostAsync(client, Audio(128));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await ProblemTitleAsync(response)).Should().Be(SttErrorCodes.Disabled);
        provider.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task An_enabled_but_unconfigured_surface_is_a_typed_503_not_a_500()
    {
        var provider = new FakeSttProvider();
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        Environment.SetEnvironmentVariable(TokenVariable, null);
        try
        {
            var response = await PostAsync(client, Audio(128));

            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            (await ProblemTitleAsync(response)).Should().Be(SttErrorCodes.NotConfigured);
            provider.CallCount.Should().Be(0);
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, TokenValue);
        }
    }

    [Fact]
    public async Task A_provider_failure_is_a_typed_error_not_an_unhandled_exception()
    {
        var provider = new FakeSttProvider
        {
            Failure = new SttException(SttErrorCodes.Provider, "the gateway is down"),
        };

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var response = await PostAsync(client, Audio(128));

        response.StatusCode.Should().Be(HttpStatusCode.BadGateway);
        (await ProblemTitleAsync(response)).Should().Be(SttErrorCodes.Provider);
    }

    [Fact]
    public async Task An_over_length_audio_is_rejected_as_data()
    {
        var provider = new FakeSttProvider
        {
            Result = new SttResult("too long", "en", 601),
        };

        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider, maxDurationSeconds: 300);
        using var client = host.CreateClient();

        var response = await PostAsync(client, Audio(128));

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ProblemTitleAsync(response)).Should().Be(SttErrorCodes.TooLong);
    }

    // ------------------------------------------------------------------
    // No audio retention
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_successful_transcription_leaves_no_audio_file_behind()
    {
        // A unique stem means any file derived from the upload is identifiable
        // among whatever else the machine's temp directory happens to hold.
        var probe = $"nostos-stt-{Guid.NewGuid():N}";
        var audio = Audio(512);

        var provider = new FakeSttProvider { Result = new SttResult("hello", "en", 0.5) };
        using var factory = new LibraryEndpointFactory();
        using var host = CreateHost(factory, provider);
        using var client = host.CreateClient();

        var tempRoot = Path.GetTempPath();

        var response = await PostAsync(client, audio, fileName: probe + ".webm");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // The bytes really reached the provider (so streaming, not a no-op)...
        provider.LastByteCount.Should().Be(audio.Length);

        // ...and nothing was written under a name derived from the upload. The
        // clip is far below the framework's form-buffering threshold, so this is
        // a check on OUR code, not on a framework temp file.
        var leftovers = Directory
            .EnumerateFiles(tempRoot)
            .Where(path => Path.GetFileName(path).Contains(probe, StringComparison.Ordinal))
            .ToList();

        leftovers.Should().BeEmpty();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static byte[] Audio(int length)
    {
        var bytes = new byte[length];
        for (var i = 0; i < length; i++)
        {
            bytes[i] = (byte)(i % 251);
        }

        return bytes;
    }

    private static async Task<HttpResponseMessage> PostAsync(
        HttpClient client,
        byte[] audio,
        string? language = null,
        string fileName = "clip.webm")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(audio);
        file.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(file, "file", fileName);

        if (language is not null)
        {
            form.Add(new StringContent(language), "language");
        }

        return await client.PostAsync(TranscriptionEndpoints.Route, form);
    }

    private static async Task<string?> ProblemTitleAsync(HttpResponseMessage response)
    {
        var document = await response.Content.ReadFromJsonAsync<JsonElement>();
        return document.GetProperty("title").GetString();
    }

    private static WebApplicationFactory<Program> CreateHost(
        LibraryEndpointFactory factory,
        FakeSttProvider provider,
        bool enabled = true,
        long maxUploadBytes = 26_214_400,
        double maxDurationSeconds = 300)
    {
        return factory.WithWebHostBuilder(builder =>
        {
            // UseSetting (host configuration), not ConfigureAppConfiguration:
            // with the minimal-hosting model, UseSetting is what reaches a
            // top-level `Program.cs` read like `builder.Configuration.GetSection`.
            builder.UseSetting("Speech:Enabled", enabled ? "true" : "false");
            builder.UseSetting("Speech:BaseUrl", "http://stt.invalid");
            builder.UseSetting("Speech:Model", "groq/whisper-large-v3-turbo");
            builder.UseSetting("Speech:ApiKeyEnvironmentVariable", "NOSTOS_STT_TEST_TOKEN");
            builder.UseSetting(
                "Speech:MaxUploadBytes",
                maxUploadBytes.ToString(CultureInfo.InvariantCulture));
            builder.UseSetting(
                "Speech:MaxDurationSeconds",
                maxDurationSeconds.ToString(CultureInfo.InvariantCulture));

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<ISTtProvider>();
                services.AddSingleton<ISTtProvider>(provider);
            });
        });
    }
}
