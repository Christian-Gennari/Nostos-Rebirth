using System.Xml.Linq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Runtime;
using Nostos.Backend.Configuration;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudRuntimeIntegrationTests
{
    private const string ConnectionEnvironmentVariable = "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudRuntime")]
    public async Task Data_Protection_key_ring_survives_replacement_and_worker_lease_is_exclusive()
    {
        var rootConnection = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(rootConnection))
            return;

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var databaseName = $"nostos_runtime_{suffix}";
        var rootBuilder = new NpgsqlConnectionStringBuilder(rootConnection);
        var adminConnection = rootBuilder.ConnectionString;

        try
        {
            await CreateDatabaseAsync(adminConnection, databaseName);

            var controlBuilder = new NpgsqlConnectionStringBuilder(rootConnection)
            {
                Database = databaseName,
            };
            var connections = new CloudDatabaseConnections(
                controlBuilder.ConnectionString,
                adminConnection,
                rootBuilder.ConnectionString);

            var dbOptions = new DbContextOptionsBuilder<CloudControlPlaneDbContext>()
                .UseNpgsql(connections.ControlPlane)
                .Options;
            var factory = new TestControlPlaneDbContextFactory(dbOptions);
            await new CloudControlPlaneBootstrapper(factory).EnsureReadyAsync();

            var wrappingKey = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();
            var material = new CloudDataProtectionKeyMaterial(
                new CloudDataProtectionOptions(),
                wrappingKey);

            var firstInstance = new CloudDataProtectionKeyRepository(connections, material);
            firstInstance.StoreElement(
                XElement.Parse("<key id=\"runtime-test\"><descriptor>replacement-safe</descriptor></key>"),
                "runtime-test");

            var replacementInstance = new CloudDataProtectionKeyRepository(
                connections,
                new CloudDataProtectionKeyMaterial(
                    new CloudDataProtectionOptions(),
                    wrappingKey.ToArray()));

            replacementInstance.GetAllElements()
                .Single()
                .ToString(SaveOptions.DisableFormatting)
                .Should().Contain("replacement-safe");

            var wrongKeyInstance = new CloudDataProtectionKeyRepository(
                connections,
                new CloudDataProtectionKeyMaterial(
                    new CloudDataProtectionOptions(),
                    Enumerable.Repeat((byte)99, 32).ToArray()));

            var wrongKey = () => wrongKeyInstance.EnsureReadable();
            wrongKey.Should()
                .Throw<InvalidOperationException>()
                .WithMessage("*Data Protection key ring*");

            var leases = new PostgresCloudWorkerLeaseManager(
                connections,
                NullLogger<PostgresCloudWorkerLeaseManager>.Instance);

            await using (var firstLease =
                await leases.TryAcquireAsync(CloudWorkerLeaseNames.ScheduledBackup))
            {
                firstLease.Should().NotBeNull();

                var competingLease =
                    await leases.TryAcquireAsync(CloudWorkerLeaseNames.ScheduledBackup);
                competingLease.Should().BeNull();
            }

            await using var reacquired =
                await leases.TryAcquireAsync(CloudWorkerLeaseNames.ScheduledBackup);
            reacquired.Should().NotBeNull();
        }
        finally
        {
            await DropDatabaseIfExistsAsync(adminConnection, databaseName);
        }
    }

    private static async Task CreateDatabaseAsync(
        string adminConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            $"CREATE DATABASE {QuoteIdentifier(databaseName)}",
            connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseIfExistsAsync(
        string adminConnection,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)} WITH (FORCE)",
            connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private sealed class TestControlPlaneDbContextFactory(
        DbContextOptions<CloudControlPlaneDbContext> options)
        : IDbContextFactory<CloudControlPlaneDbContext>
    {
        public CloudControlPlaneDbContext CreateDbContext() => new(options);

        public ValueTask<CloudControlPlaneDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new CloudControlPlaneDbContext(options));
    }
}
