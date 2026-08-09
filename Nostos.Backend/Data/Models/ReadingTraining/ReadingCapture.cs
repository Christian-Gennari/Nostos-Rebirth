using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Models.ReadingTraining;

// A verbatim capture (thought, question, or bookmark) made during training.
// ExternalId is unique when present so a capture retried through an external
// gateway creates exactly one row.
public class ReadingCapture
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Text { get; set; } = string.Empty;
    public ReadingCaptureType Type { get; set; } = ReadingCaptureType.Thought;

    public Guid BookId { get; set; }
    public BookModel? Book { get; set; }

    public Guid? SessionId { get; set; }
    public ReadingSession? Session { get; set; }

    public string? ExternalId { get; set; }

    public bool Resolved { get; set; }
    public Guid? PromotedNoteId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
