using System.ComponentModel.DataAnnotations;

namespace Nostos.Backend.Data.Models;

public class NoteModel
{
  public Guid Id { get; set; } = Guid.NewGuid();

  [Required]
  public string Content { get; set; } = string.Empty;

  public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

  // Foreign Key
  public Guid BookId { get; set; }

  // NEW: Navigation Property
  public BookModel? Book { get; set; }

  // Navigation for Concepts
  public ICollection<NoteConceptModel> NoteConcepts { get; set; } = new List<NoteConceptModel>();
}
