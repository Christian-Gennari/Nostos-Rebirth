using System.Collections.Concurrent;
using System.Security.Cryptography;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;

namespace Nostos.Backend.Cloud.Recovery;

public interface ICloudRecoveryService
{
    Task<IReadOnlyList<CloudOperationalBackupSummary>> ListBackupsAsync(
        CancellationToken cancellationToken = default);

    Task<CloudOperationalBackupSummary> CreateBackupAsync(
        CancellationToken cancellationToken = default);

    Task<CloudRestoreResult> RestoreAsync(
        Guid backupId,
        bool confirmed,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Account-scoped Nostos Cloud operational recovery.
///
/// The backup payload is the provider-independent #399 portable archive. The
/// service adds operator retention/storage plus a staged restore workflow, but
/// never creates a second interchange format and never accepts tenant resource
/// identifiers from callers.
/// </summary>
public sealed class CloudRecoveryService(
    ICloudTenantContextAccessor tenantContext,
    ICloudControlPlaneStore controlPlane,
    IPortableArchiveService currentPortability,
    ICloudRecoveryStore recoveryStore,
    ICloudRecoveryControlPlane recoveryControlPlane,
    CloudRecoveryResourceManager resources,
    ILoggerFactory loggerFactory,
    ILogger<CloudRecoveryService> logger)
    : ICloudRecoveryService
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> AccountGates = new();

    public async Task<IReadOnlyList<CloudOperationalBackupSummary>> ListBackupsAsync(
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var mapping = await GetReadyMappingAsync(
            account.AccountId,
            cancellationToken);

        var backups = await recoveryStore.ListBackupsAsync(
            mapping.ResourceId,
            cancellationToken);

        foreach (var backup in backups)
            EnsureBackupBelongsToAccount(backup, account.AccountId, mapping.ResourceId);

        return backups.Select(x => x.ToSummary()).ToList();
    }

    public async Task<CloudOperationalBackupSummary> CreateBackupAsync(
        CancellationToken cancellationToken = default)
    {
        var account = tenantContext.GetRequired();
        var gate = GateFor(account.AccountId);
        await gate.WaitAsync(cancellationToken);

        try
        {
            var mapping = await GetReadyMappingAsync(
                account.AccountId,
                cancellationToken);

            var backupId = Guid.NewGuid();
            var tempPath = Path.Combine(
                Path.GetTempPath(),
                $"nostos-cloud-backup-{backupId:N}.nostos");

            try
            {
                PortableExportResult export;
                await using (var output = new FileStream(
                    tempPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    bufferSize: 128 * 1024,
                    options: FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    export = await currentPortability.ExportAsync(
                        output,
                        cancellationToken);
                }

                var archiveBytes = new FileInfo(tempPath).Length;
                var archiveSha256 = await ComputeSha256Async(
                    tempPath,
                    cancellationToken);

                var manifest = new CloudOperationalBackupManifest(
                    CloudOperationalBackupManifest.CurrentFormat,
                    CloudOperationalBackupManifest.CurrentVersion,
                    backupId,
                    account.AccountId.Value,
                    mapping.ResourceId,
                    DateTime.UtcNow,
                    mapping.SchemaVersion ?? CloudCustomerSchema.CurrentVersion,
                    export.FormatVersion,
                    export.Counts,
                    export.MediaFiles,
                    export.MediaBytes,
                    archiveBytes,
                    archiveSha256);

                await recoveryStore.SaveBackupAsync(
                    mapping.ResourceId,
                    manifest,
                    tempPath,
                    cancellationToken);

                logger.LogInformation(
                    "Created Cloud operational backup {BackupId} for account {AccountId}, resource {ResourceId}.",
                    backupId,
                    account.AccountId,
                    mapping.ResourceId);

                return manifest.ToSummary();
            }
            finally
            {
                TryDeleteFile(tempPath);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<CloudRestoreResult> RestoreAsync(
        Guid backupId,
        bool confirmed,
        CancellationToken cancellationToken = default)
    {
        if (!confirmed)
        {
            throw new CloudRecoveryException(
                "confirmation_required",
                "Cloud restore requires explicit confirmation because it changes the live account resource mapping.");
        }

        var account = tenantContext.GetRequired();
        var gate = GateFor(account.AccountId);
        await gate.WaitAsync(cancellationToken);

        CloudRecoveryStage? stage = null;
        CloudAccountResourceSnapshot? original = null;
        CloudOperationalBackupManifest? manifest = null;
        var stageCreated = false;
        var switched = false;
        var integrityVerified = false;
        var restoreStartedAt = DateTime.UtcNow;
        var tempPath = Path.Combine(
            Path.GetTempPath(),
            $"nostos-cloud-restore-{Guid.NewGuid():N}.nostos");

        try
        {
            original = await GetReadyMappingAsync(
                account.AccountId,
                cancellationToken);

            manifest = await recoveryStore.GetBackupAsync(
                original.ResourceId,
                backupId,
                cancellationToken)
                ?? throw new CloudRecoveryException(
                    "backup_not_found",
                    "The selected Cloud recovery backup does not exist for this account.");

            EnsureBackupBelongsToAccount(
                manifest,
                account.AccountId,
                original.ResourceId);

            await using (var output = new FileStream(
                tempPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 128 * 1024,
                options: FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await recoveryStore.DownloadBackupAsync(
                    original.ResourceId,
                    backupId,
                    output,
                    cancellationToken);
            }

            var downloadedBytes = new FileInfo(tempPath).Length;
            var downloadedSha256 = await ComputeSha256Async(
                tempPath,
                cancellationToken);

            if (downloadedBytes != manifest.ArchiveBytes
                || !string.Equals(
                    downloadedSha256,
                    manifest.ArchiveSha256,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new CloudRecoveryException(
                    "backup_integrity_failed",
                    "The selected Cloud recovery archive no longer matches its verified backup metadata.");
            }

            var restoreId = Guid.NewGuid();
            stage = resources.NewStage(original, restoreId);
            await resources.CreateStageAsync(stage, cancellationToken);
            stageCreated = true;

            PortableImportResult import;
            await using (var stagedDb = resources.CreateDatabaseContext(stage))
            {
                var stagedAssets = resources.CreateAssetStorage(
                    stage,
                    account.AccountId);
                var portability = new PortableArchiveService(
                    stagedDb,
                    stagedAssets,
                    loggerFactory.CreateLogger<PortableArchiveService>());

                await using var input = new FileStream(
                    tempPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    bufferSize: 128 * 1024,
                    options: FileOptions.Asynchronous | FileOptions.SequentialScan);

                try
                {
                    import = await portability.ImportAsync(
                        input,
                        cancellationToken);
                }
                catch (PortableArchiveException exception)
                {
                    throw new CloudRecoveryException(
                        "backup_portable_validation_failed",
                        "The Cloud recovery archive failed portable-archive validation.",
                        exception);
                }
            }

            if (import.FormatVersion != manifest.PortableFormatVersion
                || import.Counts != manifest.Counts
                || import.MediaFiles != manifest.MediaFiles
                || import.MediaBytes != manifest.MediaBytes)
            {
                throw new CloudRecoveryException(
                    "restore_verification_failed",
                    "The staged restore result does not match the selected backup metadata.");
            }

            await resources.VerifyStageAsync(
                stage,
                account.AccountId,
                import,
                cancellationToken);
            integrityVerified = true;

            var preparedAudit = Audit(
                stage,
                original,
                manifest,
                account.AccountId,
                restoreStartedAt,
                completedAtUtc: null,
                status: "prepared",
                integrityVerified: true);

            await recoveryStore.WriteRestoreAuditAsync(
                original.ResourceId,
                preparedAudit,
                cancellationToken);

            await recoveryControlPlane.RebindAsync(
                account.AccountId,
                original,
                stage,
                cancellationToken);
            switched = true;

            var completedAt = DateTime.UtcNow;
            var completedAudit = preparedAudit with
            {
                CompletedAtUtc = completedAt,
                Status = "completed",
            };

            try
            {
                await recoveryStore.WriteRestoreAuditAsync(
                    original.ResourceId,
                    completedAudit,
                    CancellationToken.None);
            }
            catch (Exception exception)
            {
                // Activation has already succeeded. Do not report the restore
                // as failed and tempt an operator to repeat it simply because
                // the non-authoritative audit write failed.
                logger.LogError(
                    "Cloud restore {RestoreId} activated successfully but its completion audit could not be persisted; exception type {ExceptionType}. Details suppressed.",
                    stage.RestoreId,
                    exception.GetType().Name);
            }

            logger.LogInformation(
                "Restored Cloud account {AccountId} from backup {BackupId}. Resource {ResourceId} was rebound to a verified staged resource; previous resources are retained for rollback.",
                account.AccountId,
                backupId,
                original.ResourceId);

            return new CloudRestoreResult(
                stage.RestoreId,
                backupId,
                completedAt,
                import.Counts,
                import.MediaFiles,
                import.MediaBytes,
                import.IntegrityVerified);
        }
        catch (Exception exception)
        {
            if (stage is not null && original is not null && manifest is not null)
            {
                try
                {
                    await recoveryStore.WriteRestoreAuditAsync(
                        original.ResourceId,
                        Audit(
                            stage,
                            original,
                            manifest,
                            account.AccountId,
                            restoreStartedAt,
                            DateTime.UtcNow,
                            "failed",
                            integrityVerified),
                        CancellationToken.None);
                }
                catch (Exception auditException)
                {
                    logger.LogWarning(
                        "Could not persist failed Cloud restore audit for account {AccountId}; exception type {ExceptionType}. Details suppressed.",
                        account.AccountId,
                        auditException.GetType().Name);
                }
            }

            if (exception is CloudRecoveryException)
                throw;

            throw new CloudRecoveryException(
                "restore_failed",
                "Cloud restore failed before a verified replacement could be activated.",
                exception);
        }
        finally
        {
            if (stageCreated && !switched && stage is not null)
                await resources.CleanupStageAsync(stage);

            TryDeleteFile(tempPath);
            gate.Release();
        }
    }

    private async Task<CloudAccountResourceSnapshot> GetReadyMappingAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var mapping = await controlPlane.FindAsync(
            accountId,
            cancellationToken)
            ?? throw new CloudRecoveryException(
                "account_not_provisioned",
                "The Cloud account has no provisioned resource mapping.");

        if (!mapping.IsReady)
        {
            throw new CloudRecoveryException(
                "account_not_ready",
                "The Cloud account is not ready for backup or restore.");
        }

        return mapping;
    }

    private static SemaphoreSlim GateFor(NostosAccountId accountId) =>
        AccountGates.GetOrAdd(
            accountId.Value,
            static _ => new SemaphoreSlim(1, 1));

    private static void EnsureBackupBelongsToAccount(
        CloudOperationalBackupManifest backup,
        NostosAccountId accountId,
        Guid resourceId)
    {
        if (backup.AccountId != accountId.Value
            || backup.ResourceId != resourceId)
        {
            throw new CloudRecoveryException(
                "backup_tenant_mismatch",
                "The selected Cloud recovery backup does not belong to the trusted account resource.");
        }
    }

    private static CloudRestoreAudit Audit(
        CloudRecoveryStage stage,
        CloudAccountResourceSnapshot original,
        CloudOperationalBackupManifest manifest,
        NostosAccountId accountId,
        DateTime startedAtUtc,
        DateTime? completedAtUtc,
        string status,
        bool integrityVerified) =>
        new(
            CloudRestoreAudit.CurrentFormat,
            CloudRestoreAudit.CurrentVersion,
            stage.RestoreId,
            manifest.BackupId,
            accountId.Value,
            original.ResourceId,
            startedAtUtc,
            completedAtUtc,
            status,
            original.DatabaseName,
            original.StorageNamespace,
            stage.DatabaseName,
            stage.StorageNamespace,
            manifest.SourceSchemaVersion,
            CloudCustomerSchema.CurrentVersion,
            integrityVerified);

    private static async Task<string> ComputeSha256Async(
        string path,
        CancellationToken cancellationToken)
    {
        await using var input = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 128 * 1024,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var sha = SHA256.Create();
        var hash = await sha.ComputeHashAsync(input, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch
        {
            // Best-effort cleanup of a process-local staging file. Durable
            // recovery state is in PostgreSQL/object storage, never /tmp.
        }
    }
}
