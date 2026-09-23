using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Npgsql;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Cloud.Runtime;

public static class CloudWorkerLeaseNames
{
    public const string ScheduledBackup = "nostos:scheduled-backup:v1";
    public const string PaddleReconciliation = "nostos:paddle-reconciliation:v1";
}

public interface ICloudWorkerLeaseManager
{
    Task<IAsyncDisposable?> TryAcquireAsync(
        string leaseName,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// A session-scoped PostgreSQL advisory lock. The dedicated connection stays
/// open only while the fleet-wide pass owns the lease; connection loss releases
/// the lock automatically.
/// </summary>
public sealed class PostgresCloudWorkerLeaseManager(
    CloudDatabaseConnections connections,
    ILogger<PostgresCloudWorkerLeaseManager> logger) : ICloudWorkerLeaseManager
{
    public async Task<IAsyncDisposable?> TryAcquireAsync(
        string leaseName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(leaseName);
        var key = LeaseKey(leaseName);
        var connection = new NpgsqlConnection(connections.ControlPlane);

        try
        {
            await connection.OpenAsync(cancellationToken);

            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT pg_try_advisory_lock(@key);";
            command.Parameters.AddWithValue("key", key);

            var acquired = (bool?)await command.ExecuteScalarAsync(cancellationToken) == true;
            if (!acquired)
            {
                await connection.DisposeAsync();
                return null;
            }

            return new Lease(connection, key, logger);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    internal static long LeaseKey(string leaseName)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(leaseName));
        return BinaryPrimitives.ReadInt64BigEndian(hash);
    }

    private sealed class Lease(
        NpgsqlConnection connection,
        long key,
        ILogger logger) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                if (connection.State == System.Data.ConnectionState.Open)
                {
                    await using var command = connection.CreateCommand();
                    command.CommandText = "SELECT pg_advisory_unlock(@key);";
                    command.Parameters.AddWithValue("key", key);
                    await command.ExecuteScalarAsync();
                }
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception,
                    "Could not explicitly release a Cloud worker lease; closing the PostgreSQL session will release it.");
            }
            finally
            {
                await connection.DisposeAsync();
            }
        }
    }
}
