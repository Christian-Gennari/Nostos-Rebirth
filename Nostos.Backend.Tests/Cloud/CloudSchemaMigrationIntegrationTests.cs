using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Migrations;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudSchemaMigrationIntegrationTests
{
    private const string ConnectionEnvironmentVariable = "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudMigrations")]
    public async Task Fresh_customer_database_migrates_to_current_schema()
    {
        var root = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(root))
            return;

        var databaseName = $"nostos_mig_fresh_{Guid.NewGuid():N}"[..31];
        await CreateDatabaseAsync(root, databaseName);

        try
        {
            var accountId = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                databaseName);
            var store = new MutableControlPlaneStore(Snapshot(
                accountId,
                databaseName,
                CloudProvisioningState.Provisioning,
                CloudAccountStatus.Unknown,
                schemaVersion: null));
            var connections = CustomerConnections(root);
            var migrator = CreateMigrator(store, connections);

            var result = await migrator.MigrateAsync(accountId);

            result.PreviousVersion.Should().BeNull();
            result.CurrentVersion.Should().Be(CloudCustomerSchema.CurrentVersion);
            result.AdoptedLegacyBaseline.Should().BeFalse();
            result.AppliedMigrations.Should().Equal(
                CloudCustomerSchema.BaselineMigrationId,
                CloudCustomerSchema.CurrentVersion);

            store.Current.SchemaVersion.Should().Be(CloudCustomerSchema.CurrentVersion);
            store.Current.FailureCode.Should().BeNull();

            await using var db = PostgresContext(connections, databaseName);
            (await db.Database.GetPendingMigrationsAsync()).Should().BeEmpty();
            (await db.Database.GetAppliedMigrationsAsync()).Should().Equal(
                CloudCustomerSchema.BaselineMigrationId,
                CloudCustomerSchema.CurrentVersion);
            (await db.LibraryStates.CountAsync()).Should().Be(1);
        }
        finally
        {
            await DropDatabaseIfExistsAsync(root, databaseName);
        }
    }

    [Fact]
    [Trait("Category", "CloudMigrations")]
    public async Task Legacy_396_database_is_adopted_without_recreating_customer_data()
    {
        var root = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(root))
            return;

        var databaseName = $"nostos_mig_legacy_{Guid.NewGuid():N}"[..31];
        await CreateDatabaseAsync(root, databaseName);

        try
        {
            var connections = CustomerConnections(root);
            var conceptId = Guid.NewGuid();

            // Reproduce the #396 lifecycle exactly: current model created with
            // EnsureCreated, customer content present, no EF migration history.
            await using (var legacy = RuntimeContext(connections, databaseName))
            {
                await legacy.Database.EnsureCreatedAsync();
                legacy.LibraryStates.Add(new LibraryState
                {
                    Id = LibraryState.WellKnownId,
                    SingletonSlot = LibraryState.SingletonSentinel,
                });
                legacy.Concepts.Add(new ConceptModel
                {
                    Id = conceptId,
                    Concept = "Legacy data survives baseline adoption",
                });
                await legacy.SaveChangesAsync();
            }

            var accountId = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                databaseName);
            var store = new MutableControlPlaneStore(Snapshot(
                accountId,
                databaseName,
                CloudProvisioningState.Ready,
                CloudAccountStatus.Active,
                CloudCustomerSchema.LegacyCurrentModelV1));
            var migrator = CreateMigrator(store, connections);

            var result = await migrator.MigrateAsync(accountId);

            result.AdoptedLegacyBaseline.Should().BeTrue();
            result.AppliedMigrations.Should().Equal(
                CloudCustomerSchema.BaselineMigrationId,
                CloudCustomerSchema.CurrentVersion);
            store.Current.SchemaVersion.Should().Be(CloudCustomerSchema.CurrentVersion);

            await using var db = PostgresContext(connections, databaseName);
            (await db.Concepts.SingleAsync(x => x.Id == conceptId))
                .Concept.Should().Be("Legacy data survives baseline adoption");
            (await db.Database.GetAppliedMigrationsAsync()).Should().Equal(
                CloudCustomerSchema.BaselineMigrationId,
                CloudCustomerSchema.CurrentVersion);
        }
        finally
        {
            await DropDatabaseIfExistsAsync(root, databaseName);
        }
    }

    [Fact]
    [Trait("Category", "CloudMigrations")]
    public async Task Existing_baseline_database_advances_through_pending_migration()
    {
        var root = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(root))
            return;

        var databaseName = $"nostos_mig_upgrade_{Guid.NewGuid():N}"[..31];
        await CreateDatabaseAsync(root, databaseName);

        try
        {
            var connections = CustomerConnections(root);
            var conceptId = Guid.NewGuid();

            await using (var baseline = PostgresContext(connections, databaseName))
            {
                var efMigrator = baseline.GetService<IMigrator>();
                await efMigrator.MigrateAsync(CloudCustomerSchema.BaselineMigrationId);

                baseline.LibraryStates.Add(new LibraryState
                {
                    Id = LibraryState.WellKnownId,
                    SingletonSlot = LibraryState.SingletonSentinel,
                });
                baseline.Concepts.Add(new ConceptModel
                {
                    Id = conceptId,
                    Concept = "Existing baseline tenant",
                });
                await baseline.SaveChangesAsync();

                (await baseline.Database.GetPendingMigrationsAsync())
                    .Should().Equal(CloudCustomerSchema.CurrentVersion);
            }

            var accountId = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                databaseName);
            var store = new MutableControlPlaneStore(Snapshot(
                accountId,
                databaseName,
                CloudProvisioningState.Ready,
                CloudAccountStatus.Active,
                CloudCustomerSchema.BaselineMigrationId));
            var migrator = CreateMigrator(store, connections);

            var result = await migrator.MigrateAsync(accountId);

            result.PreviousVersion.Should().Be(CloudCustomerSchema.BaselineMigrationId);
            result.AdoptedLegacyBaseline.Should().BeFalse();
            result.CurrentVersion.Should().Be(CloudCustomerSchema.CurrentVersion);

            await using var current = PostgresContext(connections, databaseName);
            (await current.Database.GetPendingMigrationsAsync()).Should().BeEmpty();
            (await current.Concepts.SingleAsync(x => x.Id == conceptId))
                .Concept.Should().Be("Existing baseline tenant");
        }
        finally
        {
            await DropDatabaseIfExistsAsync(root, databaseName);
        }
    }

    [Fact]
    [Trait("Category", "CloudMigrations")]
    public async Task Unknown_unversioned_database_fails_closed_and_records_failure()
    {
        var root = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(root))
            return;

        var databaseName = $"nostos_mig_unknown_{Guid.NewGuid():N}"[..31];
        await CreateDatabaseAsync(root, databaseName);

        try
        {
            var connections = CustomerConnections(root);
            await using (var connection = new NpgsqlConnection(connections.ForDatabase(databaseName)))
            {
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand(
                    "CREATE TABLE \"Unexpected\" (\"Id\" integer PRIMARY KEY)",
                    connection);
                await command.ExecuteNonQueryAsync();
            }

            var accountId = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                databaseName);
            var store = new MutableControlPlaneStore(Snapshot(
                accountId,
                databaseName,
                CloudProvisioningState.Ready,
                CloudAccountStatus.Active,
                schemaVersion: "unknown-schema"));
            var migrator = CreateMigrator(store, connections);

            var act = () => migrator.MigrateAsync(accountId);

            var exception = await act.Should().ThrowAsync<CloudSchemaMigrationException>();
            exception.Which.FailureCode.Should().Be("schema_unversioned_database");
            store.Current.SchemaVersion.Should().Be("unknown-schema");
            store.Current.FailureCode.Should().Be("schema_unversioned_database");
        }
        finally
        {
            await DropDatabaseIfExistsAsync(root, databaseName);
        }
    }

    [Fact]
    public void SQLite_and_PostgreSQL_migration_histories_are_provider_specific()
    {
        var sqliteOptions = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite(
                "Data Source=:memory:",
                sqlite => sqlite.MigrationsAssembly(typeof(Program).Assembly.FullName))
            .Options;
        using var sqlite = new NostosDbContext(sqliteOptions);

        var sqliteMigrations = sqlite.Database.GetMigrations().ToList();
        sqliteMigrations.Should().NotBeEmpty();
        sqliteMigrations.Should().NotContain(CloudCustomerSchema.BaselineMigrationId);
        sqliteMigrations.Should().NotContain(CloudCustomerSchema.CurrentVersion);

        var postgresOptions = new DbContextOptionsBuilder<PostgresNostosDbContext>()
            .UseNpgsql("Host=localhost;Database=nostos_migration_metadata;Username=postgres")
            .Options;
        using var postgres = new PostgresNostosDbContext(postgresOptions);

        postgres.Database.GetMigrations().Should().Equal(
            CloudCustomerSchema.BaselineMigrationId,
            CloudCustomerSchema.CurrentVersion);
    }

    [Fact]
    [Trait("Category", "CloudMigrations")]
    public async Task Legacy_396_database_with_matching_tables_but_wrong_columns_fails_closed()
    {
        var root = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(root))
            return;

        var databaseName = $"nostos_mig_shape_{Guid.NewGuid():N}"[..31];
        await CreateDatabaseAsync(root, databaseName);

        try
        {
            var connections = CustomerConnections(root);

            await using (var legacy = RuntimeContext(connections, databaseName))
            {
                await legacy.Database.EnsureCreatedAsync();
                legacy.LibraryStates.Add(new LibraryState
                {
                    Id = LibraryState.WellKnownId,
                    SingletonSlot = LibraryState.SingletonSentinel,
                });
                await legacy.SaveChangesAsync();

                await legacy.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"Concepts\" ADD COLUMN \"UnexpectedLegacyColumn\" text NULL");
            }

            var accountId = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                databaseName);
            var store = new MutableControlPlaneStore(Snapshot(
                accountId,
                databaseName,
                CloudProvisioningState.Ready,
                CloudAccountStatus.Active,
                CloudCustomerSchema.LegacyCurrentModelV1));
            var migrator = CreateMigrator(store, connections);

            var act = () => migrator.MigrateAsync(accountId);

            var exception = await act.Should().ThrowAsync<CloudSchemaMigrationException>();
            exception.Which.FailureCode.Should().Be("schema_legacy_shape_mismatch");
            store.Current.SchemaVersion.Should().Be(CloudCustomerSchema.LegacyCurrentModelV1);
            store.Current.FailureCode.Should().Be("schema_legacy_shape_mismatch");

            await using var verify = PostgresContext(connections, databaseName);
            (await verify.Database.GetAppliedMigrationsAsync()).Should().BeEmpty(
                "a schema mismatch must fail before Nostos stamps a PostgreSQL baseline");
        }
        finally
        {
            await DropDatabaseIfExistsAsync(root, databaseName);
        }
    }

    [Fact]
    public void Compatibility_window_is_explicit_and_bounded()
    {
        CloudCustomerSchema.IsApplicationCompatible(
            CloudCustomerSchema.LegacyCurrentModelV1).Should().BeTrue();
        CloudCustomerSchema.IsApplicationCompatible(
            CloudCustomerSchema.BaselineMigrationId).Should().BeTrue();
        CloudCustomerSchema.IsApplicationCompatible(
            CloudCustomerSchema.CurrentVersion).Should().BeTrue();

        CloudCustomerSchema.IsApplicationCompatible(null).Should().BeFalse();
        CloudCustomerSchema.IsApplicationCompatible("future-or-unknown").Should().BeFalse();
    }

    private static CloudTenantSchemaMigrator CreateMigrator(
        ICloudControlPlaneStore store,
        ICloudCustomerConnectionFactory connections) =>
        new(
            store,
            connections,
            NullLogger<CloudTenantSchemaMigrator>.Instance);

    private static CloudCustomerConnectionFactory CustomerConnections(string root)
    {
        var builder = new NpgsqlConnectionStringBuilder(root);
        return new CloudCustomerConnectionFactory(
            new CloudDatabaseConnections(
                ControlPlane: builder.ConnectionString,
                Admin: builder.ConnectionString,
                CustomerBase: builder.ConnectionString));
    }

    private static NostosDbContext RuntimeContext(
        ICloudCustomerConnectionFactory connections,
        string databaseName)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(connections.ForDatabase(databaseName))
            .Options;

        return new NostosDbContext(options);
    }

    private static PostgresNostosDbContext PostgresContext(
        ICloudCustomerConnectionFactory connections,
        string databaseName)
    {
        var options = new DbContextOptionsBuilder<PostgresNostosDbContext>()
            .UseNpgsql(connections.ForDatabase(databaseName))
            .Options;

        return new PostgresNostosDbContext(options);
    }

    private static CloudAccountResourceSnapshot Snapshot(
        NostosAccountId accountId,
        string databaseName,
        CloudProvisioningState provisioningState,
        CloudAccountStatus accountStatus,
        string? schemaVersion) =>
        new(
            accountId,
            ResourceId: Guid.NewGuid(),
            DatabaseName: databaseName,
            StorageNamespace: $"tests/{Guid.NewGuid():N}",
            ProvisioningState: provisioningState,
            AccountStatus: accountStatus,
            SchemaVersion: schemaVersion,
            FailureCode: null,
            CreatedAtUtc: DateTime.UtcNow,
            UpdatedAtUtc: DateTime.UtcNow,
            LastProvisionAttemptAtUtc: null,
            ReadyAtUtc: provisioningState == CloudProvisioningState.Ready
                ? DateTime.UtcNow
                : null);

    private static async Task CreateDatabaseAsync(string rootConnection, string databaseName)
    {
        await using var connection = new NpgsqlConnection(rootConnection);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            $"CREATE DATABASE {QuoteIdentifier(databaseName)}",
            connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseIfExistsAsync(
        string rootConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(rootConnection);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)} WITH (FORCE)",
            connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private sealed class MutableControlPlaneStore(CloudAccountResourceSnapshot snapshot)
        : ICloudControlPlaneStore
    {
        public CloudAccountResourceSnapshot Current { get; private set; } = snapshot;

        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<CloudAccountResourceSnapshot?>(Current);

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Current);

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default)
        {
            Current = Current with
            {
                ProvisioningState = CloudProvisioningState.Provisioning,
                AccountStatus = CloudAccountStatus.Unknown,
                FailureCode = null,
                UpdatedAtUtc = DateTime.UtcNow,
            };
            return Task.CompletedTask;
        }

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default)
        {
            Current = Current with
            {
                ProvisioningState = CloudProvisioningState.Ready,
                AccountStatus = CloudAccountStatus.Active,
                SchemaVersion = schemaVersion,
                FailureCode = null,
                UpdatedAtUtc = DateTime.UtcNow,
                ReadyAtUtc = DateTime.UtcNow,
            };
            return Task.CompletedTask;
        }

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default)
        {
            Current = Current with
            {
                ProvisioningState = CloudProvisioningState.Failed,
                AccountStatus = CloudAccountStatus.Unknown,
                FailureCode = failureCode,
                UpdatedAtUtc = DateTime.UtcNow,
            };
            return Task.CompletedTask;
        }

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default)
        {
            Current = Current with
            {
                SchemaVersion = schemaVersion,
                FailureCode = null,
                UpdatedAtUtc = DateTime.UtcNow,
            };
            return Task.CompletedTask;
        }

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default)
        {
            Current = Current with
            {
                FailureCode = failureCode,
                UpdatedAtUtc = DateTime.UtcNow,
            };
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>([Current]);
    }
}
