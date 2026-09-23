namespace Nostos.Product.Services.Ai;

public sealed record AiProviderOption(
    string Id,
    string DisplayName,
    bool RequiresApiKey,
    bool SupportsModelSelection,
    IReadOnlyList<string> RecommendedModels);

public sealed record AiProviderConfigDto(
    string ProviderId,
    string? BaseUrl,
    string? Model,
    bool HasApiKeyConfigured);

public sealed record AiProviderSettingsSummary(
    string ActiveProviderId,
    string ActiveModel,
    bool ActiveProviderConfigured,
    IReadOnlyList<AiProviderOption> Providers,
    IReadOnlyList<AiProviderConfigDto> Configurations);

public sealed record ConfigureAiProviderCommand(
    string ProviderId,
    string? ApiKey,
    string? BaseUrl,
    string? Model,
    bool SetAsActive);

public sealed record SetActiveAiProviderCommand(
    string ProviderId,
    string? Model);

public sealed record TestAiProviderCommand(
    string ProviderId,
    string? ApiKey,
    string? BaseUrl,
    string? Model);

public sealed record AiProviderTestResult(
    bool Success,
    string Message,
    int? LatencyMs);

public interface IAiProviderSettingsService
{
    Task<AiProviderSettingsSummary> GetSummaryAsync(CancellationToken cancellationToken = default);
    Task<AiProviderSettingsSummary> ConfigureProviderAsync(ConfigureAiProviderCommand command, CancellationToken cancellationToken = default);
    Task<AiProviderSettingsSummary> SetActiveProviderAsync(SetActiveAiProviderCommand command, CancellationToken cancellationToken = default);
    Task<AiProviderTestResult> TestProviderAsync(TestAiProviderCommand command, CancellationToken cancellationToken = default);
}

/// <summary>
/// A host owns provider identity/configuration and therefore refuses customer
/// configuration changes. The product maps this to the stable 403 contract.
/// </summary>
public sealed class AiProviderConfigurationManagedException(string message) : Exception(message);

/// <summary>
/// A host owns provider identity/configuration and therefore refuses customer
/// configuration changes. The product maps this to the stable 403 contract.
/// </summary>
public sealed class AiProviderConfigurationOwnedByHostException(string message) : Exception(message);
