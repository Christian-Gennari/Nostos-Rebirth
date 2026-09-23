using System.Text.Json.Serialization;

namespace Nostos.Backend.Services.Ai;

/// <summary>
/// Host-supplied AI provider settings surface. A local host can store BYOK
/// settings; another host can supply its own provider configuration. Product
/// endpoints depend only on this contract.
/// </summary>
public interface IAiProviderSettingsService : IAiProviderConfigResolver
{
    Task<AiProviderSettingsResponse> GetAsync(CancellationToken ct = default);

    Task<AiProviderSettingsResponse> UpdateAsync(
        AiProviderSettingsUpdateRequest request,
        CancellationToken ct = default);

    Task<AiProviderModelsResponse> ListModelsAsync(
        AiProviderModelsRequest request,
        CancellationToken ct = default);

    Task<AiProviderTestResult> TestAsync(
        AiProviderTestRequest request,
        CancellationToken ct = default);
}

public sealed record AiProviderSectionDto(
    bool Enabled,
    string BaseUrl,
    string Model,
    bool HasKey,
    bool KeyFromServerEnv);

public sealed record AiProviderSettingsResponse(
    AiProviderSectionDto Llm,
    AiProviderSectionDto Stt);

public sealed record AiProviderSectionUpdate(
    bool? Enabled,
    string? BaseUrl,
    string? Model,
    string? ApiKey);

public sealed record AiProviderSettingsUpdateRequest(
    AiProviderSectionUpdate? Llm,
    AiProviderSectionUpdate? Stt);

public sealed record AiProviderModelsRequest(
    string Kind,
    string? BaseUrl,
    string? ApiKey);

public sealed record AiProviderModelsResponse(IReadOnlyList<string> Models);

public sealed record AiProviderTestRequest(
    string Kind,
    string? BaseUrl,
    string? Model,
    string? ApiKey);

public sealed record AiProviderTestResult(
    bool Ok,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Detail,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Error);

/// <summary>
/// A host owns provider identity/configuration and therefore refuses customer
/// configuration changes. The product maps this to the stable 403 contract.
/// </summary>
public sealed class AiProviderConfigurationOwnedByHostException(string message) : Exception(message);
