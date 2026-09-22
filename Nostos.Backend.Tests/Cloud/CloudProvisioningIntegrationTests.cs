using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Persistence;
using Nostos.Backend.Cloud.Provisioning;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudProvisioningIntegrationTests
{
    private const string ConnectionEnvironmentVariable = "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudProvisioning")]
    public async Task Provisioning_is_idempotent_retryable_and_isolates_customer_databases()
    {
        var rootConnection = Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(rootConnection))
            return;

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var controlPlaneDatabase = $"nostos_cp_{suffix}";
        var databasePrefix = $"ntu_{suffix}";
        var createdDatabases = new HashSet<string>(StringComparer.Ordinal);

        var rootBuilder = new NpgsqlConnectionStringBuilder(rootConnection);
        var adminConnection = rootBuilder.ConnectionString;

        try
        {
            await CreateDatabaseAsync(adminConnection, controlPlaneDatabase);
            createdDatabases.Add(controlPlaneDatabase);

            var controlPlaneBuilder = new NpgsqlConnectionStringBuilder(rootConnection)
            {
                Database = controlPlaneDatabase,
            };
            var customerBaseBuilder = new NpgsqlConnectionStringBuilder(rootConnection)
            {
                Database = rootBuilder.Database,
            };

            var connections = new CloudDatabaseConnections(
                ControlPlane: controlPlaneBuilder.ConnectionString,
                Admin: adminConnection,
                CustomerBase: customerBaseBuilder.ConnectionString);

            var options = new CloudControlPlaneOptions
            {
                CustomerDatabasePrefix = databasePrefix,
                StorageNamespacePrefix = $"tests/{suffix}",
            };

            var controlPlaneOptions =
                new DbContextOptionsBuilder<CloudControlPlaneDbContext>()
                    .UseNpgsql(connections.ControlPlane)
                    .Options;

            var controlPlaneFactory = new TestControlPlaneDbContextFactory(controlPlaneOptions);
            var bootstrapper = new CloudControlPlaneBootstrapper(controlPlaneFactory);
            await bootstrapper.EnsureReadyAsync();

            var store = new CloudControlPlaneStore(controlPlaneFactory, options);
            var customerConnections = new CloudCustomerConnectionFactory(connections);
            var provisioner = new CloudCustomerDatabaseProvisioner(
                store,
                connections,
                customerConnections,
                NullLogger<CloudCustomerDatabaseProvisioner>.Instance);

            var accountA = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                $"account-a-{suffix}");
            var accountB = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                $"account-b-{suffix}");

            var firstA = await provisioner.ProvisionAsync(accountA);
            firstA.Ready.Should().BeTrue();

            var mappingA = await store.FindAsync(accountA);
            mappingA.Should().NotBeNull();
            createdDatabases.Add(mappingA!.DatabaseName);

            var secondA = await provisioner.ProvisionAsync(accountA);
            secondA.Ready.Should().BeTrue();

            var mappingAAfterRetry = await store.FindAsync(accountA);
            mappingAAfterRetry!.ResourceId.Should().Be(mappingA.ResourceId);
            mappingAAfterRetry.DatabaseName.Should().Be(mappingA.DatabaseName);
            mappingAAfterRetry.StorageNamespace.Should().Be(mappingA.StorageNamespace);

            var firstB = await provisioner.ProvisionAsync(accountB);
            firstB.Ready.Should().BeTrue();

            var mappingB = await store.FindAsync(accountB);
            mappingB.Should().NotBeNull();
            createdDatabases.Add(mappingB!.DatabaseName);

            mappingB.ResourceId.Should().NotBe(mappingA.ResourceId);
            mappingB.DatabaseName.Should().NotBe(mappingA.DatabaseName);
            mappingB.StorageNamespace.Should().NotBe(mappingA.StorageNamespace);

            // A persisted failure state must retry the same resource mapping,
            // never allocate an orphan replacement database.
            await store.MarkFailedAsync(accountA, "synthetic_retry_probe");
            var retriedA = await provisioner.ProvisionAsync(accountA);
            retriedA.Ready.Should().BeTrue();

            var mappingARetried = await store.FindAsync(accountA);
            mappingARetried!.ResourceId.Should().Be(mappingA.ResourceId);
            mappingARetried.DatabaseName.Should().Be(mappingA.DatabaseName);

            var allResources = await store.ListAsync();
            allResources.Should().HaveCount(2);

            var sharedEntityId = Guid.NewGuid();

            await using (var dbA = CustomerContext(customerConnections, mappingA.DatabaseName))
            {
                dbA.Concepts.Add(new ConceptModel
                {
                    Id = sharedEntityId,
                    Concept = "Only in account A",
                });
                await dbA.SaveChangesAsync();
            }

            await using (var dbB = CustomerContext(customerConnections, mappingB.DatabaseName))
            {
                dbB.Concepts.Add(new ConceptModel
                {
                    Id = sharedEntityId,
                    Concept = "Only in account B",
                });
                await dbB.SaveChangesAsync();
            }

            await using (var dbA = CustomerContext(customerConnections, mappingA.DatabaseName))
            {
                var concept = await dbA.Concepts.SingleAsync(x => x.Id == sharedEntityId);
                concept.Concept.Should().Be("Only in account A");
            }

            await using (var dbB = CustomerContext(customerConnections, mappingB.DatabaseName))
            {
                var concept = await dbB.Concepts.SingleAsync(x => x.Id == sharedEntityId);
                concept.Concept.Should().Be("Only in account B");
            }

            // The production tenant factory must resolve from the authenticated
            // principal and control-plane mapping, not from caller-supplied IDs.
            var httpContextAccessor = new HttpContextAccessor
            {
                HttpContext = ContextFor(accountA, suffix),
            };
            var accountResolver = new CloudAccountContextResolver();
            var tenantFactory = new CloudTenantDbContextFactory(
                httpContextAccessor,
                accountResolver,
                store,
                customerConnections);

            await using (var dbA = await tenantFactory.CreateDbContextAsync())
            {
                (await dbA.Concepts.SingleAsync(x => x.Id == sharedEntityId))
                    .Concept.Should().Be("Only in account A");
            }

            httpContextAccessor.HttpContext = ContextFor(accountB, suffix);
            await using (var dbB = await tenantFactory.CreateDbContextAsync())
            {
                (await dbB.Concepts.SingleAsync(x => x.Id == sharedEntityId))
                    .Concept.Should().Be("Only in account B");
            }
        }
        finally
        {
            foreach (var database in createdDatabases.OrderByDescending(x => x == controlPlaneDatabase))
            {
                await DropDatabaseIfExistsAsync(adminConnection, database);
            }
        }
    }

    private static NostosDbContext CustomerContext(
        ICloudCustomerConnectionFactory connections,
        string databaseName)
    {
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(connections.ForDatabase(databaseName))
            .Options;

        return new NostosDbContext(options);
    }

    private static DefaultHttpContext ContextFor(NostosAccountId accountId, string suffix)
    {
        // Recreate a principal whose trusted issuer+subject deterministically
        // yield the supplied account. The helper picks the same inputs used by
        // this test's account IDs.
        var isA = accountId == NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            $"account-a-{suffix}");
        var subject = isA ? $"account-a-{suffix}" : $"account-b-{suffix}";

        var identity = new ClaimsIdentity(
            new[]
            {
                new Claim(
                    NostosCloudClaimTypes.ValidatedIssuer,
                    "https://identity.example.test"),
                new Claim("sub", subject),
                new Claim("name", "Provisioning test"),
            },
            authenticationType: "test");

        return new DefaultHttpContext
        {
            User = new ClaimsPrincipal(identity),
        };
    }

    private static async Task CreateDatabaseAsync(string adminConnection, string databaseName)
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
