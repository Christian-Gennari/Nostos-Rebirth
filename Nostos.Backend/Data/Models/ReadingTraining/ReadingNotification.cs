namespace Nostos.Backend.Data.Models.ReadingTraining;

// Transactional notification outbox item (e.g. target-elapsed notice). Lease
// and acknowledgement timestamps allow at-least-once external delivery.
public class ReadingNotification
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Kind { get; set; } = string.Empty;
    public string PayloadJson { get; set; } = string.Empty;

    // Stable logical event key (e.g. "target-reached:{sessionId}"). The
    // unique index on DedupeKey makes enqueue idempotent: retries, restarts
    // and concurrent scanners can never produce more than one row per event.
    public string DedupeKey { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LeaseUntil { get; set; }
    public DateTime? AckedAt { get; set; }
}
