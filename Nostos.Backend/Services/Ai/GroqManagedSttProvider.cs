using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Cloud-managed Groq transcription using the direct OpenAI-compatible audio
/// endpoint. The permanent credential remains server-side and each call is
/// attempted once with no hidden fallback.
/// </summary>
public sealed class GroqManagedSttProvider(
    IHttpClientFactory httpClientFactory,
    SpeechOptions speechOptions,
    IAiProviderConfigResolver config,
    ILogger<GroqManagedSttProvider> logger) : ISTtProvider
{
    public const string HttpClientName = "stt-groq-managed";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<SttResult> TranscribeAsync(
        Stream audio,
        string fileName,
        string? contentType,
        string? languageHint,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(audio);

        var effective = await config.GetEffectiveSttAsync(ct);
        if (!effective.Enabled)
            throw SttException.Disabled();
        if (string.IsNullOrWhiteSpace(effective.ApiKey)
            || string.IsNullOrWhiteSpace(effective.BaseUrl)
            || string.IsNullOrWhiteSpace(effective.Model))
        {
            throw new SttException(
                SttErrorCodes.NotConfigured,
                "Voice transcription is temporarily unavailable.");
        }

        using var form = new MultipartFormDataContent();
        var fileContent = new StreamContent(audio);

        if (!string.IsNullOrWhiteSpace(contentType))
        {
            if (!MediaTypeHeaderValue.TryParse(contentType, out var parsed))
                throw SttException.UnsupportedFormat(contentType);
            fileContent.Headers.ContentType = parsed;
        }

        form.Add(fileContent, "file", string.IsNullOrWhiteSpace(fileName) ? "audio" : fileName);
        form.Add(new StringContent(effective.Model), "model");
        form.Add(new StringContent("verbose_json"), "response_format");
        if (!string.IsNullOrWhiteSpace(languageHint))
            form.Add(new StringContent(languageHint), "language");

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"{effective.BaseUrl.TrimEnd('/')}/v1/audio/transcriptions"))
        {
            Content = form,
        };
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", effective.ApiKey.Trim());

        var client = httpClientFactory.CreateClient(HttpClientName);
        HttpResponseMessage response;

        try
        {
            response = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            throw SttException.TimedOut();
        }
        catch (HttpRequestException)
        {
            throw SttException.ProviderFailure(
                "the managed transcription service could not be reached.");
        }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw SttException.PermissionDenied();
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw SttException.RateLimited();
            if (response.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.GatewayTimeout)
                throw SttException.TimedOut();
            if (response.StatusCode == HttpStatusCode.RequestEntityTooLarge)
                throw SttException.TooLarge(speechOptions.MaxUploadBytes);
            if (response.StatusCode == HttpStatusCode.UnsupportedMediaType)
                throw SttException.UnsupportedFormat(contentType);
            if (!response.IsSuccessStatusCode)
            {
                throw SttException.ProviderFailure(
                    $"the managed transcription service returned HTTP {(int)response.StatusCode}.");
            }

            var body = await response.Content.ReadAsStringAsync(ct);
            VerboseTranscript? transcript;

            try
            {
                transcript = JsonSerializer.Deserialize<VerboseTranscript>(body, JsonOptions);
            }
            catch (JsonException)
            {
                throw SttException.InvalidResponse(
                    "the managed transcription service returned unreadable JSON.");
            }

            if (transcript is null)
                throw SttException.InvalidResponse(
                    "the managed transcription service returned an empty response.");

            var result = new SttResult(
                (transcript.Text ?? string.Empty).Trim(),
                transcript.Language,
                transcript.Duration);

            logger.LogDebug(
                "Managed Groq transcription with model {Model}: language {Language}, duration {Duration}s.",
                effective.Model,
                result.Language,
                result.DurationSeconds);

            return result;
        }
    }

    private sealed record VerboseTranscript(
        [property: JsonPropertyName("text")] string? Text,
        [property: JsonPropertyName("language")] string? Language,
        [property: JsonPropertyName("duration")] double? Duration);
}
