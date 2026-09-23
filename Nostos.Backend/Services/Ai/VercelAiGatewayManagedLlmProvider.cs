using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Nostos-managed Cloud LLM transport through Vercel AI Gateway's
/// OpenAI-compatible chat-completions API. The application continues to depend
/// only on <see cref="ILlmProvider"/>; Vercel is an operator transport boundary,
/// not a domain dependency.
/// </summary>
public sealed class VercelAiGatewayManagedLlmProvider(
    IHttpClientFactory httpClientFactory,
    IAiProviderConfigResolver config,
    CloudManagedAiOptions options,
    ILogger<VercelAiGatewayManagedLlmProvider> logger) : ILlmProvider
{
    public const string HttpClientName = "assistant-vercel-ai-gateway-managed";

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
            // Keep operator secret names and upstream coordinates out of the
            // customer-facing failure path.
            throw new LlmException(
                LlmErrorCodes.NotConfigured,
                "Ask Nostos managed AI is unavailable.");
        }

        var body = OpenAiCompatibleChatCompletions.BuildRequestBody(
            request,
            effective.Model,
            reasoningEffort: options.LlmThinkingLevel);

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            OpenAiCompatibleChatCompletions.BuildUri(effective.BaseUrl))
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", effective.ApiKey.Trim());

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

            var responseBody = await response.Content.ReadAsStringAsync(ct);
            var completion = OpenAiCompatibleChatCompletions.ParseResponse(responseBody);

            logger.LogDebug(
                "Managed AI Gateway completion with model {Model}: finish {FinishReason}, {ToolCalls} tool call(s).",
                effective.Model,
                completion.FinishReason ?? "(none)",
                completion.ToolCalls.Count);

            return completion;
        }
    }
}
