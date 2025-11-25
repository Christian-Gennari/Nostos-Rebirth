using System;

namespace Nostos.Backend.Data.Models;

public class BookModel
{
  public Guid Id { get; set; } = Guid.NewGuid();
  public string Title { get; set; } = string.Empty;
  public string? Author { get; set; }
  public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
