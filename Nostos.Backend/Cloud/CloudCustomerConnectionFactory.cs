using Npgsql;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Cloud;

public interface ICloudCustomerConnectionFactory
{
    string ForDatabase(string databaseName);
    string ApplicationRole { get; }
}

public sealed class CloudCustomerConnectionFactory(
    CloudDatabaseConnections connections,
    CloudControlPlaneOptions? options = null)
    : ICloudCustomerConnectionFactory
{
    private readonly NpgsqlConnectionStringBuilder _base =
        new(connections.CustomerBase);

    private readonly int _customerMaxPoolSize =
        options?.CustomerMaxPoolSize ?? 5;

    public string ApplicationRole =>
        _base.Username
        ?? throw new InvalidOperationException("Cloud customer PostgreSQL connection must include Username.");

    public string ForDatabase(string databaseName)
    {
        if (string.IsNullOrWhiteSpace(databaseName))
            throw new ArgumentException("Customer database name is required.", nameof(databaseName));

        var builder = new NpgsqlConnectionStringBuilder(_base.ConnectionString)
        {
            Database = databaseName,
            MinPoolSize = 0,
            MaxPoolSize = _customerMaxPoolSize,
        };

        if (string.IsNullOrWhiteSpace(builder.ApplicationName))
            builder.ApplicationName = "Nostos Cloud";

        return builder.ConnectionString;
    }
}
