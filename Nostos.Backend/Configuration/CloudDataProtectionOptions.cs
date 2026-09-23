namespace Nostos.Backend.Configuration;

/// <summary>
/// Cloud-only configuration for the persistent ASP.NET Data Protection key ring.
/// The actual wrapping key is injected through the named environment variable
/// and is never stored in appsettings or in the PostgreSQL key-ring table.
/// </summary>
public sealed class CloudDataProtectionOptions
{
    public const string SectionName = "CloudDataProtection";

    public string KeyEncryptionKeyEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_DATA_PROTECTION_KEY";

    public static CloudDataProtectionKeyMaterial Resolve(
        IConfiguration configuration,
        Func<string, string?>? environmentReader = null)
    {
        var options =
            configuration.GetSection(SectionName).Get<CloudDataProtectionOptions>()
            ?? new CloudDataProtectionOptions();

        options.KeyEncryptionKeyEnvironmentVariable =
            (options.KeyEncryptionKeyEnvironmentVariable ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(options.KeyEncryptionKeyEnvironmentVariable))
        {
            throw new InvalidOperationException(
                "'CloudDataProtection:KeyEncryptionKeyEnvironmentVariable' must name an environment variable.");
        }

        environmentReader ??= Environment.GetEnvironmentVariable;
        var encoded = environmentReader(options.KeyEncryptionKeyEnvironmentVariable);

        if (string.IsNullOrWhiteSpace(encoded))
        {
            throw new InvalidOperationException(
                $"Nostos Cloud requires environment variable '{options.KeyEncryptionKeyEnvironmentVariable}' to contain the Data Protection key-encryption key.");
        }

        byte[] key;
        try
        {
            key = Convert.FromBase64String(encoded.Trim());
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException(
                $"Environment variable '{options.KeyEncryptionKeyEnvironmentVariable}' must be base64-encoded.",
                exception);
        }

        if (key.Length != 32)
        {
            throw new InvalidOperationException(
                $"Environment variable '{options.KeyEncryptionKeyEnvironmentVariable}' must decode to exactly 32 bytes.");
        }

        return new CloudDataProtectionKeyMaterial(options, key);
    }
}

public sealed record CloudDataProtectionKeyMaterial(
    CloudDataProtectionOptions Options,
    byte[] Key);
