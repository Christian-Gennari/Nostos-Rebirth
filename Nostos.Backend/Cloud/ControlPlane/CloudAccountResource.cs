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
    /// Temporary baseline identifier for the current-model schema created by
    /// #396. Issue #398 replaces this bootstrap with the permanent
    /// PostgreSQL migration/baseline lifecycle.
    /// </summary>
    public const string CurrentVersion = "current-model-v1";
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
        && string.Equals(SchemaVersion, CloudCustomerSchema.CurrentVersion, StringComparison.Ordinal);
}
