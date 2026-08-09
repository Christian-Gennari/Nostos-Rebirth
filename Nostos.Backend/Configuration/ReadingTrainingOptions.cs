namespace Nostos.Backend.Configuration;

// Reading Training service configuration. Defaults mirror the v1 parity
// contract and are bound from the host's `ReadingTraining` configuration
// section while retaining these values as production-safe defaults.
public sealed class ReadingTrainingOptions
{
    // Week boundaries and session dates are computed in this IANA timezone.
    public string TimezoneId { get; set; } = "Europe/Stockholm";

    // An unanswered ratings prompt (or an active session older than this)
    // enters the stale-session recovery flow instead of accepting input.
    public int StaleAfterHours { get; set; } = 8;

    // Recovery sessions are planned in this minute range; they are always
    // volume-only (never progression evidence).
    public int RecoveryMinMinutes { get; set; } = 20;
    public int RecoveryMaxMinutes { get; set; } = 25;

    // Weekly adaptation step (deload reduction for endurance/deep planning).
    public int IncrementMinutes { get; set; } = 5;

    // Qualifying sessions required per week before a +5 increase may apply.
    public int QualificationThreshold { get; set; } = 3;

    // Calm polling interval (seconds) of the target-reached notification
    // scanner worker. The worker clamps the effective value to 1..300.
    public int NotificationPollSeconds { get; set; } = 15;
}
