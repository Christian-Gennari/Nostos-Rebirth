using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Models.ReadingTraining;

// A single training session. At most one session may be open globally at a
// time: OpenSlot holds a constant sentinel while the session is open (Planned,
// Active, Paused, AwaitingFeedback) and is NULL otherwise; the unique index
// and the CK_ReadingSessions_OpenSlot_Matches_Status check therefore enforce
// the single global open slot.
public class ReadingSession
{
    // Value placed in OpenSlot while this session occupies the global open
    // slot. The unique index on OpenSlot then allows at most one open session;
    // the status/slot correlation is enforced by a CHECK constraint.
    public const int OpenSentinel = 0;

    public Guid Id { get; set; } = Guid.NewGuid();

    // Nullable: historical sessions imported from the legacy Hermes data may
    // predate any queue assignment for their book (the session survives with
    // a null assignment link).
    public Guid? BookAssignmentId { get; set; }
    public ReadingBookAssignment? BookAssignment { get; set; }

    // Denormalised to the Nostos book for querying and capture linking.
    public Guid BookId { get; set; }
    public BookModel? Book { get; set; }

    public ReadingMode Mode { get; set; }
    public ReadingSessionStatus Status { get; set; } = ReadingSessionStatus.Idle;

    // Nullable sentinel: non-null while this session occupies the global open slot.
    public int? OpenSlot { get; set; }

    public int TargetMinutes { get; set; }

    // Established sustainable target for the mode at plan time (the base the
    // weekly review later adapts). Kept on the session so replies such as
    // "Stay at {planned} minutes for now" remain faithful even after the
    // programme targets change in a later review.
    public int PlannedTargetMinutes { get; set; }

    public ReadingConstraint Constraint { get; set; } = ReadingConstraint.None;

    public DateTime PlannedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? LastStartedAt { get; set; }
    public DateTime? PausedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    // When the session entered AwaitingFeedback (the ratings prompt was
    // issued). Drives the stale-session recovery flow; null until then.
    public DateTime? RatingRequestedAt { get; set; }

    // Elapsed seconds excluding pauses (the training evidence).
    public int AccumulatedSeconds { get; set; }

    // Wall-clock measured seconds including pauses (restart-safe).
    public int MeasuredSeconds { get; set; }

    // User-reported minutes override; measured seconds are preserved.
    public int? ReportedMinutes { get; set; }

    public int Effort { get; set; }
    public int Focus { get; set; }
    public int? Rating { get; set; }
    public bool RatingsSkipped { get; set; }

    // Target-elapsed notice delivered to the outbox exactly once.
    public bool NoticeSent { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
