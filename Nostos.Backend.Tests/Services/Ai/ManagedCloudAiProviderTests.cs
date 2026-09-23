using System.Net;
using System.Net.Http.Headers;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Cloud.Entitlements;
using Nostos.Backend.Configuration;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Services.Ai;

public sealed class ManagedCloudAiConfigurationTests
{
    [Fact]
    public void Defaults_pin_the_initial_managed_provider_policy()
    {
        var options = new CloudManagedAiOptions();

        options.LlmModel.Should().Be("gemini-3.8-flash");
        options.LlmThinkingLevel.Should().Be("low");
        options.SttModel.Should().Be("whisper-large-v3-turbo");
        options.LlmApiKeyEnvironmentVariable.Should().Be("NOSTOS_CLOUD_GEMINI_API_KEY");
        options.SttApiKeyEnvironmentVariable.Should().Be("NOSTOS_CLOUD_GROQ_API_KEY");

        var act = options.Validate;
        act.Should().NotThrow();
    }

    [Fact]
    public void Invalid_thinking_level_is_rejected_instead_of_falling_back_to_provider_default()
    {
        var options = new CloudManagedAiOptions { LlmThinkingLevel = "default" };

        var act = options.Validate;

        act.Should()
            .Throw<InvalidOperationException>()
            .WithMessage("*LlmThinkingLevel*low*medium*high*");
    }

    [Fact]
    public async Task Managed_settings_read_the_server_environment_and_reject_customer_configuration()
    {
        const string variable = "NOSTOS_MANAGED_AI_TEST_GEMINI_KEY";
        const string secret = "managed-secret-value";
        var options = new CloudManagedAiOptions
        {
            LlmApiKeyEnvironmentVariable = variable,
        };
        var settings = new CloudManagedAiProviderSettingsService(options);

        Environment.SetEnvironmentVariable(variable, secret);
        try
        {
            var effective = await settings.GetEffectiveLlmAsync();

            effective.IsAvailable.Should().BeTrue();
            effective.Model.Should().Be("gemini-3.8-flash");
            effective.ApiKey.Should().Be(secret);
            effective.KeyFromServerEnv.Should().BeTrue();

            var get = () => settings.GetAsync();
            var update = () => settings.UpdateAsync(
                new AiProviderSettingsUpdateRequest(
                    new AiProviderSectionUpdate(true, "https://attacker.invalid", "other-model", "client-key"),
                    null));

            await get.Should().ThrowAsync<AiProviderConfigurationManagedException>();
            await update.Should().ThrowAsync<AiProviderConfigurationManagedException>();
        }
        finally
        {
            Environment.SetEnvironmentVariable(variable, null);
        }
    }

    [Fact]
    public async Task Cloud_access_policy_uses_entitlement_capability_not_monthly_consumption()
    {
        var denied = new CloudManagedAiAccessPolicy(new FixedEntitlements(
            new CloudEntitlementSnapshot(
                CloudSubscriptionStatus.Active,
                CloudAccess: true,
                ManagedAiEnabled: false,
                ManagedAiMonthlyAllowance: 500,
                StorageBytesLimit: 1_000)));

        var allowedWithZeroAllowance = new CloudManagedAiAccessPolicy(new FixedEntitlements(
            new CloudEntitlementSnapshot(
                CloudSubscriptionStatus.Active,
                CloudAccess: true,
                ManagedAiEnabled: true,
                ManagedAiMonthlyAllowance: 0,
                StorageBytesLimit: 1_000)));

        (await denied.IsAllowedAsync()).Should().BeFalse();
        (await allowedWithZeroAllowance.IsAllowedAsync()).Should().BeTrue(
            "monthly consumption enforcement belongs to #405, not #404");
    }

    private sealed class FixedEntitlements(CloudEntitlementSnapshot snapshot)
        : ICloudEntitlementService
    {
        public Task<CloudEntitlementSnapshot> GetEntitlementsAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(snapshot);
    }
}

public sealed class ManagedProviderTransportTests
{
    private const string GeminiKey = "gemini-test-key";
    private const string GroqKey = "groq-test-key";

    [Fact]
    public async Task Gemini_sends_low_thinking_tools_and_surfaces_billable_usage()
    {
        var handler = new StubHttpMessageHandler();
        string? requestBody = null;
        string? apiKey = null;

        handler.Register("/v1beta/models/gemini-3.8-flash:generateContent", request =>
        {
            requestBody = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            apiKey = request.Headers.TryGetValues("x-goog-api-key", out var values)
                ? values.Single()
                : null;

            return Json(
                """
                {
                  "candidates":[{
                    "content":{"role":"model","parts":[{
                      "functionCall":{"name":"concepts_list","id":"call_1","args":{"limit":5}},
                      "thoughtSignature":"sig-1"
                    }]},
                    "finishReason":"STOP"
                  }],
                  "usageMetadata":{
                    "promptTokenCount":100,
                    "candidatesTokenCount":20,
                    "thoughtsTokenCount":30,
                    "totalTokenCount":150
                  }
                }
                """);
        });

        var provider = Gemini(handler);
        var completion = await provider.CompleteAsync(new LlmCompletionRequest(
            [LlmMessage.User("List concepts")],
            [new LlmToolDefinition(
                "concepts_list",
                "List concepts.",
                """{"type":"object","properties":{"limit":{"type":"integer"}},"additionalProperties":false}""")],
            4096));

        apiKey.Should().Be(GeminiKey);
        requestBody.Should().Contain("thinkingLevel");
        requestBody.Should().Contain("low");
        requestBody.Should().Contain("functionDeclarations");
        requestBody.Should().Contain("concepts_list");
        requestBody.Should().NotContain("additionalProperties");

        completion.ToolCalls.Should().ContainSingle();
        completion.ToolCalls[0].Name.Should().Be("concepts_list");
        completion.FinishReason.Should().Be("stop");
        completion.PromptTokens.Should().Be(100);
        completion.CompletionTokens.Should().Be(50,
            "Gemini total output billing includes visible candidate plus thinking tokens");
        completion.ThinkingTokens.Should().Be(30);
        completion.ProviderState.Should().Contain("thoughtSignature");
    }

