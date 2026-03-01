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
}
