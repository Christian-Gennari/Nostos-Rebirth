using System;

namespace Nostos.Backend.Data.Models;

public class ConceptModel
{
  public Guid Id { get; set; } = Guid.NewGuid();
  public string Concept { get; set; } = string.Empty;
}
