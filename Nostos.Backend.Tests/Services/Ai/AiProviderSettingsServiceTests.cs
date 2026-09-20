using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Services.Ai;

/// <summary>
/// Coverage for the AI provider settings service's outbound probes and its
/// graceful secret handling (assistant-milestone plan). The transport is stubbed,
/// so nothing here talks to a real gateway; the DB is a real temporary SQLite
/// file so the encrypted-at-rest and degrade paths are exercised for real.
/// </summary>
public sealed class AiProviderSettingsServiceTests : IDisposable
{
    private const string LlmEnvVariable = "NOSTOS_AI_PROVIDER_SERVICE_TEST_LLM_TOKEN";
    private const string SttEnvVariable = "NOSTOS_AI_PROVIDER_SERVICE_TEST_STT_TOKEN";
    private const string EnvKeyValue = "sk-from-environment";

    private readonly SqliteTestFixture _fixture = new();

    public void Dispose() => _fixture.Dispose();

    // ------------------------------------------------------------------
    // Model listing
    // ------------------------------------------------------------------

    [Fact]
    public async Task Models_falls_back_to_the_v1_path_when_the_base_has_no_v1()
    {
        var handler = new StubHttpMessageHandler();
        handler.Register("/v1/models", Json("""{"data":[{"id":"alpha"},{"id":"beta"}]}"""));

        var service = CreateService(handler);

        var result = await service.ListModelsAsync(
            new AiProviderModelsRequest("stt", BaseUrl: null, ApiKey: null));

        result.Models.Should().Equal("alpha", "beta");
        handler.RecordedRequestPaths.Should().Contain("/models");
        handler.RecordedRequestPaths.Should().Contain("/v1/models");
    }

    [Fact]
    public async Task Models_tries_the_base_url_first_when_it_already_ends_in_v1()
    {
        var handler = new StubHttpMessageHandler();
        handler.Register("/v1/models", Json("""{"data":[{"id":"only"}]}"""));

        var service = CreateService(handler);

        var result = await service.ListModelsAsync(
            new AiProviderModelsRequest("llm", BaseUrl: null, ApiKey: null));

        result.Models.Should().Equal("only");
        // The base URL already ends in /v1, so the first attempt succeeds and the
        // fallback is never tried.
        handler.RecordedRequestPaths.Should().Equal("/v1/models");
    }

    [Fact]
    public async Task Models_returns_a_502_style_upstream_error_with_the_provider_message()
    {
        var handler = new StubHttpMessageHandler().SetFallback(_ => new HttpResponseMessage(
            HttpStatusCode.BadGateway)
        {
            Content = new StringContent("""{"error":{"message":"gateway says no"}}"""),
        });

        var service = CreateService(handler);

        var act = () => service.ListModelsAsync(
            new AiProviderModelsRequest("llm", BaseUrl: null, ApiKey: null));

        var exception = (await act.Should().ThrowAsync<AiProviderUpstreamException>()).Which;
        exception.Message.Should().Contain("gateway says no");
    }

    [Fact]
    public async Task Models_sends_the_effective_bearer_token()
    {
        var handler = new StubHttpMessageHandler();
        System.Net.Http.Headers.AuthenticationHeaderValue? authorization = null;
        handler.Register("/v1/models", request =>
        {
            authorization = request.Headers.Authorization;
            return Json("""{"data":[{"id":"x"}]}""");
        });

        Environment.SetEnvironmentVariable(LlmEnvVariable, EnvKeyValue);
        try
        {
            var service = CreateService(handler);
            await service.ListModelsAsync(
                new AiProviderModelsRequest("llm", BaseUrl: null, ApiKey: null));

            authorization!.Scheme.Should().Be("Bearer");
            authorization.Parameter.Should().Be(EnvKeyValue);
        }
        finally
        {
            Environment.SetEnvironmentVariable(LlmEnvVariable, null);
        }
    }

    // ------------------------------------------------------------------
    // Connection tests
    // ------------------------------------------------------------------

    [Fact]
    public async Task Llm_test_sends_stream_false_and_a_tiny_max_tokens()
    {
        var handler = new StubHttpMessageHandler();
        string? body = null;
        handler.Register("/v1/chat/completions", request =>
        {
            body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return Json("""{"choices":[{"message":{"content":"pong"},"finish_reason":"stop"}]}""");
        });

        Environment.SetEnvironmentVariable(LlmEnvVariable, EnvKeyValue);
        try
        {
            var service = CreateService(handler);
            var result = await service.TestAsync(new AiProviderTestRequest("llm", null, null, null));

            result.Ok.Should().BeTrue();
            result.Error.Should().BeNull();
            body.Should().Contain("\"stream\":false");
            body.Should().Contain("\"max_tokens\":8");
        }
        finally
        {
            Environment.SetEnvironmentVariable(LlmEnvVariable, null);
        }
    }

