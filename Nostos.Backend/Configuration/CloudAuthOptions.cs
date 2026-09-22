namespace Nostos.Backend.Configuration;

public sealed class CloudAuthOptions
{
    public const string SectionName = "CloudAuth";

    public string Authority { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string Audience { get; set; } = string.Empty;
    public string ClientSecretEnvironmentVariable { get; set; } = "NOSTOS_CLOUD_AUTH_CLIENT_SECRET";
    public int SessionHours { get; set; } = 8;

    public static CloudAuthOptions FromConfiguration(IConfiguration configuration)
    {
        var options = configuration.GetSection(SectionName).Get<CloudAuthOptions>() ?? new CloudAuthOptions();

        if (!Uri.TryCreate(options.Authority, UriKind.Absolute, out var authority)
            || !string.Equals(authority.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Cloud authentication requires 'CloudAuth:Authority' to be an absolute HTTPS OpenID Connect issuer URL.");
        }

        options.Authority = authority.AbsoluteUri.TrimEnd('/');

        if (string.IsNullOrWhiteSpace(options.ClientId))
            throw new InvalidOperationException("Cloud authentication requires 'CloudAuth:ClientId'.");

        options.ClientId = options.ClientId.Trim();

        if (string.IsNullOrWhiteSpace(options.Audience))
            options.Audience = options.ClientId;
        else
            options.Audience = options.Audience.Trim();

        if (string.IsNullOrWhiteSpace(options.ClientSecretEnvironmentVariable))
        {
            throw new InvalidOperationException(
                "Cloud authentication requires 'CloudAuth:ClientSecretEnvironmentVariable' to name the environment variable containing the OIDC client secret.");
        }

        options.ClientSecretEnvironmentVariable = options.ClientSecretEnvironmentVariable.Trim();

        if (options.SessionHours is < 1 or > 168)
            throw new InvalidOperationException("'CloudAuth:SessionHours' must be between 1 and 168.");

        return options;
    }
}
