using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services.Notes;

/// <summary>
/// Canonical note service (issue #260 §1, §5). Owns every note write —
/// including concept processing — so an endpoint (or a future assistant
/// capability) can never orchestrate the repositories itself. The scoped
/// <see cref="NostosDbContext"/> is shared with the repositories and the
/// <see cref="NoteProcessorService"/>, so a create/update stays one unit of
/// work exactly as it did when the handler held the repositories.
/// </summary>
public sealed class NoteService : INoteService
{
    private readonly INoteRepository _notes;
    private readonly IBookRepository _books;
    private readonly IConceptRepository _concepts;
    private readonly NoteProcessorService _processor;
    private readonly NostosDbContext _db;

    public NoteService(
        INoteRepository notes,
        IBookRepository books,
        IConceptRepository concepts,
        NoteProcessorService processor,
        NostosDbContext db)
    {
        _notes = notes;
        _books = books;
        _concepts = concepts;
        _processor = processor;
        _db = db;
    }

    // ------------------------------------------------------------------
    // Read-only
    // ------------------------------------------------------------------

    public async Task<IReadOnlyList<NoteDto>> GetByBookAsync(Guid bookId, CancellationToken ct = default)
    {
        var notes = await _notes.GetByBookIdAsync(bookId);
        return notes.Select(n => n.ToDto()).ToList();
    }

    public async Task<NoteSearchPageDto> GetUnlinkedAsync(int limit, int offset, CancellationToken ct = default)
    {
        var take = Clamp(limit);
        var skip = Math.Max(offset, 0);
        var total = await _notes.CountWithoutConceptsAsync();
        var notes = await _notes.GetWithoutConceptsAsync(take, skip);
        return new NoteSearchPageDto(notes.Select(n => ByText(n, null)).ToList(), total, skip, take);
    }

    public async Task<IReadOnlyList<NoteSearchHitDto>> SearchAsync(string query, int limit, CancellationToken ct = default)
    {
        var hits = await _notes.SearchByTextAsync(query, Clamp(limit));
        var term = query.Trim();
        return hits.Select(n => ByText(n, term)).ToList();
    }

    // ------------------------------------------------------------------
    // Mutations
    // ------------------------------------------------------------------

    public async Task<NoteCommandResult<NoteDto>> CreateAsync(Guid bookId, CreateNoteDto dto, CancellationToken ct = default)
    {
        var book = await _books.GetByIdAsync(bookId);
        if (book is null)
            return NoteCommandResult<NoteDto>.Fail(
                NoteErrorCodes.BookNotFound, $"Book {bookId} not found.");

        if (string.IsNullOrWhiteSpace(dto.Content) && string.IsNullOrWhiteSpace(dto.SelectedText))
            return NoteCommandResult<NoteDto>.Fail(
                NoteErrorCodes.EmptyNote, "Note must have content or selected text.");

        var model = dto.ToModel(bookId);

        await _notes.AddAsync(model);

        // EF Core tracks 'model', so the processor can add links to it before we save.
        await _processor.ProcessNoteAsync(model);

        await _notes.SaveChangesAsync();

        // Reload to get the Book Title for the response.
        var createdNote = await _notes.GetByIdWithBookAsync(model.Id);

        return NoteCommandResult<NoteDto>.Ok(createdNote!.ToDto());
    }

    public async Task<NoteCommandResult<NoteDto>> UpdateAsync(Guid noteId, UpdateNoteDto dto, CancellationToken ct = default)
    {
        var existing = await _notes.GetByIdWithConceptsAsync(noteId);
        if (existing is null)
            return NoteCommandResult<NoteDto>.Fail(NoteErrorCodes.NoteNotFound, "Note not found.");

        existing.Apply(dto);

        // Re-process concepts (the processor clears old links then re-adds).
        await _processor.ProcessNoteAsync(existing);

        await _notes.SaveChangesAsync();

        return NoteCommandResult<NoteDto>.Ok(existing.ToDto());
    }

    public async Task<NoteCommandResult<bool>> DeleteAsync(Guid noteId, CancellationToken ct = default)
    {
        var existing = await _notes.GetByIdAsync(noteId);
        if (existing is null)
            return NoteCommandResult<bool>.Fail(NoteErrorCodes.NoteNotFound, "Note not found.");

        // Remove concept links first: the join table's note FK is Restrict.
        await _notes.DeleteConceptLinksAsync(noteId);

        await _notes.DeleteAsync(existing);

        return NoteCommandResult<bool>.Ok(true);
    }

