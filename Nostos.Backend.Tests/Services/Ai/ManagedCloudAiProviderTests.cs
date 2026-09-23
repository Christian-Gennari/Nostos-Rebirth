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
    public void Defaults_pin_the_managed_gateway_policy()
    {
        var options = new CloudManagedAiOptions();

        options.LlmBaseUrl.Should().Be("https://ai-gateway.vercel.sh/v1");
        options.LlmModel.Should().Be("google/gemini-3.8-flash");
        options.LlmThinkingLevel.Should().Be("low");
        options.SttModel.Should().Be("whisper-large-v3-turbo");
        options.LlmApiKeyEnvironmentVariable.Should().Be("NOSTOS_CLOUD_AI_GATEWAY_API_KEY");
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
        const string variable = "NOSTOS_MANAGED_AI_TEST_GATEWAY_KEY";
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
            effective.BaseUrl.Should().Be("https://ai-gateway.vercel.sh/v1");
            effective.Model.Should().Be("google/gemini-3.8-flash");
            effective.ApiKey.Should().Be(secret);
            effective.KeyFromServerEnv.Should().BeTrue();

            var get = () => settings.GetAsync();
            var update = () => settings.UpdateAsync(
                new AiProviderSettingsUpdateRequest(
                    new AiProviderSectionUpdate(
                        true,
                        "https://attacker.invalid",
                        "other-model",
                        "client-key"),
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
            "monthly consumption enforcement belongs to #405, not the provider transport");
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
    private const string GatewayKey = "gateway-test-key";
    private const string GroqKey = "groq-test-key";

    [Fact]
    public async Task Gateway_sends_explicit_low_reasoning_and_surfaces_billable_usage()
    {
        var handler = new StubHttpMessageHandler();
        string? requestBody = null;
        AuthenticationHeaderValue? authorization = null;
        Uri? uri = null;

        handler.Register("/v1/chat/completions", request =>
        {
            requestBody = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            authorization = request.Headers.Authorization;
            uri = request.RequestUri;

            return Json(
                """
                {
                  "choices":[{
                    "message":{"role":"assistant","content":"Done."},
                    "finish_reason":"stop"
                  }],
                  "usage":{
                    "prompt_tokens":100,
                    "completion_tokens":50,
                    "total_tokens":150,
                    "completion_tokens_details":{"reasoning_tokens":30}
                  }
                }
                """);
        });

        var provider = Gateway(handler);
        var completion = await provider.CompleteAsync(new LlmCompletionRequest(
            [LlmMessage.User("Answer briefly")],
            [],
            4096));

        uri!.AbsolutePath.Should().Be("/v1/chat/completions");
        authorization!.Scheme.Should().Be("Bearer");
        authorization.Parameter.Should().Be(GatewayKey);
        requestBody.Should().Contain(""model":"google/gemini-3.8-flash"");
        requestBody.Should().Contain(""reasoning_effort":"low"");
        requestBody.Should().Contain(""stream":false");

        completion.Content.Should().Be("Done.");
        completion.FinishReason.Should().Be("stop");
        completion.PromptTokens.Should().Be(100);
        completion.CompletionTokens.Should().Be(50,
            "OpenAI-compatible completion_tokens already includes billed reasoning output");
        completion.ThinkingTokens.Should().Be(30);
    }

    [Fact]
    public async Task Gateway_serializes_tools_and_replays_opaque_tool_metadata_on_follow_up()
    {
        var handler = new StubHttpMessageHandler();
        var call = 0;
        string? firstBody = null;
        string? secondBody = null;

        handler.Register("/v1/chat/completions", request =>
        {
            call++;
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();

            if (call == 1)
            {
                firstBody = body;
                return Json(
                    """
                    {
                      "choices":[{
                        "message":{
                          "role":"assistant",
                          "content":null,
                          "tool_calls":[{
                            "id":"call_1",
                            "type":"function",
                            "function":{"name":"concepts_list","arguments":"{\"limit\":5}"},
                            "extra_content":{"google":{"thought_signature":"signature-that-must-round-trip"}}
                          }]
                        },
                        "finish_reason":"tool_calls"
                      }],
                      "usage":{
                        "prompt_tokens":10,
                        "completion_tokens":5,
                        "total_tokens":15,
                        "completion_tokens_details":{"reasoning_tokens":3}
                      }
                    }
                    """);
            }

            secondBody = body;
            return Json(
                """
                {
                  "choices":[{
                    "message":{"role":"assistant","content":"Done."},
                    "finish_reason":"stop"
                  }],
                  "usage":{"prompt_tokens":20,"completion_tokens":2,"total_tokens":22}
                }
                """);
        });

        var provider = Gateway(handler);
        var tools = new[]
        {
            new LlmToolDefinition(
                "concepts_list",
                "List concepts.",
                """{"type":"object","properties":{"limit":{"type":"integer"}},"additionalProperties":false}"""),
        };

        var first = await provider.CompleteAsync(
            new LlmCompletionRequest([LlmMessage.User("List concepts")], tools, 4096));

        first.ToolCalls.Should().ContainSingle();
        first.ToolCalls[0].Id.Should().Be("call_1");
        first.ToolCalls[0].Name.Should().Be("concepts_list");
        first.ToolCalls[0].ArgumentsJson.Should().Be("""{"limit":5}""");
        first.ProviderState.Should().Contain("thought_signature");
        first.ProviderState.Should().Contain("signature-that-must-round-trip");

        firstBody.Should().Contain(""tools"");
        firstBody.Should().Contain(""concepts_list"");
        firstBody.Should().Contain(""additionalProperties":false");

        var messages = new List<LlmMessage>
        {
            LlmMessage.User("List concepts"),
            LlmMessage.Assistant(first.Content, first.ToolCalls, first.ProviderState),
            LlmMessage.Tool("call_1", """{"items":[]}"""),
        };

        var second = await provider.CompleteAsync(
            new LlmCompletionRequest(messages, tools, 4096));

        second.Content.Should().Be("Done.");
        secondBody.Should().Contain(""extra_content"");
        secondBody.Should().Contain("signature-that-must-round-trip");
        secondBody.Should().Contain(""tool_call_id":"call_1"");
        secondBody.Should().Contain(""id":"call_1"");
        secondBody.Should().Contain(""name":"concepts_list"");
    }

    [Fact]
    public async Task Gateway_uses_total_tokens_as_output_fallback_when_completion_tokens_are_missing()
    {
        var handler = new StubHttpMessageHandler();
        handler.Register(
            "/v1/chat/completions",
            _ => Json(
                """
                {
                  "choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],
                  "usage":{"prompt_tokens":12,"total_tokens":19}
                }
                """));

        var completion = await Gateway(handler).CompleteAsync(new LlmCompletionRequest(
            [LlmMessage.User("hello")],
            [],
            128));

        completion.PromptTokens.Should().Be(12);
        completion.CompletionTokens.Should().Be(7);
        completion.ThinkingTokens.Should().BeNull();
    }

    [Fact]
    public async Task Gateway_missing_secret_fails_before_any_upstream_request_without_exposing_secret_name()
    {
        var handler = new StubHttpMessageHandler();
        var provider = Gateway(handler, apiKey: null);

        var act = () => provider.CompleteAsync(
            new LlmCompletionRequest([LlmMessage.User("hello")], [], 128));

        var exception = (await act.Should().ThrowAsync<LlmException>()).Which;
        exception.Code.Should().Be(LlmErrorCodes.NotConfigured);
        exception.Message.Should().NotContain("NOSTOS_CLOUD_AI_GATEWAY_API_KEY");
        handler.RecordedRequests.Should().BeEmpty();
    }

    [Fact]
    public async Task Gateway_failure_is_sanitized_and_not_retried()
    {
        var handler = new StubHttpMessageHandler();
        handler.Register(
            "/v1/chat/completions",
            _ => new HttpResponseMessage(HttpStatusCode.BadGateway)
            {
                Content = new StringContent(
                    """{"error":{"message":"sensitive upstream payload"}}""",
                    Encoding.UTF8,
                    "application/json"),
            });

        var provider = Gateway(handler);
        var act = () => provider.CompleteAsync(
            new LlmCompletionRequest([LlmMessage.User("hello")], [], 128));

        var exception = (await act.Should().ThrowAsync<LlmException>()).Which;
        exception.Code.Should().Be(LlmErrorCodes.Provider);
        exception.Message.Should().NotContain("sensitive upstream payload");
        exception.Message.Should().NotContain(GatewayKey);
        handler.RecordedRequests.Should().ContainSingle();
    }

    [Fact]
    public async Task Gateway_rate_limit_is_typed_and_sanitized()
    {
        var handler = new StubHttpMessageHandler();
        handler.Register(
            "/v1/chat/completions",
            _ => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
            {
                Content = new StringContent(
                    """{"error":{"message":"private rate-limit detail"}}""",
                    Encoding.UTF8,
                    "application/json"),
            });

        var act = () => Gateway(handler).CompleteAsync(
            new LlmCompletionRequest([LlmMessage.User("hello")], [], 128));

        var exception = (await act.Should().ThrowAsync<LlmException>()).Which;
        exception.Code.Should().Be(LlmErrorCodes.RateLimited);
        exception.Message.Should().NotContain("private rate-limit detail");
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

    private static VercelAiGatewayManagedLlmProvider Gateway(
        StubHttpMessageHandler handler,
        string? apiKey = GatewayKey)
    {
        var options = new CloudManagedAiOptions();
        options.Validate();

        return new VercelAiGatewayManagedLlmProvider(
            new StubHttpClientFactory(handler, new Uri("https://ai-gateway.vercel.sh")),
            new StubAiProviderConfigResolver
            {
                Llm = new EffectiveAiProviderConfig(
                    Enabled: true,
                    BaseUrl: options.LlmBaseUrl,
                    Model: options.LlmModel,
                    ApiKeyEnvironmentVariable: "TEST_GATEWAY_KEY",
                    ApiKey: apiKey,
                    KeyFromServerEnv: apiKey is not null),
            },
            options,
            NullLogger<VercelAiGatewayManagedLlmProvider>.Instance);
    }

    private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };
}
