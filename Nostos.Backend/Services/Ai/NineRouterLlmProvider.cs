using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Chat-with-tools against the 9Router gateway's OpenAI-compatible
/// <c>POST {BaseUrl}/chat/completions</c> route (issue #261 §3, decision D8).
///
/// One provider, one call, no retry loop. The credential and endpoint are read
/// at call time from the EFFECTIVE configuration — the stored override when set,
/// otherwise the appsettings/environment fallback (see
/// <see cref="IAiProviderConfigResolver"/>) — and the key is attached only to
/// the outbound request: it is never logged, returned, or handed to the client.
/// The model id is sent exactly as configured. There is no second provider and
/// no paid fallback: see <see cref="Nostos.Backend.Configuration.AssistantOptions.Model"/>
/// for the tool-calling requirement the configured id must satisfy.
///
/// Gateway quirks that are load-bearing and therefore encoded here:
/// <list type="bullet">
/// <item><c>stream:false</c> is sent EXPLICITLY. Omitting it makes the gateway
/// return SSE, which reads like a malformed JSON body.</item>
/// <item>An empty content with <c>finish_reason:"length"</c> is a normal
/// outcome (the pool spent its budget reasoning), not an error.</item>
/// </list>
/// </summary>
public sealed class NineRouterLlmProvider(
    IHttpClientFactory httpClientFactory,
    IAiProviderConfigResolver config,
    ILogger<NineRouterLlmProvider> logger) : ILlmProvider
{
    /// <summary>Name of the registered <see cref="IHttpClientFactory"/> client.</summary>
    public const string HttpClientName = "assistant-ninerouter";

    private const string ChatCompletionsPath = "chat/completions";

    // The pool injects ~2 KB of its own prompt and spends reasoning tokens even
    // on trivial answers; this is deliberately generous and lives here rather
    // than as untyped config.
    private const int MaxTokensCeiling = 8192;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<LlmCompletion> CompleteAsync(
        LlmCompletionRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var effective = await config.GetEffectiveLlmAsync(ct);

        if (string.IsNullOrWhiteSpace(effective.ApiKey))
        {
            throw LlmException.NotConfigured(effective.ApiKeyEnvironmentVariable);
        }

        if (string.IsNullOrWhiteSpace(effective.BaseUrl))
        {
            throw LlmException.NotConfiguredSetting("Assistant:BaseUrl");
        }

        if (string.IsNullOrWhiteSpace(effective.Model))
        {
            throw LlmException.NotConfiguredSetting("Assistant:Model");
        }

        var payload = BuildPayload(request, effective.Model);
        var body = JsonSerializer.Serialize(payload, JsonOptions);

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, BuildUri(effective.BaseUrl))
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", effective.ApiKey.Trim());

        var client = httpClientFactory.CreateClient(HttpClientName);

        HttpResponseMessage response;
        try
        {
            // Read the body yourself, after the headers, so a large error body is
            // never an implicit download. A single send: no retry handler.
            response = await client.SendAsync(
                httpRequest,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Cancellation is not a provider failure. Let it stay a cancellation.
            throw;
        }
        catch (HttpRequestException ex)
        {
            throw LlmException.ProviderFailure($"the gateway could not be reached ({ex.Message})");
        }
        catch (TaskCanceledException ex)
        {
            // The named client's timeout, not the caller's token: a provider
            // timeout is data, not a hang.
            throw LlmException.ProviderFailure($"the gateway timed out ({ex.Message})");
        }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
                or HttpStatusCode.TooManyRequests)
            {
                throw LlmException.PermissionDenied();
            }

            if (!response.IsSuccessStatusCode)
            {
                var detail = await ReadErrorDetailAsync(response, ct);
                throw LlmException.ProviderFailure(
                    $"HTTP {(int)response.StatusCode}{(detail is null ? string.Empty : $": {detail}")}");
            }

            var responseBody = await response.Content.ReadAsStringAsync(ct);
            var completion = ParseResponse(responseBody);

            // Deliberately no prompt content and no credential in this line.
            logger.LogDebug(
                "Assistant completion with model {Model}: finish {FinishReason}, {ToolCalls} tool call(s).",
                effective.Model,
                completion.FinishReason ?? "(none)",
                completion.ToolCalls.Count);

            return completion;
        }
    }

    private static Uri BuildUri(string baseUrl)
    {
        var trimmed = baseUrl.TrimEnd('/');
        return new Uri($"{trimmed}/{ChatCompletionsPath}");
    }

    /// <summary>
    /// The wire body. It is built as loose dictionaries rather than a typed
    /// request DTO so the exact shape is visible and the load-bearing
    /// <c>stream:false</c> cannot be dropped by a serializer convention.
    /// </summary>
    private static Dictionary<string, object?> BuildPayload(
        LlmCompletionRequest request,
        string model)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            // EXPLICIT. Omitting this makes the gateway stream SSE.
            ["stream"] = false,
            ["max_tokens"] = Math.Clamp(request.MaxTokens, 1, MaxTokensCeiling),
            ["messages"] = request.Messages.Select(MessagePayload).ToList(),
        };

        if (request.Tools.Count > 0)
        {
            payload["tools"] = request.Tools.Select(tool => new Dictionary<string, object?>
            {
                ["type"] = "function",
                ["function"] = new Dictionary<string, object?>
                {
                    ["name"] = tool.Name,
                    ["description"] = tool.Description,
                    ["parameters"] = ParseSchema(tool.ParametersJsonSchema),
                },
            }).ToList();
        }

        return payload;
    }

    private static Dictionary<string, object?> MessagePayload(LlmMessage message)
    {
        var payload = new Dictionary<string, object?>
        {
            ["role"] = message.Role,
            ["content"] = message.Content,
        };

        if (!string.IsNullOrWhiteSpace(message.ToolCallId))
        {
            payload["tool_call_id"] = message.ToolCallId;
        }

        if (message.ToolCalls is { Count: > 0 })
        {
            payload["tool_calls"] = message.ToolCalls.Select(call => new Dictionary<string, object?>
            {
                ["id"] = call.Id,
                ["type"] = "function",
                ["function"] = new Dictionary<string, object?>
                {
                    ["name"] = call.Name,
                    ["arguments"] = call.ArgumentsJson,
                },
            }).ToList();
        }

        return payload;
    }

    private static JsonElement ParseSchema(string schema)
    {
        if (!string.IsNullOrWhiteSpace(schema))
        {
            try
            {
                return JsonDocument.Parse(schema).RootElement.Clone();
            }
            catch (JsonException)
            {
                // A malformed schema is ours, not the model's: fall back to an
                // open object rather than failing the whole turn.
            }
        }

        return JsonDocument.Parse("""{"type":"object","properties":{}}""").RootElement.Clone();
    }

    private static LlmCompletion ParseResponse(string body)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            throw LlmException.InvalidResponse($"the body was not JSON ({ex.Message})");
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("choices", out var choices)
                || choices.ValueKind != JsonValueKind.Array
                || choices.GetArrayLength() == 0)
            {
                throw LlmException.InvalidResponse("the body carried no choices");
            }

            var choice = choices[0];
            choice.TryGetProperty("finish_reason", out var finish);
            choice.TryGetProperty("message", out var message);

            var content = message.ValueKind == JsonValueKind.Object
                && message.TryGetProperty("content", out var contentElement)
                && contentElement.ValueKind == JsonValueKind.String
                    ? contentElement.GetString()
                    : null;

            var toolCalls = ParseToolCalls(message);

            int? promptTokens = null;
            int? completionTokens = null;
            if (document.RootElement.TryGetProperty("usage", out var usage)
                && usage.ValueKind == JsonValueKind.Object)
            {
                if (usage.TryGetProperty("prompt_tokens", out var prompt)
                    && prompt.TryGetInt32(out var promptValue))
                {
                    promptTokens = promptValue;
                }

                if (usage.TryGetProperty("completion_tokens", out var completion)
                    && completion.TryGetInt32(out var completionValue))
                {
                    completionTokens = completionValue;
                }
            }

            return new LlmCompletion(
                content,
                finish.ValueKind == JsonValueKind.String ? finish.GetString() : null,
                toolCalls,
                promptTokens,
                completionTokens);
        }
    }

    private static IReadOnlyList<LlmToolCall> ParseToolCalls(JsonElement message)
    {
        if (message.ValueKind != JsonValueKind.Object
            || !message.TryGetProperty("tool_calls", out var toolCalls)
            || toolCalls.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var parsed = new List<LlmToolCall>();
        foreach (var call in toolCalls.EnumerateArray())
        {
            if (call.ValueKind != JsonValueKind.Object
                || !call.TryGetProperty("function", out var function)
                || function.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var name = function.TryGetProperty("name", out var nameElement)
                && nameElement.ValueKind == JsonValueKind.String
                    ? nameElement.GetString()
                    : null;
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var id = call.TryGetProperty("id", out var idElement)
                && idElement.ValueKind == JsonValueKind.String
                    ? idElement.GetString()
                    : null;

            // The pool returns arguments as a JSON string, but a few OpenAI
            // implementations return an object; accept both so a tool call is
            // never silently lost.
            string argumentsJson;
            if (function.TryGetProperty("arguments", out var arguments))
            {
                argumentsJson = arguments.ValueKind == JsonValueKind.String
                    ? arguments.GetString() ?? "{}"
                    : arguments.GetRawText();
            }
            else
            {
                argumentsJson = "{}";
            }

            parsed.Add(new LlmToolCall(id ?? Guid.NewGuid().ToString("N"), name, argumentsJson));
        }

        return parsed;
    }

    /// <summary>
    /// Best-effort extraction of the gateway's <c>{"error":{"message":…}}</c>
    /// body. A body we cannot read is not itself an error; the status code is
    /// the signal, and the detail is only there to make a log line useful.
    /// </summary>
    private static async Task<string?> ReadErrorDetailAsync(
        HttpResponseMessage response,
        CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            if (string.IsNullOrWhiteSpace(body))
            {
                return null;
            }

            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object
                && error.TryGetProperty("message", out var message)
                && message.ValueKind == JsonValueKind.String)
            {
                return message.GetString();
            }

            return body.Length <= 300 ? body : body[..300];
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
