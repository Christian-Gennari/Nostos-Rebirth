using System;
using System.ComponentModel.DataAnnotations;

namespace Nostos.Backend.Data.Models;

public class BookModel
{
  public Guid Id { get; set; } = Guid.NewGuid();

  [Required]
  public string Title { get; set; } = string.Empty;
  public string? Subtitle { get; set; }

  public string? Author { get; set; } // Supports "Author 1, Author 2"

  public string? Description { get; set; }
  public string? Isbn { get; set; }
  public string? Publisher { get; set; }
  public string? PublishedDate { get; set; }
  public int? PageCount { get; set; }

  public string? Language { get; set; }
  public string? Categories { get; set; }

  // Series Metadata
  public string? Series { get; set; }
  public string? VolumeNumber { get; set; }

  public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

  // File Management
  public bool HasFile { get; set; } = false;
  public string? FileName { get; set; }
  public string? CoverFileName { get; set; }

  // Relationships
  public Guid? CollectionId { get; set; }
  public CollectionModel? Collection { get; set; }

  // Reading Progress
  public string? LastLocation { get; set; } // CFI (EPUB), Page Number (PDF), or Timestamp (Audio)
  public int ProgressPercent { get; set; } = 0;
}