    [Fact]
    public async Task Stt_test_uploads_a_generated_wav()
    {
        var handler = new StubHttpMessageHandler();
        string? body = null;
        string? contentType = null;
        handler.Register("/v1/audio/transcriptions", request =>
        {
            body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            contentType = request.Content.Headers.ContentType?.MediaType;
            return Json("""{"text":"","language":"en","duration":1.0}""");
        });

        Environment.SetEnvironmentVariable(SttEnvVariable, EnvKeyValue);
        try
        {
            var service = CreateService(handler);
            var result = await service.TestAsync(new AiProviderTestRequest("stt", null, null, null));

            result.Ok.Should().BeTrue();
            contentType.Should().StartWith("multipart/form-data");
            body.Should().Contain("silence.wav");
            // The bytes are a real RIFF/WAVE payload, not a placeholder string.
            body.Should().Contain("RIFF");
            body.Should().Contain("WAVE");
        }
        finally
        {
            Environment.SetEnvironmentVariable(SttEnvVariable, null);
        }
    }

    [Fact]
    public async Task Test_reports_a_provider_failure_as_ok_false()
    {
        var handler = new StubHttpMessageHandler().SetFallback(_ => new HttpResponseMessage(
            HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("""{"error":{"message":"bad key"}}"""),
        });

        Environment.SetEnvironmentVariable(LlmEnvVariable, EnvKeyValue);
        try
        {
            var service = CreateService(handler);
            var result = await service.TestAsync(new AiProviderTestRequest("llm", null, null, null));

            result.Ok.Should().BeFalse();
            result.Detail.Should().BeNull();
            result.Error.Should().Contain("bad key");
        }
        finally
        {
            Environment.SetEnvironmentVariable(LlmEnvVariable, null);
        }
    }

    [Fact]
    public async Task Test_reports_an_unknown_kind_as_ok_false_not_a_throw()
    {
        var service = CreateService(new StubHttpMessageHandler());

        var result = await service.TestAsync(new AiProviderTestRequest("nonsense", null, null, null));

        result.Ok.Should().BeFalse();
        result.Error.Should().Contain("llm");
    }

    // ------------------------------------------------------------------
    // Secret handling
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_decrypt_failure_degrades_to_the_environment_variable()
    {
        Environment.SetEnvironmentVariable(LlmEnvVariable, EnvKeyValue);
        try
        {
            var path = _fixture.CreateDatabasePath();
            await using (var db = _fixture.CreateContext(path))
            {
                db.AiProviderSettings.Add(new AiProviderSettingsModel
                {
                    Id = AiProviderSettingsModel.SingletonId,
                    // Not a valid Data Protection payload.
                    LlmApiKeyEncrypted = "not-a-valid-protected-payload",
                });
                await db.SaveChangesAsync();
            }

            var service = CreateService(new StubHttpMessageHandler(), path);

            var effective = await service.GetEffectiveLlmAsync();

            // Degraded, not thrown, and it used the env var.
            effective.HasKey.Should().BeTrue();
            effective.ApiKey.Should().Be(EnvKeyValue);
            effective.KeyFromServerEnv.Should().BeTrue();
        }
        finally
        {
            Environment.SetEnvironmentVariable(LlmEnvVariable, null);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };

    private AiProviderSettingsService CreateService(
        StubHttpMessageHandler handler,
        string? databasePath = null)
    {
        var path = databasePath ?? _fixture.CreateDatabasePath();
        using (var db = _fixture.CreateContext(path))
        {
            // EnsureCreated is idempotent; this guarantees the schema on a path
            // that was just handed out.
        }

        var assistant = new AssistantOptions
        {
            Enabled = true,
            BaseUrl = "http://omenhub:20128/v1",
            Model = "test-llm-model",
            ApiKeyEnvironmentVariable = LlmEnvVariable,
        };
        var speech = new SpeechOptions
        {
            Enabled = true,
            BaseUrl = "http://omenhub:20128",
            Model = "groq/whisper-large-v3-turbo",
            ApiKeyEnvironmentVariable = SttEnvVariable,
        };

        return new AiProviderSettingsService(
            new TestDbContextFactory(path),
            assistant,
            speech,
            new EphemeralDataProtectionProvider(),
            new StubHttpClientFactory(handler),
            NullLogger<AiProviderSettingsService>.Instance);
    }

    private sealed class TestDbContextFactory(string path) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() =>
            new(new DbContextOptionsBuilder<NostosDbContext>()
                .UseSqlite($"Data Source={path}")
                .Options);

        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken ct = default) =>
            Task.FromResult(CreateDbContext());
    }
}
