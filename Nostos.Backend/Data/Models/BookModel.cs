using System;
using System.ComponentModel.DataAnnotations;

namespace Nostos.Backend.Data.Models;

public abstract class BookModel
{
  public Guid Id { get; set; } = Guid.NewGuid();

  [Required]
  public string Title { get; set; } = string.Empty;

  public string? Author { get; set; }
  public string? Subtitle { get; set; }
  public string? Description { get; set; }

  // Common Metadata
  public string? Publisher { get; set; }
  public string? PublishedDate { get; set; }
  public string? Language { get; set; }
  public string? Categories { get; set; }
  public string? Edition { get; set; }


  // Edition & Series Info
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

  [Range(0, 5)]
  public int Rating { get; set; } = 0;

  public bool IsFavorite { get; set; } = false;

  // If FinishedAt is not null, the book is "Finished"
  public DateTime? FinishedAt { get; set; }
  

}


// ACTUAL SUBCLASSES FOR SPECIFIC BOOK TYPES
public class PhysicalBookModel : BookModel
{
  public string? Isbn { get; set; }
  public int? PageCount { get; set; }
}

public class EBookModel : BookModel
{
  // E-books might define page count differently (or not at all),
  // but often use ISBNs too.
  public string? Isbn { get; set; }
  public int? PageCount { get; set; }
}

public class AudioBookModel : BookModel
{
  public string? Asin { get; set; } // Amazon Standard ID
  public string? Duration { get; set; } // e.g. "12:30:15"
}
