using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Migrations;

public sealed record CloudSchemaMigrationResult(
    string? PreviousVersion,
    string CurrentVersion,
    bool AdoptedLegacyBaseline,
    IReadOnlyList<string> AppliedMigrations);

public sealed class CloudSchemaMigrationException(
    string failureCode,
    string message,
    Exception? innerException = null)
    : InvalidOperationException(message, innerException)
{
    public string FailureCode { get; } = failureCode;
}

public interface ICloudTenantSchemaMigrator
{
    Task<CloudSchemaMigrationResult> MigrateAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Migrates exactly one Cloud customer database.
///
/// It is intentionally not a hosted startup migrator: fleet rollout is
/// explicit/batched, while new-tenant provisioning invokes this service for
/// only the tenant being created.
/// </summary>
public sealed class CloudTenantSchemaMigrator(
    ICloudControlPlaneStore controlPlane,
    ICloudCustomerConnectionFactory customerConnections,
    ILogger<CloudTenantSchemaMigrator> logger)
    : ICloudTenantSchemaMigrator
{
    private static readonly HashSet<string> LegacyCurrentModelTables =
    [
        "AiProviderSettings",
        "AssistantSettings",
        "BackupRecords",
        "BookAcquisitions",
        "BookCollections",
        "Books",
        "Collections",
        "Concepts",
        "LibraryCommandReceipts",
        "LibraryStates",
        "NoteCommandReceipts",
        "NoteConcepts",
        "Notes",
        "Works",
        "Writings",
    ];

    public async Task<CloudSchemaMigrationResult> MigrateAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        var mapping = await controlPlane.FindAsync(accountId, cancellationToken)
            ?? throw new CloudSchemaMigrationException(
                "schema_account_not_provisioned",
                "The Cloud account has no resource mapping.");

        var previousVersion = mapping.SchemaVersion;

        try
        {
            await using var db = CreateContext(mapping.DatabaseName);

            if (!await db.Database.CanConnectAsync(cancellationToken))
            {
                throw new CloudSchemaMigrationException(
                    "schema_database_unreachable",
                    "The customer PostgreSQL database is not reachable.");
            }

            var knownMigrations = db.Database.GetMigrations().ToList();
            ValidateMigrationSet(knownMigrations);

            var creator = db.Database.GetService<IRelationalDatabaseCreator>();
            var hasTables = await creator.HasTablesAsync(cancellationToken);
            var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToList();

            var unknownApplied = applied
                .Except(knownMigrations, StringComparer.Ordinal)
                .ToList();
            if (unknownApplied.Count > 0)
            {
                throw new CloudSchemaMigrationException(
                    "schema_unknown_migration_history",
                    "The customer database contains migration ids unknown to this Nostos release.");
            }

            var adoptedLegacyBaseline = false;

            if (!hasTables)
            {
                // A versioned/ready tenant becoming an empty database is not a
                // fresh provision: silently rebuilding it would turn data loss
                // into an apparently healthy empty library.
                if (mapping.SchemaVersion is not null
                    || mapping.ProvisioningState == CloudProvisioningState.Ready)
                {
                    throw new CloudSchemaMigrationException(
                        "schema_missing_for_versioned_tenant",
                        "A versioned Cloud tenant database unexpectedly contains no schema.");
                }
            }
            else if (applied.Count == 0)
            {
                if (!string.Equals(
                    mapping.SchemaVersion,
                    CloudCustomerSchema.LegacyCurrentModelV1,
                    StringComparison.Ordinal))
                {
                    throw new CloudSchemaMigrationException(
                        "schema_unversioned_database",
                        "An existing customer database has tables but no recognized PostgreSQL migration history.");
                }

                await ValidateLegacyCurrentModelAsync(db, cancellationToken);
                await StampLegacyBaselineAsync(db, cancellationToken);
                adoptedLegacyBaseline = true;
            }

            await db.Database.MigrateAsync(cancellationToken);
            await EnsureLibraryStateAsync(db, cancellationToken);

            var pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
            if (pending.Count > 0)
            {
                throw new CloudSchemaMigrationException(
                    "schema_pending_after_migrate",
                    "PostgreSQL still reports pending migrations after the tenant migration completed.");
            }

            applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToList();
            if (applied.Count == 0
                || !string.Equals(
                    applied[^1],
                    CloudCustomerSchema.CurrentVersion,
                    StringComparison.Ordinal))
            {
                throw new CloudSchemaMigrationException(
                    "schema_version_mismatch",
                    "The customer database did not reach the expected Cloud schema version.");
            }

            await controlPlane.MarkSchemaVersionAsync(
                accountId,
                CloudCustomerSchema.CurrentVersion,
                cancellationToken);

            logger.LogInformation(
                "Cloud schema for account {AccountId} advanced from {PreviousVersion} to {CurrentVersion}. Legacy baseline adopted: {AdoptedLegacyBaseline}.",
                accountId,
                previousVersion ?? "<unversioned>",
                CloudCustomerSchema.CurrentVersion,
                adoptedLegacyBaseline);

            return new CloudSchemaMigrationResult(
                previousVersion,
                CloudCustomerSchema.CurrentVersion,
                adoptedLegacyBaseline,
                applied);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await MarkSchemaFailureBestEffortAsync(accountId, "schema_migration_cancelled");
            throw;
        }
        catch (CloudSchemaMigrationException exception)
        {
            await MarkSchemaFailureBestEffortAsync(accountId, exception.FailureCode);
            throw;
        }
        catch (Exception exception)
        {
            await MarkSchemaFailureBestEffortAsync(accountId, "schema_migration_failed");

            logger.LogError(
                exception,
                "Cloud schema migration failed for account {AccountId}.",
                accountId);

            throw new CloudSchemaMigrationException(
                "schema_migration_failed",
                "The Cloud tenant schema migration failed. The prior schema version remains recorded for recovery.",
                exception);
        }
    }

