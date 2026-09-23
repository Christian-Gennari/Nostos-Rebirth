namespace Nostos.Backend.Configuration;

/// <summary>
/// Configuration for nightly per-customer Cloud operational backups.
///
/// The schedule is disabled in SelfHosted mode and defaults to enabled in Cloud
/// mode. Times are always UTC, so DST does not affect the occurrence.
/// </summary>
public sealed class CloudRecoveryScheduleOptions
{
    public bool Enabled { get; set; } = true;
    public int HourUtc { get; set; } = 0;
    public int MinuteUtc { get; set; } = 30;

    public static CloudRecoveryScheduleOptions FromConfiguration(IConfiguration configuration)
    {
        var options = new CloudRecoveryScheduleOptions();
        configuration.GetSection("CloudRecoverySchedule").Bind(options);

        if (options.HourUtc is < 0 or > 23)
        {
            throw new InvalidOperationException(
                $"CloudRecoverySchedule:HourUtc must be between 0 and 23, but was {options.HourUtc}.");
        }

        if (options.MinuteUtc is < 0 or > 59)
        {
            throw new InvalidOperationException(
                $"CloudRecoverySchedule:MinuteUtc must be between 0 and 59, but was {options.MinuteUtc}.");
        }

        return options;
    }

    /// <summary>
    /// Computes the next scheduled backup occurrence after the given UTC instant.
    /// Returns null when the schedule is disabled.
    /// </summary>
    public DateTimeOffset? NextOccurrence(DateTimeOffset nowUtc)
    {
        if (!Enabled)
            return null;

        var today = new DateTimeOffset(
            nowUtc.Year,
            nowUtc.Month,
            nowUtc.Day,
            HourUtc,
            MinuteUtc,
            0,
            TimeSpan.Zero);

        return today > nowUtc ? today : today.AddDays(1);
    }
}
