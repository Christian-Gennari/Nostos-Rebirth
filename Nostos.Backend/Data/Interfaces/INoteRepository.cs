using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data.Interfaces;

public interface INoteRepository
{
    Task<List<NoteModel>> GetByBookIdAsync(Guid bookId);
    Task<NoteModel?> GetByIdAsync(Guid id);

    /// <summary>
    /// Gets a note with its NoteConcepts and Book eagerly loaded (for update/re-processing).
    /// </summary>
    Task<NoteModel?> GetByIdWithConceptsAsync(Guid id);

    /// <summary>
    /// Gets a note with its Book eagerly loaded (for building the response DTO after create).
    /// </summary>
    Task<NoteModel?> GetByIdWithBookAsync(Guid id);

    Task AddAsync(NoteModel note);
    Task SaveChangesAsync();
    Task DeleteAsync(NoteModel note);

    /// <summary>
    /// Bulk-deletes all NoteConceptModel links for a given note.
    /// </summary>
    Task DeleteConceptLinksAsync(Guid noteId);
    /// <summary>
    /// Notes whose text, quote or book title matches `query` (issue #158). Case is
    /// ignored; the caller caps the row count.
    /// </summary>
    Task<List<NoteModel>> SearchByTextAsync(string query, int limit);

    /// <summary>
    /// Notes linked to no concept at all. These are unreachable through the index's
    /// concept rows, which is the gap #158 was filed about.
    /// </summary>
    Task<List<NoteModel>> GetWithoutConceptsAsync(int limit, int offset);

    /// <summary>
    /// How many notes are linked to no concept right now. The unlinked-note review
    /// queue traverses the whole set, so a page on its own would silently imply
    /// that the page IS the set (issue #256).
    /// </summary>
    Task<int> CountWithoutConceptsAsync();

}