    [Fact]
    public async Task Gemini_replays_provider_round_state_across_tool_calls()
    {
        var handler = new StubHttpMessageHandler();
        var call = 0;
        string? secondBody = null;

        handler.Register("/v1beta/models/gemini-3.8-flash:generateContent", request =>
        {
            call++;
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();

            if (call == 1)
            {
                return Json(
                    """
                    {
                      "candidates":[{
                        "content":{"role":"model","parts":[{
                          "functionCall":{"name":"concepts_list","id":"call_1","args":{}},
                          "thoughtSignature":"signature-that-must-round-trip"
                        }]},
                        "finishReason":"STOP"
                      }],
                      "usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2,"thoughtsTokenCount":3,"totalTokenCount":15}
                    }
                    """);
            }

            secondBody = body;
            return Json(
                """
                {
                  "candidates":[{"content":{"role":"model","parts":[{"text":"Done."}]},"finishReason":"STOP"}],
                  "usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":2,"totalTokenCount":22}
                }
                """);
        });

        var provider = Gemini(handler);
        var tools = new[]
        {
            new LlmToolDefinition("concepts_list", "List concepts.", """{"type":"object"}"""),
        };

        var first = await provider.CompleteAsync(
            new LlmCompletionRequest([LlmMessage.User("List concepts")], tools, 4096));

        var messages = new List<LlmMessage>
        {
            LlmMessage.User("List concepts"),
            LlmMessage.Assistant(first.Content, first.ToolCalls, first.ProviderState),
            LlmMessage.Tool("call_1", """{"items":[]}"""),
        };

        var second = await provider.CompleteAsync(
            new LlmCompletionRequest(messages, tools, 4096));

        second.Content.Should().Be("Done.");
        secondBody.Should().Contain("signature-that-must-round-trip");
        secondBody.Should().Contain("functionResponse");
        secondBody.Should().Contain("concepts_list");
        secondBody.Should().Contain("call_1");
    }

    [Fact]
    public async Task Gemini_rate_limit_is_safe_typed_data_and_is_not_retried()
    {
        var handler = new StubHttpMessageHandler();
        handler.Register(
            "/v1beta/models/gemini-3.8-flash:generateContent",
            _ => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
            {
                Content = new StringContent("""{"error":{"message":"sensitive upstream detail"}}"""),
            });

        var provider = Gemini(handler);

        var act = () => provider.CompleteAsync(
            new LlmCompletionRequest([LlmMessage.User("hello")], [], 128));

        var exception = (await act.Should().ThrowAsync<LlmException>()).Which;
        exception.Code.Should().Be(LlmErrorCodes.RateLimited);
        exception.Message.Should().NotContain("sensitive upstream detail");
        handler.RecordedRequests.Should().ContainSingle();
    }

    [Fact]
    public async Task Groq_managed_stt_uses_direct_endpoint_and_server_credential()
    {
        var handler = new StubHttpMessageHandler();
        Uri? uri = null;
        AuthenticationHeaderValue? authorization = null;
        string? multipart = null;

        handler.Register("/openai/v1/audio/transcriptions", request =>
        {
            uri = request.RequestUri;
            authorization = request.Headers.Authorization;
            multipart = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();

            return Json("""{"text":" The Magic Mountain ","language":"en","duration":1.25}""");
        });

        var provider = new GroqManagedSttProvider(
            new StubHttpClientFactory(handler, new Uri("https://api.groq.com")),
            new SpeechOptions(),
            new StubAiProviderConfigResolver
            {
                Stt = new EffectiveAiProviderConfig(
                    Enabled: true,
                    BaseUrl: "https://api.groq.com/openai",
                    Model: "whisper-large-v3-turbo",
                    ApiKeyEnvironmentVariable: "TEST_GROQ_KEY",
                    ApiKey: GroqKey,
                    KeyFromServerEnv: true),
            },
            NullLogger<GroqManagedSttProvider>.Instance);

        var result = await provider.TranscribeAsync(
            new MemoryStream(Encoding.UTF8.GetBytes("fake audio")),
            "clip.webm",
            "audio/webm;codecs=opus",
            "en");

        uri!.AbsolutePath.Should().Be("/openai/v1/audio/transcriptions");
        authorization!.Scheme.Should().Be("Bearer");
        authorization.Parameter.Should().Be(GroqKey);
        multipart.Should().Contain("whisper-large-v3-turbo");
        multipart.Should().Contain("verbose_json");
        result.Text.Should().Be("The Magic Mountain");
        result.Language.Should().Be("en");
        result.DurationSeconds.Should().Be(1.25);
    }

    private static GeminiManagedLlmProvider Gemini(StubHttpMessageHandler handler)
    {
        var options = new CloudManagedAiOptions();
        options.Validate();

        return new GeminiManagedLlmProvider(
            new StubHttpClientFactory(handler, new Uri("https://generativelanguage.googleapis.com")),
            new StubAiProviderConfigResolver
            {
                Llm = new EffectiveAiProviderConfig(
                    Enabled: true,
                    BaseUrl: options.LlmBaseUrl,
                    Model: options.LlmModel,
                    ApiKeyEnvironmentVariable: "TEST_GEMINI_KEY",
                    ApiKey: GeminiKey,
                    KeyFromServerEnv: true),
            },
            options,
            NullLogger<GeminiManagedLlmProvider>.Instance);
    }

    private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };
}
