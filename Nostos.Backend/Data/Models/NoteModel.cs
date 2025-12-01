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
}
