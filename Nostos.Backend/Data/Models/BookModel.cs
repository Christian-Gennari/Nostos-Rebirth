using System;
using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore; // Required for [Owned]

namespace Nostos.Backend.Data.Models;

public abstract class BookModel
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string Title { get; set; } = string.Empty;

    // We keep Author on the root as it's a primary query field
    public string? Author { get; set; }

    // --- 1. Publication Metadata (Grouped) ---
    public BookMetadata Metadata { get; set; } = new();

    // --- 2. Reading Progress & User State (Grouped) ---
    public ReadingProgress Progress { get; set; } = new();

    // --- 3. File System Info (Grouped) ---
    public FileInfoDetails FileDetails { get; set; } = new();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // --- RELATIONSHIPS ---
    public Guid? CollectionId { get; set; }
    public CollectionModel? Collection { get; set; }
}

// --- NEW OWNED TYPES ---

[Owned]
public class BookMetadata
{
    public string? Subtitle { get; set; }
    public string? Description { get; set; } // The official book blurb
    public string? Editor { get; set; }
    public string? Translator { get; set; }
    public string? Publisher { get; set; }
    public string? PlaceOfPublication { get; set; }
    public string? PublishedDate { get; set; }
    public string? Language { get; set; }
    public string? Categories { get; set; }
    public string? Edition { get; set; }
    public string? Series { get; set; }
    public string? VolumeNumber { get; set; }
}

[Owned]
public class ReadingProgress
{
    public string? LastLocation { get; set; } // CFI, Page, or Timestamp
    public int ProgressPercent { get; set; } = 0;

    [Range(0, 5)]
    public int Rating { get; set; } = 0;
    public bool IsFavorite { get; set; } = false;
    public string? PersonalReview { get; set; }

    public DateTime? LastReadAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

[Owned]
public class FileInfoDetails
{
    public bool HasFile { get; set; } = false;
    public string? FileName { get; set; }
    public string? CoverFileName { get; set; }

    // Store chapters as a JSON string
    public string? ChaptersJson { get; set; }

    // Store epub.js locations (heavy JSON string) (For instant calculation of progress state, cache basically)
    public string? LocationsJson { get; set; }
}

// --- SUBCLASSES (Remain mostly the same) ---

public class PhysicalBookModel : BookModel
{
    public string? Isbn { get; set; }
    public int? PageCount { get; set; }
}

public class EBookModel : BookModel
{
    public string? Isbn { get; set; }
    public int? PageCount { get; set; }
}

public class AudioBookModel : BookModel
{
    public string? Asin { get; set; }
    public string? Duration { get; set; }
    public string? Narrator { get; set; }
}
