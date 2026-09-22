using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Nostos.Backend.Services.Ai;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Direct Google Generative Language API adapter for measurement runs.
/// Exercises Gemini models with thinking configuration and function calling, preserving
/// raw response parts for thought-signature replay across tool-loop iterations.
/// </summary>
public sealed class GeminiMeasurementLlmProvider : ILlmProvider, IDisposable
{
    private static readonly HashSet<string> DisallowedSchemaProperties = new(StringComparer.Ordinal)
    {
        "additionalProperties",
        "$schema",
        "default",
        "const",
        "examples",
        "patternProperties",
        "oneOf",
        "anyOf",
        "allOf",
        "if",
        "then",
        "else"
    };

    private readonly HttpClient _httpClient;
    private readonly IReadOnlyList<string> _apiKeys;
    private readonly string _model;
    private readonly string _thinkingLevel;
    private readonly Dictionary<string, string> _toolCallNames = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsonArray> _rememberedRoundParts = new(StringComparer.Ordinal);
    private int _keyIndex;
    private int _roundCounter;

    public GeminiMeasurementLlmProvider(
        IReadOnlyList<string> apiKeys,
        string model = "gemini-3.8-flash",
        string thinkingLevel = "low")
    {
        _apiKeys = apiKeys;
        _model = model;
        _thinkingLevel = thinkingLevel;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(90),
        };
    }

    /// <summary>Total number of upstream HTTP requests dispatched.</summary>
    public int UpstreamRequestCount { get; private set; }

    /// <summary>Number of times the API key was rotated on 429.</summary>
    public int RotationCount { get; private set; }

    public async Task<LlmCompletion> CompleteAsync(LlmCompletionRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (_apiKeys.Count == 0)
        {
            throw LlmException.NotConfigured("NOSTOS_MEASUREMENT_GEMINI_API_KEY");
        }

        var payload = BuildRequestBody(request);
        var json = payload.ToJsonString();

        var (statusCode, responseBody) = await SendWithRetryAsync(json, ct);

        return ParseResponse(statusCode, responseBody);
    }

    /// <summary>
    /// Recursively strips JSON Schema properties rejected by the Gemini API while preserving core validations.
    /// </summary>
    public static JsonNode SanitizeSchema(JsonNode schema)
    {
        ArgumentNullException.ThrowIfNull(schema);
        var clone = schema.DeepClone();
        SanitizeInPlace(clone);
        return clone;
    }

    public void Dispose() => _httpClient.Dispose();

    private static void SanitizeInPlace(JsonNode node)
    {
        if (node is JsonObject obj)
        {
            var keysToRemove = obj
                .Where(kvp => DisallowedSchemaProperties.Contains(kvp.Key))
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var key in keysToRemove)
            {
                obj.Remove(key);
            }

            foreach (var kvp in obj)
            {
                if (kvp.Value is not null)
                {
                    SanitizeInPlace(kvp.Value);
                }
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not null)
                {
                    SanitizeInPlace(item);
                }
            }
        }
    }

    private JsonObject BuildRequestBody(LlmCompletionRequest request)
    {
        var root = new JsonObject();

        var systemMessages = request.Messages
            .Where(m => string.Equals(m.Role, "system", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(m.Content))
            .ToList();

        if (systemMessages.Count > 0)
        {
            var parts = new JsonArray();
            foreach (var msg in systemMessages)
            {
                parts.Add(new JsonObject { ["text"] = msg.Content });
            }

            root["systemInstruction"] = new JsonObject { ["parts"] = parts };
        }

        var contents = BuildContents(request.Messages);
        root["contents"] = contents;

        if (request.Tools.Count > 0)
        {
            var functionDeclarations = new JsonArray();
            foreach (var tool in request.Tools)
            {
                JsonNode schemaNode;
                if (!string.IsNullOrWhiteSpace(tool.ParametersJsonSchema))
                {
                    try
                    {
                        schemaNode = JsonNode.Parse(tool.ParametersJsonSchema) ?? new JsonObject { ["type"] = "object" };
                    }
                    catch (JsonException)
                    {
                        schemaNode = new JsonObject { ["type"] = "object" };
                    }
                }
                else
                {
                    schemaNode = new JsonObject { ["type"] = "object" };
                }

                functionDeclarations.Add(new JsonObject
                {
                    ["name"] = tool.Name,
                    ["description"] = tool.Description,
                    ["parameters"] = SanitizeSchema(schemaNode)
                });
            }

            root["tools"] = new JsonArray
            {
                new JsonObject { ["functionDeclarations"] = functionDeclarations }
            };
        }

        root["generationConfig"] = new JsonObject
        {
            ["maxOutputTokens"] = request.MaxTokens,
            ["thinkingConfig"] = new JsonObject
            {
                ["thinkingLevel"] = _thinkingLevel
            }
        };

        return root;
    }

    private JsonArray BuildContents(IReadOnlyList<LlmMessage> messages)
    {
        var rawTurns = new List<(string Role, List<JsonObject> Parts)>();

        foreach (var msg in messages)
        {
            if (string.Equals(msg.Role, "system", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (string.Equals(msg.Role, "user", StringComparison.OrdinalIgnoreCase))
            {
                rawTurns.Add(("user", [new JsonObject { ["text"] = msg.Content ?? string.Empty }]));
            }
            else if (string.Equals(msg.Role, "assistant", StringComparison.OrdinalIgnoreCase))
            {
                var parts = new List<JsonObject>();
                if (msg.ToolCalls is { Count: > 0 })
                {
                    var roundKey = string.Join("|", msg.ToolCalls.Select(t => t.Id));
                    if (_rememberedRoundParts.TryGetValue(roundKey, out var remembered))
                    {
                        foreach (var node in remembered)
                        {
                            if (node is JsonObject partObj)
                            {
                                parts.Add(partObj.DeepClone().AsObject());
                            }
                        }
                    }
                    else
                    {
                        if (!string.IsNullOrWhiteSpace(msg.Content))
                        {
                            parts.Add(new JsonObject { ["text"] = msg.Content });
                        }

                        foreach (var call in msg.ToolCalls)
                        {
                            JsonNode argsNode;
                            try
                            {
                                argsNode = JsonNode.Parse(call.ArgumentsJson) ?? new JsonObject();
                            }
                            catch (JsonException)
                            {
                                argsNode = new JsonObject();
                            }

                            parts.Add(new JsonObject
                            {
                                ["functionCall"] = new JsonObject
                                {
                                    ["name"] = call.Name,
                                    ["id"] = call.Id,
                                    ["args"] = argsNode
                                }
                            });
                        }
                    }
                }
                else
                {
                    parts.Add(new JsonObject { ["text"] = msg.Content ?? string.Empty });
                }

                rawTurns.Add(("model", parts));
            }
            else if (string.Equals(msg.Role, "tool", StringComparison.OrdinalIgnoreCase))
            {
                var toolCallId = msg.ToolCallId ?? string.Empty;
                var functionName = _toolCallNames.TryGetValue(toolCallId, out var name) ? name : toolCallId;

                JsonNode responseNode;
                try
                {
                    var parsed = JsonNode.Parse(msg.Content ?? "{}");
                    if (parsed is JsonObject obj)
                    {
                        responseNode = obj;
                    }
                    else
                    {
                        responseNode = new JsonObject { ["result"] = msg.Content ?? string.Empty };
                    }
                }
                catch (JsonException)
                {
                    responseNode = new JsonObject { ["result"] = msg.Content ?? string.Empty };
                }

                var part = new JsonObject
                {
                    ["functionResponse"] = new JsonObject
                    {
                        ["name"] = functionName,
                        ["id"] = toolCallId,
                        ["response"] = responseNode
                    }
                };

                rawTurns.Add(("user", [part]));
            }
        }

        var contents = new JsonArray();
        JsonObject? currentContent = null;
        string? currentRole = null;

        foreach (var (role, parts) in rawTurns)
        {
            if (currentContent is not null && currentRole == role)
            {
                var existingParts = currentContent["parts"]!.AsArray();
                foreach (var p in parts)
                {
                    existingParts.Add(p);
                }
            }
            else
            {
                currentRole = role;
                var partsArray = new JsonArray();
                foreach (var p in parts)
                {
                    partsArray.Add(p);
                }

                currentContent = new JsonObject
                {
                    ["role"] = role,
                    ["parts"] = partsArray
                };
                contents.Add(currentContent);
            }
        }

        return contents;
    }

    /// <summary>Transport-level attempts per logical upstream call (rate limits / transient faults only).</summary>
    private const int MaxTransportAttempts = 6;

    private async Task<(int StatusCode, string ResponseBody)> SendWithRetryAsync(string requestJson, CancellationToken ct)
    {
        var attempt = 0;
        while (true)
        {
            attempt++;
            var key = _apiKeys[_keyIndex];
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{_model}:generateContent";

            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, url);
            httpRequest.Headers.Add("x-goog-api-key", key);
            httpRequest.Content = new StringContent(requestJson, Encoding.UTF8, "application/json");

            UpstreamRequestCount++;
            HttpResponseMessage response;
            try
            {
                response = await _httpClient.SendAsync(httpRequest, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                if (attempt >= MaxTransportAttempts)
                {
                    throw LlmException.ProviderFailure(ex.Message);
                }

                Console.WriteLine($"[Measurement provider] transport retry {attempt}/{MaxTransportAttempts} after {ex.GetType().Name}.");
                await DelayBeforeRetryAsync(attempt, null, ct);
                continue;
            }

            using (response)
            {
                var body = await response.Content.ReadAsStringAsync(ct);

                if (response.IsSuccessStatusCode)
                {
                    return ((int)response.StatusCode, body);
                }

                var status = (int)response.StatusCode;
                var (errorStatus, retryDelay) = ExtractErrorDetail(body);

                // Rate limiting and transient server faults are retried with backoff and
                // key rotation; a malformed-request 4xx is a defect and must surface at once.
                var retryable = status is 429 or 500 or 502 or 503 or 504;
                if (!retryable || attempt >= MaxTransportAttempts)
                {
                    var detail = string.IsNullOrWhiteSpace(errorStatus)
                        ? $"{status}"
                        : $"{status} {errorStatus}";

                    throw new LlmException(LlmErrorCodes.Provider, detail);
                }

                if (_apiKeys.Count > 1)
                {
                    _keyIndex = (_keyIndex + 1) % _apiKeys.Count;
                    RotationCount++;
                }

                Console.WriteLine(
                    $"[Measurement provider] transport retry {attempt}/{MaxTransportAttempts}: {status} {errorStatus}."
                    + (retryDelay.HasValue ? $" retryDelay={retryDelay.Value.TotalSeconds:0.#}s" : string.Empty));
                await DelayBeforeRetryAsync(attempt, retryDelay, ct);
            }
        }
    }

    private static async Task DelayBeforeRetryAsync(int attempt, TimeSpan? retryDelay, CancellationToken ct)
    {
        var exponentialMs = Math.Min(1000 * (1 << Math.Min(attempt, 5)), 20_000);
        var waitMs = retryDelay.HasValue
            ? Math.Min(retryDelay.Value.TotalMilliseconds + Random.Shared.Next(0, 750), 45_000)
            : exponentialMs + Random.Shared.Next(0, 750);

        await Task.Delay(TimeSpan.FromMilliseconds(waitMs), ct);
    }

    private static (string? Status, TimeSpan? RetryDelay) ExtractErrorDetail(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return (null, null);
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("error", out var errorObj))
            {
                return (null, null);
            }

            string? status = errorObj.TryGetProperty("status", out var statusProp) &&
                             statusProp.ValueKind == JsonValueKind.String
                ? statusProp.GetString()
                : null;

            string? quotaId = null;
            TimeSpan? retryDelay = null;

            if (errorObj.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Array)
            {
                foreach (var detail in details.EnumerateArray())
                {
                    if (retryDelay is null &&
                        detail.TryGetProperty("retryDelay", out var retryProp) &&
                        retryProp.ValueKind == JsonValueKind.String &&
                        TryParseRetryDelay(retryProp.GetString(), out var parsedDelay))
                    {
                        retryDelay = parsedDelay;
                    }

                    if (quotaId is null &&
                        detail.TryGetProperty("violations", out var violations) &&
                        violations.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var violation in violations.EnumerateArray())
                        {
                            if (violation.TryGetProperty("quotaId", out var quotaProp) &&
                                quotaProp.ValueKind == JsonValueKind.String)
                            {
                                quotaId = quotaProp.GetString();
                                break;
                            }
                        }
                    }
                }
            }

            var statusText = quotaId is { Length: > 0 } ? $"{status} quota={quotaId}" : status;
            return (statusText, retryDelay);
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    private static bool TryParseRetryDelay(string? raw, out TimeSpan delay)
    {
        delay = default;
        if (string.IsNullOrWhiteSpace(raw) || !raw.EndsWith('s'))
        {
            return false;
        }

        if (!double.TryParse(raw[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) || seconds < 0)
        {
            return false;
        }

        delay = TimeSpan.FromSeconds(seconds);
        return true;
    }

    private LlmCompletion ParseResponse(int statusCode, string body)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            throw new LlmException(LlmErrorCodes.InvalidResponse, $"{statusCode}");
        }

        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                throw new LlmException(LlmErrorCodes.InvalidResponse, $"{statusCode}");
            }

            var candidate = candidates[0];
            string? finishReason = candidate.TryGetProperty("finishReason", out var fr) && fr.ValueKind == JsonValueKind.String
                ? fr.GetString()
                : null;

            var toolCalls = new List<LlmToolCall>();
            var textParts = new List<string>();
            JsonArray? rawPartsForRound = null;

            if (candidate.TryGetProperty("content", out var content) &&
                content.TryGetProperty("parts", out var parts) &&
                parts.ValueKind == JsonValueKind.Array)
            {
                try
                {
                    rawPartsForRound = JsonNode.Parse(parts.GetRawText()) as JsonArray;
                }
                catch (JsonException)
                {
                }

                _roundCounter++;
                var partIndex = 0;
                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var textElem) && textElem.ValueKind == JsonValueKind.String)
                    {
                        var text = textElem.GetString();
                        if (!string.IsNullOrEmpty(text))
                        {
                            textParts.Add(text);
                        }
                    }

                    if (part.TryGetProperty("functionCall", out var fc) && fc.ValueKind == JsonValueKind.Object)
                    {
                        var name = fc.TryGetProperty("name", out var nameElem) ? nameElem.GetString() ?? string.Empty : string.Empty;
                        var id = fc.TryGetProperty("id", out var idElem) && idElem.ValueKind == JsonValueKind.String
                            ? idElem.GetString() ?? $"call_{_roundCounter}-{partIndex}"
                            : $"call_{_roundCounter}-{partIndex}";

                        var argsJson = fc.TryGetProperty("args", out var argsElem) && argsElem.ValueKind == JsonValueKind.Object
                            ? argsElem.GetRawText()
                            : "{}";

                        _toolCallNames[id] = name;
                        toolCalls.Add(new LlmToolCall(id, name, argsJson));
                    }

                    partIndex++;
                }
            }

            if (toolCalls.Count > 0 && rawPartsForRound is not null)
            {
                var roundKey = string.Join("|", toolCalls.Select(t => t.Id));
                _rememberedRoundParts[roundKey] = rawPartsForRound;
            }

            int? promptTokens = null;
            int? completionTokens = null;
            int? thinkingTokens = null;

            if (doc.RootElement.TryGetProperty("usageMetadata", out var usage) && usage.ValueKind == JsonValueKind.Object)
            {
                if (usage.TryGetProperty("promptTokenCount", out var pt) && pt.TryGetInt32(out var ptVal))
                {
                    promptTokens = ptVal;
                }

                if (usage.TryGetProperty("candidatesTokenCount", out var ct) && ct.TryGetInt32(out var ctVal))
                {
                    completionTokens = ctVal;
                }

                if (usage.TryGetProperty("thoughtsTokenCount", out var tt) && tt.TryGetInt32(out var ttVal))
                {
                    thinkingTokens = ttVal;
                }
            }

            var mergedContent = textParts.Count > 0 ? string.Join(string.Empty, textParts) : null;
            return new LlmCompletion(
                mergedContent,
                finishReason,
                toolCalls,
                promptTokens,
                completionTokens,
                thinkingTokens);
        }
    }
}