    private PostgresNostosDbContext CreateContext(string databaseName)
    {
        var options = new DbContextOptionsBuilder<PostgresNostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(databaseName))
            .Options;

        return new PostgresNostosDbContext(options);
    }

    private static void ValidateMigrationSet(IReadOnlyList<string> migrations)
    {
        if (migrations.Count < 2
            || !string.Equals(
                migrations[0],
                CloudCustomerSchema.BaselineMigrationId,
                StringComparison.Ordinal)
            || !string.Equals(
                migrations[^1],
                CloudCustomerSchema.CurrentVersion,
                StringComparison.Ordinal))
        {
            throw new CloudSchemaMigrationException(
                "schema_migration_set_mismatch",
                "The compiled PostgreSQL migration set does not match the Cloud schema constants.");
        }
    }

    private static async Task ValidateLegacyCurrentModelAsync(
        PostgresNostosDbContext db,
        CancellationToken cancellationToken)
    {
        var actualTables = new HashSet<string>(StringComparer.Ordinal);
        var actualColumns = new HashSet<string>(StringComparer.Ordinal);

        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        var openedHere = connection.State != System.Data.ConnectionState.Open;
        if (openedHere)
            await connection.OpenAsync(cancellationToken);

        try
        {
            await using (var tables = new NpgsqlCommand(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                  AND table_name <> '__EFMigrationsHistory'
                """,
                connection))
            await using (var reader = await tables.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    actualTables.Add(reader.GetString(0));
            }

            await using (var columns = new NpgsqlCommand(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name <> '__EFMigrationsHistory'
                """,
                connection))
            await using (var reader = await columns.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    actualColumns.Add($"{reader.GetString(0)}.{reader.GetString(1)}");
            }
        }
        finally
        {
            if (openedHere)
                await connection.CloseAsync();
        }

        if (!actualTables.SetEquals(LegacyCurrentModelTables))
        {
            throw new CloudSchemaMigrationException(
                "schema_legacy_shape_mismatch",
                "The unversioned Cloud database does not match the trusted #396 current-model-v1 table set.");
        }

        var expectedColumns = db.Model
            .GetRelationalModel()
            .Tables
            .Where(table => !string.Equals(
                table.Name,
                "__EFMigrationsHistory",
                StringComparison.Ordinal))
            .SelectMany(table => table.Columns.Select(column => $"{table.Name}.{column.Name}"))
            .ToHashSet(StringComparer.Ordinal);

        if (!actualColumns.SetEquals(expectedColumns))
        {
            throw new CloudSchemaMigrationException(
                "schema_legacy_shape_mismatch",
                "The unversioned Cloud database table names match #396, but its column shape does not.");
        }
    }

    private static async Task StampLegacyBaselineAsync(
        PostgresNostosDbContext db,
        CancellationToken cancellationToken)
    {
        var history = db.GetService<IHistoryRepository>();

        // Npgsql's history existence probe can be misleading on a database
        // produced by EnsureCreated (the #396 legacy shape). Use EF's own
        // idempotent history-table DDL instead of branching on that probe.
        await db.Database.ExecuteSqlRawAsync(
            history.GetCreateIfNotExistsScript(),
            cancellationToken);

        var insert = history.GetInsertScript(
            new HistoryRow(
                CloudCustomerSchema.BaselineMigrationId,
                ResolveEfProductVersion()));

        try
        {
            await db.Database.ExecuteSqlRawAsync(insert, cancellationToken);
        }
        catch (PostgresException exception)
            when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            // Another app instance may have adopted the same trusted legacy
            // tenant after our initial history read. The migration id is the
            // primary key, so a duplicate means the desired baseline is
            // already stamped; ordinary EF migration locking handles the rest.
        }
    }

    private static async Task EnsureLibraryStateAsync(
        PostgresNostosDbContext db,
        CancellationToken cancellationToken)
    {
        if (await db.LibraryStates.AnyAsync(cancellationToken))
            return;

        db.LibraryStates.Add(new LibraryState
        {
            Id = LibraryState.WellKnownId,
            SingletonSlot = LibraryState.SingletonSentinel,
        });

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task MarkSchemaFailureBestEffortAsync(
        NostosAccountId accountId,
        string failureCode)
    {
        try
        {
            await controlPlane.MarkSchemaFailureAsync(
                accountId,
                failureCode,
                CancellationToken.None);
        }
        catch (Exception statusException)
        {
            logger.LogError(
                statusException,
                "Could not persist Cloud schema failure state for account {AccountId}.",
                accountId);
        }
    }

    private static string ResolveEfProductVersion()
    {
        var informational = typeof(DbContext).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;

        if (!string.IsNullOrWhiteSpace(informational))
            return informational.Split('+')[0];

        return typeof(DbContext).Assembly.GetName().Version?.ToString(3) ?? "10.0.0";
    }
}
