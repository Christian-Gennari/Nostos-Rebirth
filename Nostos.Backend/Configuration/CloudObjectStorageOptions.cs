namespace Nostos.Backend.Configuration;

public sealed class CloudObjectStorageOptions
{
    public const string SectionName = "CloudObjectStorage";

    public string Bucket { get; set; } = string.Empty;
    public string Region { get; set; } = "auto";
    public string? ServiceUrl { get; set; }
    public bool ForcePathStyle { get; set; } = true;

    public string AccessKeyEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_OBJECT_STORAGE_ACCESS_KEY";

    public string SecretKeyEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_OBJECT_STORAGE_SECRET_KEY";

    public static CloudObjectStorageOptions FromConfiguration(IConfiguration configuration)
    {
        var options =
            configuration.GetSection(SectionName).Get<CloudObjectStorageOptions>()
            ?? new CloudObjectStorageOptions();

        options.Bucket = (options.Bucket ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(options.Bucket))
            throw new InvalidOperationException("Cloud object storage requires 'CloudObjectStorage:Bucket'.");

        options.Region = string.IsNullOrWhiteSpace(options.Region)
            ? "auto"
            : options.Region.Trim();

        if (!string.IsNullOrWhiteSpace(options.ServiceUrl))
        {
            if (!Uri.TryCreate(options.ServiceUrl.Trim(), UriKind.Absolute, out var endpoint)
                || endpoint.Scheme is not ("http" or "https"))
            {
                throw new InvalidOperationException(
                    "'CloudObjectStorage:ServiceUrl' must be an absolute HTTP(S) URL when configured.");
            }

            options.ServiceUrl = endpoint.AbsoluteUri.TrimEnd('/');
        }
        else
        {
            options.ServiceUrl = null;
        }

        options.AccessKeyEnvironmentVariable =
            RequireEnvironmentVariableName(
                options.AccessKeyEnvironmentVariable,
                nameof(AccessKeyEnvironmentVariable));

        options.SecretKeyEnvironmentVariable =
            RequireEnvironmentVariableName(
                options.SecretKeyEnvironmentVariable,
                nameof(SecretKeyEnvironmentVariable));

        return options;
    }

    public CloudObjectStorageCredentials ResolveCredentials(
        Func<string, string?>? environmentReader = null)
    {
        environmentReader ??= Environment.GetEnvironmentVariable;

        var accessKey = environmentReader(AccessKeyEnvironmentVariable);
        var secretKey = environmentReader(SecretKeyEnvironmentVariable);

        if (string.IsNullOrWhiteSpace(accessKey))
        {
            throw new InvalidOperationException(
                $"Cloud object storage requires environment variable '{AccessKeyEnvironmentVariable}'.");
        }

        if (string.IsNullOrWhiteSpace(secretKey))
        {
            throw new InvalidOperationException(
                $"Cloud object storage requires environment variable '{SecretKeyEnvironmentVariable}'.");
        }

        return new CloudObjectStorageCredentials(accessKey.Trim(), secretKey.Trim());
    }

    private static string RequireEnvironmentVariableName(string? value, string settingName)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            throw new InvalidOperationException(
                $"'CloudObjectStorage:{settingName}' must name an environment variable.");
        }

        return trimmed;
    }
}

public sealed record CloudObjectStorageCredentials(
    string AccessKey,
    string SecretKey);
