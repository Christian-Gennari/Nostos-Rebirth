namespace Nostos.Backend.Data.Models;

public class BookModel
{
  public Guid Id { get; set; } = Guid.NewGuid();
  public string Title { get; set; } = string.Empty;
  public string? Author { get; set; }
  public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

  public bool HasFile { get; set; } = false;
  public string? FileName { get; set; }

  public string? CoverFileName { get; set; }
}
