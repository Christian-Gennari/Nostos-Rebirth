using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Models.ReadingTraining;

// A book assigned to a training mode. Multiple assignments per mode are
// allowed. At most one assignment per mode is the default: DefaultSlot holds
// the (int)mode sentinel for the default assignment and is NULL otherwise;
// the unique index therefore allows exactly one default per mode.
public class ReadingBookAssignment
{
    // Value placed in DefaultSlot to mark this assignment as the default for
    // its mode. The unique index on DefaultSlot then allows one default per mode.
    public static int DefaultSentinelFor(ReadingMode mode) => (int)mode;

    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid BookId { get; set; }
    public BookModel? Book { get; set; }

    public ReadingMode Mode { get; set; }
    public ReadingAssignmentStatus Status { get; set; } = ReadingAssignmentStatus.Active;

    public int QueueOrder { get; set; }

    // Nullable sentinel: (int)Mode when this assignment is the mode default.
    public int? DefaultSlot { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
