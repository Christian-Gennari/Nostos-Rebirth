using System;

namespace Nostos.Backend.Data.Models;

public class NoteModel
{
  public Guid Id { get; set; } = Guid.NewGuid();
  public Guid BookId { get; set; }
  public string Content { get; set; } = string.Empty;
}
