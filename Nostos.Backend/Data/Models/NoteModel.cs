// Nostos.Backend/Data/Models/NoteModel.cs
using System.ComponentModel.DataAnnotations;

namespace Nostos.Backend.Data.Models;

public class NoteModel
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string Content { get; set; } = string.Empty; // User's written note (if any)

    public string? CfiRange { get; set; }     // <--- NEW: e.g. "epubcfi(/6/4...)"
    public string? SelectedText { get; set; } // <--- NEW: The actual text from the book

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Guid BookId { get; set; }
    public BookModel? Book { get; set; }

    public ICollection<NoteConceptModel> NoteConcepts { get; set; } = new List<NoteConceptModel>();

    // --- ASSISTANT CAPTURE PROVENANCE (issue #260 §2, §4) ---
    // Appended only: existing columns above are the note itself and must not
    // change. These columns record where a captured note came from and how it
    // was processed, so the verbatim capture can be kept alongside a polished
    // `Content`. Defaults describe a plain typed note, which is what every
    // pre-existing row is.

    // Null = no separate raw capture was kept.
    public string? RawContent { get; set; }

    // text | voice | import
    public string CaptureSource { get; set; } = "text";

    // verbatim | light_polish | clarify
    public string ProcessingMode { get; set; } = "verbatim";

    // epub_cfi | pdf_page | audio_timestamp | physical_page | external_audio_timestamp | unknown
    public string SourceAnchorKind { get; set; } = "unknown";

    public string? SourceAnchorValue { get; set; }

    public bool AnchorVerified { get; set; }
}
