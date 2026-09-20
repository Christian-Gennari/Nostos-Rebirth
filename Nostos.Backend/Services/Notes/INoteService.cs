using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.Notes;

/// <summary>
/// Canonical note domain service. The REST endpoints call this one service;
/// note creation/update/delete semantics (including <c>[[WikiLink]]</c> concept
/// processing) live here, never in a handler, mirroring <c>ILibraryService</c>
/// for the library.
/// </summary>
public interface INoteService
{
    Task<IReadOnlyList<NoteDto>> GetByBookAsync(Guid bookId, CancellationToken ct = default);
    Task<NoteSearchPageDto> GetUnlinkedAsync(int limit, int offset, CancellationToken ct = default);
    Task<IReadOnlyList<NoteSearchHitDto>> SearchAsync(string query, int limit, CancellationToken ct = default);

    Task<NoteCommandResult<NoteDto>> CreateAsync(Guid bookId, CreateNoteDto dto, CancellationToken ct = default);
    Task<NoteCommandResult<NoteDto>> UpdateAsync(Guid noteId, UpdateNoteDto dto, CancellationToken ct = default);
    Task<NoteCommandResult<bool>> DeleteAsync(Guid noteId, CancellationToken ct = default);

    Task<NoteCommandResult<NoteDto>> LinkToExistingConceptAsync(Guid noteId, Guid conceptId, CancellationToken ct = default);
    Task<NoteReviewDto?> GetForReviewAsync(Guid noteId, CancellationToken ct = default);
}
