namespace Nostos.Backend.Data.Models.ReadingTraining;

// Singleton policy row. Exactly one row is enforced by the unique index on
// SingletonSlot plus the CK_ReadingProgrammes_SingletonSlot check; the fixed
// Id lets the service address the singleton directly.
public class ReadingProgramme
{
    public static readonly Guid WellKnownId = new("8F7D3C1A-5B2E-4F4A-9C6D-1E2F3A4B5C6D");

    // Fixed sentinel for the unique singleton index; must be non-null and
    // constant. Enforced by a CHECK constraint so a wrong value is rejected.
    public const int SingletonSentinel = 1;

    public Guid Id { get; set; } = WellKnownId;

    // Sentinel for the unique singleton index; must be non-null and constant.
    public int SingletonSlot { get; set; } = SingletonSentinel;

    public string TimezoneId { get; set; } = "Europe/Stockholm";

    public string StateVersion { get; set; } = "0";

    // Sustainable targets per mode.
    public int EnduranceTargetMinutes { get; set; } = 40;
    public int DeepTargetMinutes { get; set; } = 30;
    public int RecoveryTargetMinutes { get; set; } = 20;

    // Established targets used as the base for weekly adaptation.
    public int EnduranceEstablishedMinutes { get; set; } = 40;
    public int DeepEstablishedMinutes { get; set; } = 30;
    public int RecoveryEstablishedMinutes { get; set; } = 20;

    // Consecutive weekly increases carried per mode (Recovery never increases
    // and has no counter). Two consecutive increases make the next
    // otherwise-good week a consolidation hold.
    public int EnduranceConsecutiveIncreases { get; set; }
    public int DeepConsecutiveIncreases { get; set; }

    public bool DeloadActive { get; set; }
    public DateTime? DeloadStartedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
