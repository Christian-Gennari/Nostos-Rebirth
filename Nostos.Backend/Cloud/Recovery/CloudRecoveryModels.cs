using Nostos.Backend.Services.Portability;

namespace Nostos.Backend.Cloud.Recovery;

public sealed record CloudOperationalBackupSummary(
    Guid BackupId,
    DateTime CreatedAtUtc,
    string SourceSchemaVersion,
    PortableArchiveCounts Counts,
    int MediaFiles,
    long MediaBytes,
    long ArchiveBytes,
    string ArchiveSha256);

public sealed record CloudRestoreResult(
    Guid RestoreId,
    Guid BackupId,
    DateTime RestoredAtUtc,
    PortableArchiveCounts Counts,
    int MediaFiles,
    long MediaBytes,
    bool IntegrityVerified);

public sealed record CloudOperationalBackupManifest(
    string Format,
    int Version,
    Guid BackupId,
    Guid AccountId,
    Guid ResourceId,
    DateTime CreatedAtUtc,
    string SourceSchemaVersion,
    int PortableFormatVersion,
    PortableArchiveCounts Counts,
    int MediaFiles,
    long MediaBytes,
    long ArchiveBytes,
    string ArchiveSha256)
{
    public const string CurrentFormat = "nostos-cloud-operational-backup";
    public const int CurrentVersion = 1;

    public CloudOperationalBackupSummary ToSummary() =>
        new(
            BackupId,
            CreatedAtUtc,
            SourceSchemaVersion,
            Counts,
            MediaFiles,
            MediaBytes,
            ArchiveBytes,
            ArchiveSha256);
}

public sealed record CloudRestoreAudit(
    string Format,
    int Version,
    Guid RestoreId,
    Guid BackupId,
    Guid AccountId,
    Guid ResourceId,
    DateTime StartedAtUtc,
    DateTime? CompletedAtUtc,
    string Status,
    string PreviousDatabaseName,
    string PreviousStorageNamespace,
    string StagedDatabaseName,
    string StagedStorageNamespace,
    string SourceSchemaVersion,
    string TargetSchemaVersion,
    bool IntegrityVerified)
{
    public const string CurrentFormat = "nostos-cloud-restore-audit";
    public const int CurrentVersion = 1;
}

public sealed record CloudRecoveryStage(
    Guid RestoreId,
    Guid ResourceId,
    string DatabaseName,
    string StorageNamespace);

public sealed class CloudRecoveryException(
    string code,
    string message,
    Exception? innerException = null)
    : InvalidOperationException(message, innerException)
{
    public string Code { get; } = code;
}
