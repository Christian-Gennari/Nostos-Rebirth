using System.Data;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Recovery;

public interface ICloudRecoveryControlPlane
{
    Task RebindAsync(
        NostosAccountId accountId,
        CloudAccountResourceSnapshot expected,
        CloudRecoveryStage staged,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Performs the single control-plane mutation in an account restore.
///
/// The replacement resources are prepared and verified before this method is
/// called. The update is conditional on the exact mapping that was used to
/// build the restore, so concurrent recovery/provisioning work cannot silently
/// switch a tenant away from a newer resource.
/// </summary>
public sealed class CloudRecoveryControlPlane(
    IDbContextFactory<CloudControlPlaneDbContext> factory)
    : ICloudRecoveryControlPlane
{
    public async Task RebindAsync(
        NostosAccountId accountId,
        CloudAccountResourceSnapshot expected,
        CloudRecoveryStage staged,
        CancellationToken cancellationToken = default)
    {
        if (expected.AccountId != accountId
            || staged.ResourceId != expected.ResourceId)
        {
            throw new CloudRecoveryException(
                "restore_tenant_mismatch",
                "The staged restore does not belong to the trusted Cloud account.");
        }

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var row = await db.AccountResources
            .SingleOrDefaultAsync(
                x => x.AccountId == accountId.Value,
                cancellationToken)
            ?? throw new CloudRecoveryException(
                "restore_account_missing",
                "The Cloud account resource mapping no longer exists.");

        var mappingUnchanged =
            row.ResourceId == expected.ResourceId
            && string.Equals(
                row.DatabaseName,
                expected.DatabaseName,
                StringComparison.Ordinal)
            && string.Equals(
                row.StorageNamespace,
                expected.StorageNamespace,
                StringComparison.Ordinal)
            && row.ProvisioningState == CloudProvisioningState.Ready
            && row.AccountStatus == CloudAccountStatus.Active
            && CloudCustomerSchema.IsApplicationCompatible(row.SchemaVersion);

        if (!mappingUnchanged)
        {
            throw new CloudRecoveryException(
                "restore_mapping_changed",
                "The live Cloud resource mapping changed while the restore was being prepared. The staged restore was not activated.");
        }

        row.DatabaseName = staged.DatabaseName;
        row.StorageNamespace = staged.StorageNamespace;
        row.SchemaVersion = CloudCustomerSchema.CurrentVersion;
        row.ProvisioningState = CloudProvisioningState.Ready;
        row.AccountStatus = CloudAccountStatus.Active;
        row.FailureCode = null;
        row.UpdatedAtUtc = DateTime.UtcNow;
        row.ReadyAtUtc ??= row.UpdatedAtUtc;

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
