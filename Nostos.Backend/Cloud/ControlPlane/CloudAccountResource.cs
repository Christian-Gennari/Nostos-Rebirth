using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.ControlPlane;

public enum CloudProvisioningState
{
    Pending,
    Provisioning,
    Ready,
    Failed,
}

public static class CloudCustomerSchema
{
    /// <summary>
    /// Version written by #396 when PostgreSQL customer databases were created
    /// with EnsureCreated and had no EF migration history.
    /// </summary>
    public const string LegacyCurrentModelV1 = "current-model-v1";

    /// <summary>The EF-generated PostgreSQL baseline for the #396 model.</summary>
    public const string BaselineMigrationId = "20260922170154_InitialCloudBaseline";

    /// <summary>
    /// Current PostgreSQL schema version. Control-plane schema state uses the
    /// exact latest EF migration id so operational tooling can correlate a
    /// tenant directly with the database migration history.
    /// </summary>
    public const string CurrentVersion = "20260922170207_EstablishCloudMigrationLifecycle";

    /// <summary>
    /// During the first migration rollout the application can safely serve the
    /// #396 schema, the EF baseline, or the current lifecycle marker because
    /// they have the same product-facing relational shape.
    ///
    /// Future schema changes must deliberately keep or narrow this bounded
    /// compatibility window.
    /// </summary>
    public static bool IsApplicationCompatible(string? version) =>
        version is LegacyCurrentModelV1
            or BaselineMigrationId
            or CurrentVersion;
}

/// <summary>
/// Control-plane metadata only. No books, notes, prompts, files, quotations or
/// other customer intellectual content belongs in this database.
/// </summary>
public sealed class CloudAccountResource
{
    public Guid AccountId { get; set; }
    public Guid ResourceId { get; set; }
    public string DatabaseName { get; set; } = string.Empty;
    public string StorageNamespace { get; set; } = string.Empty;

    public CloudProvisioningState ProvisioningState { get; set; } = CloudProvisioningState.Pending;
    public CloudAccountStatus AccountStatus { get; set; } = CloudAccountStatus.Unknown;

    public string? SchemaVersion { get; set; }
    public string? FailureCode { get; set; }

    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime? LastProvisionAttemptAtUtc { get; set; }
    public DateTime? ReadyAtUtc { get; set; }
}

public sealed record CloudAccountResourceSnapshot(
    NostosAccountId AccountId,
    Guid ResourceId,
    string DatabaseName,
    string StorageNamespace,
    CloudProvisioningState ProvisioningState,
    CloudAccountStatus AccountStatus,
    string? SchemaVersion,
    string? FailureCode,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    DateTime? LastProvisionAttemptAtUtc,
    DateTime? ReadyAtUtc)
{
    public bool IsReady =>
        ProvisioningState == CloudProvisioningState.Ready
        && AccountStatus == CloudAccountStatus.Active
        && CloudCustomerSchema.IsApplicationCompatible(SchemaVersion);
}
