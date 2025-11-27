namespace Nostos.Backend.Data.Models;

public class NoteConceptModel
{
  public Guid NoteId { get; set; }
  public NoteModel Note { get; set; } = null!;

  public Guid ConceptId { get; set; }
  public ConceptModel Concept { get; set; } = null!;
}