    // ------------------------------------------------------------------
    // Capabilities for the note-review flow (issue #261)
    // ------------------------------------------------------------------

    public async Task<NoteCommandResult<NoteDto>> LinkToExistingConceptAsync(
        Guid noteId,
        Guid conceptId,
        CancellationToken ct = default)
    {
        var note = await _notes.GetByIdWithConceptsAsync(noteId);
        if (note is null)
            return NoteCommandResult<NoteDto>.Fail(NoteErrorCodes.NoteNotFound, "Note not found.");

        // Never creates a concept: the link target must already exist.
        var conceptExists = await _db.Concepts.AnyAsync(c => c.Id == conceptId, ct);
        if (!conceptExists)
            return NoteCommandResult<NoteDto>.Fail(NoteErrorCodes.ConceptNotFound, "Concept not found.");

        // Idempotent. The join is keyed (NoteId, ConceptId); inserting a second
        // row would be a duplicate key. The check runs against the database, not
        // the tracked navigation, so a repeated call sees the committed link.
        var alreadyLinked = await _db.NoteConcepts
            .AsNoTracking()
            .AnyAsync(nc => nc.NoteId == noteId && nc.ConceptId == conceptId, ct);

        if (!alreadyLinked)
        {
            // Reuse the canonical join and never clear the note's other links.
            _concepts.AddNoteLink(new NoteConceptModel { NoteId = noteId, ConceptId = conceptId });
            await _notes.SaveChangesAsync();
        }

        return NoteCommandResult<NoteDto>.Ok(note.ToDto());
    }

    public async Task<NoteReviewDto?> GetForReviewAsync(Guid noteId, CancellationToken ct = default)
    {
        var note = await _db.Notes
            .AsNoTracking()
            .Include(n => n.Book)
            .Include(n => n.NoteConcepts)
            .ThenInclude(nc => nc.Concept)
            .FirstOrDefaultAsync(n => n.Id == noteId, ct);

        if (note is null)
            return null;

        return new NoteReviewDto(
            note.Id,
            note.BookId,
            note.Book?.Title,
            note.Content,
            note.SelectedText,
            note.NoteConcepts
                .Where(nc => nc.Concept is not null)
                .Select(nc => nc.Concept!.Concept)
                .OrderBy(name => name)
                .ToList());
    }

    // ------------------------------------------------------------------
    // Helpers moved verbatim from NotesEndpoints
    // ------------------------------------------------------------------

    /// <summary>A small page keeps the index responsive; the cap is a guard on the caller.</summary>
    private static int Clamp(int limit) => Math.Clamp(limit, 1, 200);

    private static NoteSearchHitDto ByText(NoteModel n, string? term) => new(
        n.Id,
        n.BookId,
        n.Book?.Title,
        n.Content,
        n.SelectedText,
        Snippet(n.Content, n.SelectedText, term),
        n.NoteConcepts
            .Where(nc => nc.Concept != null)
            .Select(nc => nc.Concept!.Concept)
            .OrderBy(name => name)
            .ToList(),
        n.CreatedAt);

    /// <summary>
    /// The fragment around the match, so a row can show WHY it matched. Built here
    /// rather than in the client so the whole note body never has to travel.
    /// </summary>
    private static string? Snippet(string content, string? quote, string? term)
    {
        // Prefer the quotation: it is the passage from the book either way.
        var text = string.IsNullOrWhiteSpace(quote) ? content : quote!;
        if (string.IsNullOrWhiteSpace(text)) return null;

        var flat = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (flat.Length <= 160) return flat;

        // Centre on the match when there is one, so the row shows WHY it matched
        // rather than the opening words of every hit.
        var at = term is null ? -1 : flat.IndexOf(term, StringComparison.OrdinalIgnoreCase);
        if (at < 0) return flat[..157] + "…";

        var start = Math.Max(0, at - 60);
        var end = Math.Min(flat.Length, start + 157);
        start = Math.Max(0, Math.Min(start, end - 40));
        return (start > 0 ? "…" : string.Empty) + flat[start..end] + (end < flat.Length ? "…" : string.Empty);
    }
}
