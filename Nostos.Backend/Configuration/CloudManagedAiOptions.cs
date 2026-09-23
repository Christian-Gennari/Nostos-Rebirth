namespace Nostos.Backend.Configuration;

/// <summary>
/// Operator-owned Nostos Cloud AI configuration. Customer requests never supply
/// any of these values; they are resolved server-side and can change without a
/// frontend release.
/// </summary>
public sealed class CloudManagedAiOptions
{
    public const string SectionName = "CloudManagedAi";

    public bool LlmEnabled { get; set; } = true;
    public string LlmBaseUrl { get; set; } = "https://ai-gateway.vercel.sh/v1";
    public string LlmModel { get; set; } = "google/gemini-3.8-flash";
    public string LlmThinkingLevel { get; set; } = "low";
    public string LlmApiKeyEnvironmentVariable { get; set; } = "NOSTOS_CLOUD_AI_GATEWAY_API_KEY";
    public int LlmRequestTimeoutSeconds { get; set; } = 90;

    public bool SttEnabled { get; set; } = true;
    public string SttBaseUrl { get; set; } = "https://api.groq.com/openai";
    public string SttModel { get; set; } = "whisper-large-v3-turbo";
    public string SttApiKeyEnvironmentVariable { get; set; } = "NOSTOS_CLOUD_GROQ_API_KEY";
    public int SttRequestTimeoutSeconds { get; set; } = 300;

    public void Validate()
    {
        ValidateHttpsUrl(LlmBaseUrl, nameof(LlmBaseUrl));
        ValidateHttpsUrl(SttBaseUrl, nameof(SttBaseUrl));
        Require(LlmModel, nameof(LlmModel));
        Require(SttModel, nameof(SttModel));
        Require(LlmApiKeyEnvironmentVariable, nameof(LlmApiKeyEnvironmentVariable));
        Require(SttApiKeyEnvironmentVariable, nameof(SttApiKeyEnvironmentVariable));

        var thinking = LlmThinkingLevel.Trim().ToLowerInvariant();
        if (thinking is not ("low" or "medium" or "high"))
        {
            throw new InvalidOperationException(
                $"{SectionName}:{nameof(LlmThinkingLevel)} must be low, medium, or high.");
        }

        LlmThinkingLevel = thinking;

        if (LlmRequestTimeoutSeconds <= 0 || SttRequestTimeoutSeconds <= 0)
        {
            throw new InvalidOperationException(
                $"{SectionName} provider timeouts must be greater than zero.");
        }
    }

    private static void ValidateHttpsUrl(string value, string name)
    {
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new InvalidOperationException(
                $"{SectionName}:{name} must be an absolute https:// URL.");
        }
    }

    private static void Require(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"{SectionName}:{name} must not be empty.");
    }
}
