using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Provisioning;

public sealed record CloudProvisioningResult(
    CloudProvisioningState State,
    CloudAccountStatus AccountStatus,
    string? SchemaVersion,
    bool Ready,
    bool Retryable);

public interface ICloudCustomerDatabaseProvisioner
{
    Task<CloudProvisioningResult> ProvisionAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);
}

public sealed class CloudProvisioningException(
    string failureCode,
    string message,
    Exception? innerException = null)
    : InvalidOperationException(message, innerException)
{
    public string FailureCode { get; } = failureCode;
}

public sealed class CloudCustomerDatabaseProvisioner(
    ICloudControlPlaneStore controlPlane,
    CloudDatabaseConnections connections,
    ICloudCustomerConnectionFactory customerConnections,
    ILogger<CloudCustomerDatabaseProvisioner> logger)
    : ICloudCustomerDatabaseProvisioner
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> AccountGates = new();

    public async Task<CloudProvisioningResult> ProvisionAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        var gate = AccountGates.GetOrAdd(accountId.Value, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);

        try
        {
            var mapping = await controlPlane.GetOrCreateAsync(accountId, cancellationToken);
            if (mapping.AccountStatus is CloudAccountStatus.Disabled or CloudAccountStatus.Deleted)
            {
                throw new CloudProvisioningException(
                    "account_unavailable",
                    "The Nostos Cloud account is disabled or deleted and cannot be provisioned.");
            }

            if (mapping.IsReady)
                return Result(mapping);

            await controlPlane.MarkProvisioningAsync(accountId, cancellationToken);
            mapping = await controlPlane.FindAsync(accountId, cancellationToken)
                ?? throw new InvalidOperationException("Cloud account resource mapping disappeared during provisioning.");

            var stage = "database_create_failed";

            try
            {
                await EnsureCustomerDatabaseAsync(mapping.DatabaseName, cancellationToken);

                stage = "schema_initialize_failed";
                await EnsureCustomerSchemaAsync(mapping.DatabaseName, cancellationToken);

                stage = "database_verify_failed";
                await VerifyCustomerDatabaseAsync(mapping.DatabaseName, cancellationToken);

                await controlPlane.MarkReadyAsync(
                    accountId,
                    CloudCustomerSchema.CurrentVersion,
                    cancellationToken);

                var ready = await controlPlane.FindAsync(accountId, cancellationToken)
                    ?? throw new InvalidOperationException(
                        "Cloud account resource mapping disappeared after provisioning.");

                logger.LogInformation(
                    "Provisioned Nostos Cloud resources for account {AccountId} as resource {ResourceId}.",
                    accountId,
                    ready.ResourceId);

                return Result(ready);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                await MarkFailedBestEffortAsync(accountId, "provisioning_cancelled");
                throw;
            }
            catch (Exception exception)
            {
                await MarkFailedBestEffortAsync(accountId, stage);

                logger.LogError(
                    exception,
                    "Nostos Cloud provisioning failed for account {AccountId} at stage {Stage}.",
                    accountId,
                    stage);

                throw new CloudProvisioningException(
                    stage,
                    "Nostos Cloud could not provision the account resources. The same resource mapping can be retried safely.",
                    exception);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task EnsureCustomerDatabaseAsync(
        string databaseName,
        CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(connections.Admin);
        await connection.OpenAsync(cancellationToken);

        await using (var exists = new NpgsqlCommand(
            "SELECT 1 FROM pg_database WHERE datname = @databaseName",
            connection))
        {
            exists.Parameters.AddWithValue("databaseName", databaseName);
            if (await exists.ExecuteScalarAsync(cancellationToken) is not null)
            {
                await HardenDatabaseAccessAsync(connection, databaseName, cancellationToken);
                return;
            }
        }

        var quotedDatabase = QuoteIdentifier(databaseName);
        var quotedRole = QuoteIdentifier(customerConnections.ApplicationRole);

        try
        {
            await using var create = new NpgsqlCommand(
                $"CREATE DATABASE {quotedDatabase} OWNER {quotedRole}",
                connection);
            await create.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (PostgresException exception) when (exception.SqlState == "42P04")
        {
            // A second app instance may have won the same deterministic create.
            // Continue with the already-created database.
        }

        await HardenDatabaseAccessAsync(connection, databaseName, cancellationToken);
    }

    private async Task HardenDatabaseAccessAsync(
        NpgsqlConnection adminConnection,
        string databaseName,
        CancellationToken cancellationToken)
    {
        var quotedDatabase = QuoteIdentifier(databaseName);
        var quotedRole = QuoteIdentifier(customerConnections.ApplicationRole);

        await using var command = new NpgsqlCommand(
            $"REVOKE CONNECT ON DATABASE {quotedDatabase} FROM PUBLIC; " +
            $"GRANT CONNECT ON DATABASE {quotedDatabase} TO {quotedRole};",
            adminConnection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task EnsureCustomerSchemaAsync(
        string databaseName,
        CancellationToken cancellationToken)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(databaseName))
            .Options;

        await using var db = new NostosDbContext(options);

        // #398 replaces this temporary current-model bootstrap with the
        // permanent PostgreSQL baseline/migration lifecycle. For #396, this
        // creates the exact model already proven by the PostgreSQL spike.
        await db.Database.EnsureCreatedAsync(cancellationToken);

        if (!await db.LibraryStates.AnyAsync(cancellationToken))
        {
            db.LibraryStates.Add(new LibraryState
            {
                Id = LibraryState.WellKnownId,
                SingletonSlot = LibraryState.SingletonSentinel,
            });
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task VerifyCustomerDatabaseAsync(
        string databaseName,
        CancellationToken cancellationToken)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(databaseName))
            .Options;

        await using var db = new NostosDbContext(options);

        if (!await db.Database.CanConnectAsync(cancellationToken))
            throw new InvalidOperationException("Provisioned customer database is not reachable.");

        var stateCount = await db.LibraryStates
            .AsNoTracking()
            .CountAsync(cancellationToken);

        if (stateCount != 1)
        {
            throw new InvalidOperationException(
                $"Provisioned customer database has {stateCount} LibraryState rows; expected exactly one.");
        }
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private async Task MarkFailedBestEffortAsync(NostosAccountId accountId, string failureCode)
    {
        try
        {
            await controlPlane.MarkFailedAsync(accountId, failureCode, CancellationToken.None);
        }
        catch (Exception statusException)
        {
            logger.LogError(
                statusException,
                "Could not persist provisioning failure state for account {AccountId}.",
                accountId);
        }
    }

    private static CloudProvisioningResult Result(CloudAccountResourceSnapshot mapping) =>
        new(
            mapping.ProvisioningState,
            mapping.AccountStatus,
            mapping.SchemaVersion,
            mapping.IsReady,
            Retryable: mapping.ProvisioningState != CloudProvisioningState.Ready);
}
