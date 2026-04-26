using System.Text.Json;
using Microsoft.Extensions.Options;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services;

public class BackupSettingsProvider
{
    private readonly string _filePath;
    private readonly BackupSettings _defaults;
    private BackupSettings _current;
    private readonly object _lock = new();
    private int _maintenanceRefCount;
    private volatile BackupProgressDto? _progress;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public BackupSettingsProvider(IWebHostEnvironment env, IOptions<BackupSettings> defaults)
    {
        _filePath = Path.Combine(env.ContentRootPath, "backup-settings.json");
        _defaults = defaults.Value;
        _current = LoadFromFile() ?? CloneDefaults();
    }

    public BackupSettings Current
    {
        get
        {
            lock (_lock) { return _current; }
        }
    }

    public BackupSettings Update(Action<BackupSettings> apply)
    {
        lock (_lock)
        {
            apply(_current);
            PersistToFile();
            return _current;
        }
    }

    public bool IsInMaintenanceMode => Volatile.Read(ref _maintenanceRefCount) > 0;

    public BackupProgressDto? Progress => Volatile.Read(ref _progress);

    public void StartProgress(int totalSteps)
    {
        Volatile.Write(ref _progress, new BackupProgressDto(true, "Starting", 0, DateTime.UtcNow, 1, totalSteps));
    }

    public void UpdateProgress(string step, int percent, int stepNumber, int totalSteps)
    {
        var startedAt = Volatile.Read(ref _progress)?.StartedAt;
        Volatile.Write(ref _progress, new BackupProgressDto(true, step, percent, startedAt, stepNumber, totalSteps));
    }

    public void ClearProgress()
    {
        Volatile.Write(ref _progress, null);
    }

    public void EnterMaintenanceMode() => Interlocked.Increment(ref _maintenanceRefCount);

    public void ExitMaintenanceMode()
    {
        var newCount = Interlocked.Decrement(ref _maintenanceRefCount);
        if (newCount < 0)
        {
            Interlocked.Exchange(ref _maintenanceRefCount, 0);
            throw new InvalidOperationException("ExitMaintenanceMode called without matching EnterMaintenanceMode.");
        }
    }

    private BackupSettings? LoadFromFile()
    {
        if (!File.Exists(_filePath))
            return null;

        try
        {
            var json = File.ReadAllText(_filePath);
            return JsonSerializer.Deserialize<BackupSettings>(json, JsonOpts);
        }
        catch
        {
            return null;
        }
    }

    private void PersistToFile()
    {
        var json = JsonSerializer.Serialize(_current, JsonOpts);
        var tmpPath = _filePath + ".tmp";
        try
        {
            File.WriteAllText(tmpPath, json);
            File.Move(tmpPath, _filePath, overwrite: true);
        }
        catch
        {
            try { File.Delete(tmpPath); } catch { /* cleanup */ }
            throw;
        }
    }

    private BackupSettings CloneDefaults() => new()
    {
        IsEnabled = _defaults.IsEnabled,
        IntervalHours = _defaults.IntervalHours,
        Provider = _defaults.Provider,
        MaxBackups = _defaults.MaxBackups,
        IncludeBookFiles = _defaults.IncludeBookFiles,
    };
}