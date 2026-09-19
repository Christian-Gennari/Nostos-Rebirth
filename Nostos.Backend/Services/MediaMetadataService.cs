using System.Text.Json;
using ATL; // Library for Audio/Metadata extraction
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Services;

public class MediaMetadataService
{
    private readonly ILogger<MediaMetadataService> _logger;

    public MediaMetadataService(ILogger<MediaMetadataService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Extracts chapters and duration from the file and updates the BookModel.
    /// Returns true if metadata was successfully updated.
    /// </summary>
    public bool EnrichBookMetadata(BookModel book, string filePath)
    {
        if (!File.Exists(filePath))
        {
            _logger.LogWarning("File not found for metadata extraction: {FilePath}", filePath);
            return false;
        }

        try
        {
            var track = new Track(filePath);

            // 1. Extract Chapters
            if (track.Chapters != null && track.Chapters.Count > 0)
            {
                var chapters = track
                    .Chapters.Select(c => new
                    {
                        Title = c.Title,
                        // ATL uses milliseconds, convert to seconds for frontend compatibility
                        StartTime = c.StartTime / 1000.0,
                    })
                    .ToList();

                // Serialize to the new Owned Type location
                book.FileDetails.ChaptersJson = JsonSerializer.Serialize(chapters);
            }

            // 2. Extract Duration (Audiobooks only)
            if (
                book is AudioBookModel audioBook
                && string.IsNullOrEmpty(audioBook.Duration)
                && track.Duration > 0
            )
            {
                var t = TimeSpan.FromSeconds(track.Duration);
                // Format: 12:30:45
                audioBook.Duration = t.ToString(@"hh\:mm\:ss");
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to extract metadata for book {BookId}", book.Id);
            // We return false but don't throw, so the upload itself doesn't fail
            return false;
        }
    }
}
