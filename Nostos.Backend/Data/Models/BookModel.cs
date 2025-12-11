using System;
using System.ComponentModel.DataAnnotations;

namespace Nostos.Backend.Data.Models;

public abstract class BookModel
{
  public Guid Id { get; set; } = Guid.NewGuid();

  [Required]
  public string Title { get; set; } = string.Empty;

  // --- AUTHORSHIP & CONTRIBUTIONS ---
  public string? Author { get; set; }
  public string? Editor { get; set; }     // Required for Harvard "Edited by"
  public string? Translator { get; set; }
  public string? Subtitle { get; set; }
  public string? Description { get; set; } // The official book blurb

  // --- PUBLICATION METADATA ---
  public string? Publisher { get; set; }
  public string? PlaceOfPublication { get; set; } // Required for Harvard (e.g., "London")
  public string? PublishedDate { get; set; }
  public string? Language { get; set; }
  public string? Categories { get; set; }
  public string? Edition { get; set; }

  // --- EDITION & SERIES INFO ---
  public string? Series { get; set; }
  public string? VolumeNumber { get; set; }

  public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

  // --- FILE MANAGEMENT ---
  public bool HasFile { get; set; } = false;
  public string? FileName { get; set; }
  public string? CoverFileName { get; set; }

  // --- RELATIONSHIPS ---
  public Guid? CollectionId { get; set; }
  public CollectionModel? Collection { get; set; }

  // --- READING PROGRESS ---
  public string? LastLocation { get; set; } // CFI (EPUB), Page Number (PDF), or Timestamp (Audio)
  public int ProgressPercent { get; set; } = 0;

  // --- USER INTERACTION ---
  [Range(0, 5)]
  public int Rating { get; set; } = 0;

  public bool IsFavorite { get; set; } = false;

  public string? PersonalReview { get; set; } // Short personal reviews

  // <--- NEW: Track when the book was last opened/read
  public DateTime? LastReadAt { get; set; }

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
  public string? Narrator { get; set; } // e.g. "John Doe"
}
