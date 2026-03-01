using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Data.Interfaces;

public interface IConceptRepository
{
    /// <summary>
    /// Returns all concepts with their usage count, ordered by usage desc then name asc.
    /// </summary>
    Task<List<ConceptDto>> GetAllWithUsageCountAsync();

    /// <summary>
    /// Gets a concept with its linked notes (deep includes for Book and Note data).
    /// Returns null if not found.
    /// </summary>
    Task<ConceptModel?> GetByIdWithNotesAsync(Guid id);

    // --- Methods for NoteProcessorService ---

    /// <summary>
    /// Finds existing concepts whose names match any in the given list (case-insensitive via DB collation).
    /// </summary>
    Task<List<ConceptModel>> GetByNamesAsync(IEnumerable<string> names);

    /// <summary>
    /// Stages new concepts for insertion (does NOT call SaveChanges).
    /// </summary>
    void AddRange(IEnumerable<ConceptModel> concepts);

    /// <summary>
    /// Removes all NoteConceptModel links for a given note.
    /// Loads then removes so changes stay in the current unit-of-work.
    /// </summary>
    Task ClearNoteLinksAsync(Guid noteId);

    /// <summary>
    /// Stages a single note–concept link for insertion (does NOT call SaveChanges).
    /// </summary>
    void AddNoteLink(NoteConceptModel link);

    // --- Method for ConceptCleanupWorker ---

    /// <summary>
    /// Bulk-deletes all concepts that have zero note links. Returns the count deleted.
    /// </summary>
    Task<int> DeleteOrphanedAsync(CancellationToken ct = default);
}
