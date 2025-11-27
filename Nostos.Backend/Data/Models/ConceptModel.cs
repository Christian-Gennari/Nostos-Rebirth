namespace Nostos.Backend.Data.Models;

public class ConceptModel
{
  public Guid Id { get; set; } = Guid.NewGuid();
  public string Concept { get; set; } = string.Empty;

  // NEW: Allow us to check if this concept is used anywhere
  public ICollection<NoteConceptModel> NoteConcepts { get; set; } = [];
}
