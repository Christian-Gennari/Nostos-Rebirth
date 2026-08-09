namespace Nostos.Backend.Data.Models.ReadingTraining;

// Immutable committed weekly review decision, unique per completed ISO week
// and mode. Committed reviews are never rewritten by public commands.
public class ReadingWeeklyReview
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Completed ISO week key, e.g. "2026-W32".
    public string WeekKey { get; set; } = string.Empty;
    public Nostos.Shared.Enums.ReadingMode Mode { get; set; }

    public DateTime CommittedAt { get; set; } = DateTime.UtcNow;

    public int TargetBeforeMinutes { get; set; }
    public int TargetAfterMinutes { get; set; }

    // Promote / Hold / Deload / Consolidate.
    public string DecisionKind { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;

    public ICollection<ReadingModeDecision> Decisions { get; set; } = new List<ReadingModeDecision>();
}
