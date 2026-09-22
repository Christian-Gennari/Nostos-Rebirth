using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Cloud;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Migrations;
using Nostos.Backend.Cloud.Provisioning;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudProvisioningSecurityTests
{
    [Theory]
    [InlineData(CloudAccountStatus.Disabled)]
    [InlineData(CloudAccountStatus.Deleted)]
    public async Task Blocked_accounts_cannot_reactivate_themselves_through_provisioning(
        CloudAccountStatus accountStatus)
    {
        var accountId = NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            $"blocked-{accountStatus}");

        var snapshot = new CloudAccountResourceSnapshot(
            accountId,
            ResourceId: Guid.NewGuid(),
            DatabaseName: "nostos_u_blocked",
            StorageNamespace: "accounts/blocked",
            ProvisioningState: CloudProvisioningState.Failed,
            AccountStatus: accountStatus,
            SchemaVersion: null,
            FailureCode: null,
            CreatedAtUtc: DateTime.UtcNow,
            UpdatedAtUtc: DateTime.UtcNow,
            LastProvisionAttemptAtUtc: null,
            ReadyAtUtc: null);

        var store = new BlockedAccountStore(snapshot);
        var connections = new CloudDatabaseConnections(
            ControlPlane: "Host=localhost;Database=control;Username=control",
            Admin: "Host=localhost;Database=postgres;Username=admin",
            CustomerBase: "Host=localhost;Username=nostos_app");
        var customerConnections = new CloudCustomerConnectionFactory(connections);

        var provisioner = new CloudCustomerDatabaseProvisioner(
            store,
            connections,
            customerConnections,
            new ThrowIfCalledSchemaMigrator(),
            NullLogger<CloudCustomerDatabaseProvisioner>.Instance);

        var act = () => provisioner.ProvisionAsync(accountId);

        var exception = await act.Should().ThrowAsync<CloudProvisioningException>();
        exception.Which.FailureCode.Should().Be("account_unavailable");
        store.MarkProvisioningCalls.Should().Be(0);
        store.MarkReadyCalls.Should().Be(0);
    }

    private sealed class BlockedAccountStore(CloudAccountResourceSnapshot snapshot)
        : ICloudControlPlaneStore
    {
        public int MarkProvisioningCalls { get; private set; }
        public int MarkReadyCalls { get; private set; }

        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<CloudAccountResourceSnapshot?>(snapshot);

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(snapshot);

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default)
        {
            MarkProvisioningCalls++;
            return Task.CompletedTask;
        }

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default)
        {
            MarkReadyCalls++;
            return Task.CompletedTask;
        }

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>([snapshot]);
    }

    private sealed class ThrowIfCalledSchemaMigrator : ICloudTenantSchemaMigrator
    {
        public Task<CloudSchemaMigrationResult> MigrateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Schema migration must not run for a blocked account.");
    }
}
