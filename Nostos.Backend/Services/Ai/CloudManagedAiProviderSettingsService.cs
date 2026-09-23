using Nostos.Backend.Configuration;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Cloud owns provider identity, endpoint, model and credentials. Effective
/// values are server-only; every customer-facing provider-settings operation is
/// rejected.
/// </summary>
public sealed class CloudManagedAiProviderSettingsService(CloudManagedAiOptions options)
    : IAiProviderSettingsService
{
    public Task<EffectiveAiProviderConfig> GetEffectiveLlmAsync(CancellationToken ct = default) =>
        Task.FromResult(ToConfig(
            options.LlmEnabled,
            options.LlmBaseUrl,
            options.LlmModel,
            options.LlmApiKeyEnvironmentVariable));

    public Task<EffectiveAiProviderConfig> GetEffectiveSttAsync(CancellationToken ct = default) =>
        Task.FromResult(ToConfig(
            options.SttEnabled,
            options.SttBaseUrl,
            options.SttModel,
            options.SttApiKeyEnvironmentVariable));

    public Task<AiProviderSettingsResponse> GetAsync(CancellationToken ct = default) => throw Managed();

    public Task<AiProviderSettingsResponse> UpdateAsync(
        AiProviderSettingsUpdateRequest request,
        CancellationToken ct = default) => throw Managed();

    public Task<AiProviderModelsResponse> ListModelsAsync(
        AiProviderModelsRequest request,
        CancellationToken ct = default) => throw Managed();

    public Task<AiProviderTestResult> TestAsync(
        AiProviderTestRequest request,
        CancellationToken ct = default) => throw Managed();

    private static EffectiveAiProviderConfig ToConfig(
        bool enabled,
        string baseUrl,
        string model,
        string environmentVariable)
    {
        var raw = Environment.GetEnvironmentVariable(environmentVariable);
        var key = string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();

        return new EffectiveAiProviderConfig(
            enabled,
            baseUrl,
            model,
            environmentVariable,
            key,
            KeyFromServerEnv: key is not null);
    }

    private static AiProviderConfigurationManagedException Managed() =>
        new("AI provider configuration is managed by Nostos Cloud.");
}

public sealed class AiProviderConfigurationManagedException(string message) : Exception(message);
