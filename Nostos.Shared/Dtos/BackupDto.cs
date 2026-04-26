namespace Nostos.Shared.Dtos;

public record BackupStatusDto(
    bool IsEnabled,
    string Provider,
    DateTime? LastBackupAt,
    string? LastBackupStatus,
    bool IncludeBookFiles,
    int IntervalHours,
    int MaxBackups
);

public record BackupSettingsDto(
    bool IsEnabled,
    string Provider,
    bool IncludeBookFiles,
    int IntervalHours,
    int MaxBackups
);

public record UpdateBackupSettingsDto(
    bool? IsEnabled,
    string? Provider,
    bool? IncludeBookFiles,
    int? IntervalHours,
    int? MaxBackups
);

public record BackupHistoryDto(
    Guid Id,
    DateTime CreatedAt,
    long SizeBytes,
    string Provider,
    string Status,
    bool IncludeBookFiles,
    string? ErrorMessage
);

public record TriggerBackupResultDto(
    Guid Id,
    string Status,
    long SizeBytes,
    DateTime CreatedAt
);

public record RestoreResultDto(
    bool Success,
    string Message
);

public record BackupManifestDto(
    string Version,
    DateTime Timestamp,
    long DatabaseSizeBytes,
    int BookFileCount,
    long TotalSizeBytes,
    string Checksum
);

public record BackupProgressDto(
    bool IsRunning,
    string? CurrentStep,
    int PercentComplete,
    DateTime? StartedAt,
    int StepNumber,
    int TotalSteps
);