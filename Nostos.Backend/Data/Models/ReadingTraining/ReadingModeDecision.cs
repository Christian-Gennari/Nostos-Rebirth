using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Models.ReadingTraining;

// Immutable per-mode outcome row of a committed weekly review. Exactly three
// rows exist per review — one per ReadingMode — holding the full policy
// result for that mode's adaptation.
public class ReadingModeDecision
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid WeeklyReviewId { get; set; }
    public ReadingWeeklyReview? WeeklyReview { get; set; }

    public ReadingMode Mode { get; set; }

    public int TargetBeforeMinutes { get; set; }
    public int TargetAfterMinutes { get; set; }

    // "increase" | "hold" | "deload" | "consolidate".
    public string DecisionKind { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;

    // Evidence metrics behind the decision.
    public int QualifyingCount { get; set; }
    public double CompletionRate { get; set; }
    public int? MedianEffort { get; set; }
    public int? MedianFocus { get; set; }

    // Consecutive weekly increases the programme carries forward after this
    // week (the consolidation counter).
    public int NextConsecutiveIncreases { get; set; }
}
