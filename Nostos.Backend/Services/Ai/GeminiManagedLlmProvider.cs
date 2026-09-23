using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Nostos-managed Gemini transport for Cloud. Uses Google's native
/// generateContent API so thinking level and thought signatures are explicit,
/// while the rest of Nostos continues to depend only on ILlmProvider.
/// One logical completion performs exactly one upstream request.
/// </summary>
public sealed class GeminiManagedLlmProvider(
    IHttpClientFactory httpClientFactory,
    IAiProviderConfigResolver config,
    CloudManagedAiOptions options,
    ILogger<GeminiManagedLlmProvider> logger) : ILlmProvider
{
    public const string HttpClientName = "assistant-gemini-managed";

    private static readonly HashSet<string> DisallowedSchemaProperties = new(StringComparer.Ordinal)
    {
        "additionalProperties", "$schema", "default", "const", "examples",
        "patternProperties", "oneOf", "anyOf", "allOf", "if", "then", "else"
    };

    public async Task<LlmCompletion> CompleteAsync(
        LlmCompletionRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var effective = await config.GetEffectiveLlmAsync(ct);
        if (!effective.Enabled)
            throw LlmException.Disabled();
        if (string.IsNullOrWhiteSpace(effective.ApiKey)
            || string.IsNullOrWhiteSpace(effective.BaseUrl)
            || string.IsNullOrWhiteSpace(effective.Model))
        {
            throw new LlmException(
                LlmErrorCodes.NotConfigured,
                "Ask Nostos managed AI is unavailable.");
        }

        var payload = BuildRequestBody(request, options.LlmThinkingLevel);
        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            BuildUri(effective.BaseUrl, effective.Model))
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Add("x-goog-api-key", effective.ApiKey.Trim());

        var client = httpClientFactory.CreateClient(HttpClientName);
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(
                httpRequest,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            throw LlmException.TimedOut();
        }
        catch (HttpRequestException)
        {
            throw LlmException.ProviderFailure(
                "the managed AI service could not be reached.");
        }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw LlmException.PermissionDenied();
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw LlmException.RateLimited();
            if (response.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.GatewayTimeout)
                throw LlmException.TimedOut();
            if (!response.IsSuccessStatusCode)
            {
                throw LlmException.ProviderFailure(
                    $"the managed AI service returned HTTP {(int)response.StatusCode}.");
            }

            var body = await response.Content.ReadAsStringAsync(ct);
            var completion = ParseResponse(body);

            logger.LogDebug(
                "Managed Gemini completion with model {Model}: finish {FinishReason}, {ToolCalls} tool call(s).",
                effective.Model,
                completion.FinishReason ?? "(none)",
                completion.ToolCalls.Count);

            return completion;
        }
    }

    private static Uri BuildUri(string baseUrl, string model) =>
        new($"{baseUrl.TrimEnd('/')}/models/{Uri.EscapeDataString(model)}:generateContent");

    private static JsonObject BuildRequestBody(
        LlmCompletionRequest request,
        string thinkingLevel)
    {
        var root = new JsonObject();
        var systemMessages = request.Messages
            .Where(message =>
                string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(message.Content))
            .ToList();

        if (systemMessages.Count > 0)
        {
            var parts = new JsonArray();
            foreach (var message in systemMessages)
                parts.Add(new JsonObject { ["text"] = message.Content });
            root["systemInstruction"] = new JsonObject { ["parts"] = parts };
        }

        root["contents"] = BuildContents(request.Messages);

        if (request.Tools.Count > 0)
        {
            var declarations = new JsonArray();
            foreach (var tool in request.Tools)
            {
                JsonNode schema;
                try
                {
                    schema = JsonNode.Parse(tool.ParametersJsonSchema)
                        ?? new JsonObject { ["type"] = "object" };
                }
                catch (JsonException)
                {
                    schema = new JsonObject { ["type"] = "object" };
                }

                declarations.Add(new JsonObject
                {
                    ["name"] = tool.Name,
                    ["description"] = tool.Description,
                    ["parameters"] = SanitizeSchema(schema),
                });
            }

            root["tools"] = new JsonArray
            {
                new JsonObject { ["functionDeclarations"] = declarations }
            };
        }

        root["generationConfig"] = new JsonObject
        {
            ["maxOutputTokens"] = request.MaxTokens,
            ["thinkingConfig"] = new JsonObject
            {
                ["thinkingLevel"] = thinkingLevel,
            },
        };

        return root;
    }

    private static JsonArray BuildContents(IReadOnlyList<LlmMessage> messages)
    {
        var toolNames = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var message in messages)
        {
            if (message.ToolCalls is null) continue;
            foreach (var call in message.ToolCalls)
                toolNames[call.Id] = call.Name;
        }

        var rawTurns = new List<(string Role, List<JsonObject> Parts)>();
        foreach (var message in messages)
        {
            if (string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase))
                continue;

            if (string.Equals(message.Role, "user", StringComparison.OrdinalIgnoreCase))
            {
                rawTurns.Add(("user", [new JsonObject { ["text"] = message.Content ?? string.Empty }]));
                continue;
            }

            if (string.Equals(message.Role, "assistant", StringComparison.OrdinalIgnoreCase))
            {
                rawTurns.Add(("model",
                    TryReadProviderParts(message.ProviderState)
                    ?? RebuildAssistantParts(message)));
                continue;
            }

            if (string.Equals(message.Role, "tool", StringComparison.OrdinalIgnoreCase))
            {
                var callId = message.ToolCallId ?? string.Empty;
                var name = toolNames.GetValueOrDefault(callId, callId);
                JsonNode response;
                try
                {
                    var parsed = JsonNode.Parse(message.Content ?? "{}");
                    response = parsed is JsonObject obj
                        ? obj
                        : new JsonObject { ["result"] = message.Content ?? string.Empty };
                }
                catch (JsonException)
                {
                    response = new JsonObject { ["result"] = message.Content ?? string.Empty };
                }

                rawTurns.Add(("user",
                [
                    new JsonObject
                    {
                        ["functionResponse"] = new JsonObject
                        {
                            ["name"] = name,
                            ["id"] = callId,
                            ["response"] = response,
                        },
                    }
                ]));
            }
        }

        var contents = new JsonArray();
        JsonObject? current = null;
        string? currentRole = null;

        foreach (var (role, parts) in rawTurns)
        {
            if (current is not null && currentRole == role)
            {
                var existing = current["parts"]!.AsArray();
                foreach (var part in parts) existing.Add(part);
                continue;
            }

            currentRole = role;
            var array = new JsonArray();
            foreach (var part in parts) array.Add(part);
            current = new JsonObject { ["role"] = role, ["parts"] = array };
            contents.Add(current);
        }

        return contents;
    }

    private static List<JsonObject>? TryReadProviderParts(string? state)
    {
        if (string.IsNullOrWhiteSpace(state)) return null;

        try
        {
            var array = JsonNode.Parse(state) as JsonArray;
            if (array is null) return null;

            var parts = new List<JsonObject>();
            foreach (var node in array)
            {
                if (node is JsonObject obj)
                    parts.Add(obj.DeepClone().AsObject());
            }

            return parts.Count > 0 ? parts : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static List<JsonObject> RebuildAssistantParts(LlmMessage message)
    {
        var parts = new List<JsonObject>();

        if (!string.IsNullOrWhiteSpace(message.Content))
            parts.Add(new JsonObject { ["text"] = message.Content });

        if (message.ToolCalls is not null)
        {
            foreach (var call in message.ToolCalls)
            {
                JsonNode args;
                try
                {
                    args = JsonNode.Parse(call.ArgumentsJson) ?? new JsonObject();
                }
                catch (JsonException)
                {
                    args = new JsonObject();
                }

                parts.Add(new JsonObject
                {
                    ["functionCall"] = new JsonObject
                    {
                        ["name"] = call.Name,
                        ["id"] = call.Id,
                        ["args"] = args,
                    },
                });
            }
        }

        return parts;
    }

    private static JsonNode SanitizeSchema(JsonNode schema)
    {
        var clone = schema.DeepClone();
        SanitizeInPlace(clone);
        return clone;
    }

    private static void SanitizeInPlace(JsonNode node)
    {
        if (node is JsonObject obj)
        {
            foreach (var key in obj
                .Where(item => DisallowedSchemaProperties.Contains(item.Key))
                .Select(item => item.Key)
                .ToList())
            {
                obj.Remove(key);
            }

            foreach (var item in obj)
            {
                if (item.Value is not null)
                    SanitizeInPlace(item.Value);
            }
        }
        else if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                if (item is not null)
                    SanitizeInPlace(item);
            }
        }
    }

    private static LlmCompletion ParseResponse(string body)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            throw LlmException.InvalidResponse(
                "the managed AI service returned unreadable JSON.");
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("candidates", out var candidates)
                || candidates.ValueKind != JsonValueKind.Array
                || candidates.GetArrayLength() == 0)
            {
                throw LlmException.InvalidResponse(
                    "the managed AI service returned no candidate.");
            }

            var candidate = candidates[0];
            string? finish = candidate.TryGetProperty("finishReason", out var finishElement)
                && finishElement.ValueKind == JsonValueKind.String
                    ? MapFinishReason(finishElement.GetString())
                    : null;

            var text = new List<string>();
            var toolCalls = new List<LlmToolCall>();
            string? providerState = null;

            if (candidate.TryGetProperty("content", out var content)
                && content.TryGetProperty("parts", out var parts)
                && parts.ValueKind == JsonValueKind.Array)
            {
                var rawParts = JsonNode.Parse(parts.GetRawText()) as JsonArray;

                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var textElement)
                        && textElement.ValueKind == JsonValueKind.String
                        && !string.IsNullOrEmpty(textElement.GetString()))
                    {
                        text.Add(textElement.GetString()!);
                    }

                    if (part.TryGetProperty("functionCall", out var functionCall)
                        && functionCall.ValueKind == JsonValueKind.Object)
                    {
                        var name = functionCall.TryGetProperty("name", out var nameElement)
                            ? nameElement.GetString() ?? string.Empty
                            : string.Empty;
                        if (name.Length == 0) continue;

                        var id = functionCall.TryGetProperty("id", out var idElement)
                            && idElement.ValueKind == JsonValueKind.String
                                ? idElement.GetString() ?? Guid.NewGuid().ToString("N")
                                : Guid.NewGuid().ToString("N");
                        var args = functionCall.TryGetProperty("args", out var argsElement)
                            ? argsElement.GetRawText()
                            : "{}";

                        toolCalls.Add(new LlmToolCall(id, name, args));
                    }
                }

                if (toolCalls.Count > 0 && rawParts is not null)
                    providerState = rawParts.ToJsonString();
            }

            int? promptTokens = null;
            int? candidateTokens = null;
            int? thinkingTokens = null;
            int? totalTokens = null;

            if (document.RootElement.TryGetProperty("usageMetadata", out var usage)
                && usage.ValueKind == JsonValueKind.Object)
            {
                promptTokens = ReadInt(usage, "promptTokenCount");
                candidateTokens = ReadInt(usage, "candidatesTokenCount");
                thinkingTokens = ReadInt(usage, "thoughtsTokenCount");
                totalTokens = ReadInt(usage, "totalTokenCount");
            }

            int? billedOutputTokens =
                totalTokens is { } total && promptTokens is { } prompt && total >= prompt
                    ? total - prompt
                    : candidateTokens is { } visible && thinkingTokens is { } thoughts
                        ? checked(visible + thoughts)
                        : candidateTokens;

            return new LlmCompletion(
                text.Count > 0 ? string.Concat(text) : null,
                finish,
                toolCalls,
                promptTokens,
                billedOutputTokens,
                thinkingTokens,
                providerState);
        }
    }

    private static int? ReadInt(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt32(out var parsed)
            ? parsed
            : null;

    private static string? MapFinishReason(string? value) =>
        value?.ToUpperInvariant() switch
        {
            "STOP" => "stop",
            "MAX_TOKENS" => "length",
            null => null,
            _ => value!.ToLowerInvariant(),
        };
}
