namespace Nostos.Backend.Services;

public class BackupSettings
{
    public bool IsEnabled { get; set; } = false;
    public int IntervalHours { get; set; } = 168;
    public string Provider { get; set; } = "Local";
    public int MaxBackups { get; set; } = 3;
    public bool IncludeBookFiles { get; set; } = true;
}