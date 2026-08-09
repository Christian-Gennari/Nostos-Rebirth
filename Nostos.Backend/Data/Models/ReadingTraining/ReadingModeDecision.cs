namespace Nostos.Backend.Data.Models.ReadingTraining;

// Immutable evidence row contributing to a committed weekly review decision.
public class ReadingModeDecision
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid WeeklyReviewId { get; set; }
    public ReadingWeeklyReview? WeeklyReview { get; set; }

    public Guid? SessionId { get; set; }
    public ReadingSession? Session { get; set; }

    public int CompletedSeconds { get; set; }
    public bool Qualifies { get; set; }
    public bool IsEvidence { get; set; }
    public string? Note { get; set; }
}
