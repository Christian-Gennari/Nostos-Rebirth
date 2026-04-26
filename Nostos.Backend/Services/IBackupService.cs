using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services;

public interface IBackupService
{
    Task<BackupStatusDto> GetStatusAsync();
    Task<BackupSettingsDto> GetSettingsAsync();
    Task<BackupSettingsDto> UpdateSettingsAsync(UpdateBackupSettingsDto dto);
    Task<TriggerBackupResultDto> CreateBackupAsync(CancellationToken ct = default);
    Task<RestoreResultDto> RestoreBackupAsync(Guid backupId, CancellationToken ct = default);
    Task<List<BackupHistoryDto>> GetHistoryAsync();
    Task DeleteBackupRecordAsync(Guid id);
    string? GetLocalArchivePath(Guid id);
    Task<List<BackupHistoryDto>> ImportExistingBackupsAsync(CancellationToken ct = default);
}