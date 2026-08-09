namespace Nostos.Backend.Data.Models.ReadingTraining;

// Immutable committed weekly review, unique per completed ISO week. Committed
// reviews are never rewritten by public commands; the three per-mode outcomes
// live in ReadingModeDecision rows.
public class ReadingWeeklyReview
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Completed ISO week key, e.g. "2026-W32".
    public string WeekKey { get; set; } = string.Empty;

    public DateTime CommittedAt { get; set; } = DateTime.UtcNow;

    // Programme StateVersion immediately after this review was committed, so
    // the persisted decision can be replayed against the state it saw.
    public string StateVersionAfter { get; set; } = string.Empty;

    // Completed effective minutes across all modes for this week, and for the
    // immediately previous ISO week (the volume-guard base; 0 when absent).
    public int TotalVolumeMinutes { get; set; }
    public int PreviousWeekVolumeMinutes { get; set; }

    public ICollection<ReadingModeDecision> Decisions { get; set; } = new List<ReadingModeDecision>();
}
