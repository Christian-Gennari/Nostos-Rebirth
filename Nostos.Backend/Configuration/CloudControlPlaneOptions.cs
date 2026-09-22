using System.Text.RegularExpressions;
using Npgsql;

namespace Nostos.Backend.Configuration;

/// <summary>
/// Operator-owned configuration for the Nostos Cloud control plane and
/// customer PostgreSQL fleet.
///
/// Connection strings themselves are never stored in appsettings; only the
/// environment-variable names are configured here.
/// </summary>
public sealed class CloudControlPlaneOptions
{
    public const string SectionName = "CloudControlPlane";

    private static readonly Regex DatabasePrefixPattern =
        new("^[a-z][a-z0-9_]{0,19}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public string ControlPlaneConnectionStringEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION";

    public string PostgresAdminConnectionStringEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION";

    public string CustomerConnectionStringEnvironmentVariable { get; set; } =
        "NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION";

    public string CustomerDatabasePrefix { get; set; } = "nostos_u";

    public string StorageNamespacePrefix { get; set; } = "accounts";

    public static CloudControlPlaneOptions FromConfiguration(IConfiguration configuration)
    {
        var options =
            configuration.GetSection(SectionName).Get<CloudControlPlaneOptions>()
            ?? new CloudControlPlaneOptions();

        options.ControlPlaneConnectionStringEnvironmentVariable =
            RequireEnvironmentVariableName(
                options.ControlPlaneConnectionStringEnvironmentVariable,
                "ControlPlaneConnectionStringEnvironmentVariable");

        options.PostgresAdminConnectionStringEnvironmentVariable =
            RequireEnvironmentVariableName(
                options.PostgresAdminConnectionStringEnvironmentVariable,
                "PostgresAdminConnectionStringEnvironmentVariable");

        options.CustomerConnectionStringEnvironmentVariable =
            RequireEnvironmentVariableName(
                options.CustomerConnectionStringEnvironmentVariable,
                "CustomerConnectionStringEnvironmentVariable");

        options.CustomerDatabasePrefix = (options.CustomerDatabasePrefix ?? string.Empty).Trim();
        if (!DatabasePrefixPattern.IsMatch(options.CustomerDatabasePrefix))
        {
            throw new InvalidOperationException(
                "'CloudControlPlane:CustomerDatabasePrefix' must start with a lowercase letter, " +
                "contain only lowercase letters/digits/underscores, and be at most 20 characters.");
        }

        options.StorageNamespacePrefix = (options.StorageNamespacePrefix ?? string.Empty)
            .Trim()
            .Trim('/');
        if (options.StorageNamespacePrefix.Length is < 1 or > 40
            || options.StorageNamespacePrefix.Any(c =>
                !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '/')))
        {
            throw new InvalidOperationException(
                "'CloudControlPlane:StorageNamespacePrefix' must be 1-40 characters using letters, digits, '-', '_' or '/'.");
        }

        return options;
    }

    public CloudDatabaseConnections ResolveConnections(Func<string, string?>? environmentReader = null)
    {
        environmentReader ??= Environment.GetEnvironmentVariable;

        var controlPlane = RequireConnectionString(
            environmentReader(ControlPlaneConnectionStringEnvironmentVariable),
            ControlPlaneConnectionStringEnvironmentVariable,
            requireDatabase: true);

        var admin = RequireConnectionString(
            environmentReader(PostgresAdminConnectionStringEnvironmentVariable),
            PostgresAdminConnectionStringEnvironmentVariable,
            requireDatabase: true);

        var customer = RequireConnectionString(
            environmentReader(CustomerConnectionStringEnvironmentVariable),
            CustomerConnectionStringEnvironmentVariable,
            requireDatabase: false);

        return new CloudDatabaseConnections(controlPlane, admin, customer);
    }

    public string DatabaseName(Guid resourceId) =>
        $"{CustomerDatabasePrefix}_{resourceId:N}";

    public string StorageNamespace(Guid resourceId) =>
        $"{StorageNamespacePrefix}/{resourceId:N}";

    private static string RequireEnvironmentVariableName(string? value, string settingName)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            throw new InvalidOperationException(
                $"'CloudControlPlane:{settingName}' must name an environment variable.");
        }

        return trimmed;
    }

    private static string RequireConnectionString(
        string? value,
        string environmentVariable,
        bool requireDatabase)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"Nostos Cloud requires environment variable '{environmentVariable}' to contain a PostgreSQL connection string.");
        }

        NpgsqlConnectionStringBuilder parsed;
        try
        {
            parsed = new NpgsqlConnectionStringBuilder(value.Trim());
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                $"Environment variable '{environmentVariable}' does not contain a valid PostgreSQL connection string.",
                exception);
        }

        if (string.IsNullOrWhiteSpace(parsed.Host) || string.IsNullOrWhiteSpace(parsed.Username))
        {
            throw new InvalidOperationException(
                $"Environment variable '{environmentVariable}' must include PostgreSQL Host and Username.");
        }

        if (requireDatabase && string.IsNullOrWhiteSpace(parsed.Database))
        {
            throw new InvalidOperationException(
                $"Environment variable '{environmentVariable}' must include a PostgreSQL Database.");
        }

        return parsed.ConnectionString;
    }
}

public sealed record CloudDatabaseConnections(
    string ControlPlane,
    string Admin,
    string CustomerBase);
