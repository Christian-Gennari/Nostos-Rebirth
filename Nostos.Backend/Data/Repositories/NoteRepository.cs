using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data.Repositories;

public class NoteRepository : INoteRepository
{
    private readonly NostosDbContext _db;

    public NoteRepository(NostosDbContext db)
    {
        _db = db;
    }

    public async Task<List<NoteModel>> GetByBookIdAsync(Guid bookId)
    {
        return await _db.Notes.Include(n => n.Book).Where(n => n.BookId == bookId).ToListAsync();
    }

    public async Task<NoteModel?> GetByIdAsync(Guid id)
    {
        return await _db.Notes.FindAsync(id);
    }

    public async Task<NoteModel?> GetByIdWithConceptsAsync(Guid id)
    {
        return await _db
            .Notes.Include(n => n.NoteConcepts)
            .Include(n => n.Book)
            .FirstOrDefaultAsync(n => n.Id == id);
    }

    public async Task<NoteModel?> GetByIdWithBookAsync(Guid id)
    {
        return await _db
            .Notes.AsNoTracking()
            .Include(n => n.Book)
            .FirstOrDefaultAsync(n => n.Id == id);
    }

    public async Task AddAsync(NoteModel note)
    {
        _db.Notes.Add(note);
        // Don't save here — the endpoint calls ProcessNoteAsync first, then saves
    }

    public async Task SaveChangesAsync()
    {
        await _db.SaveChangesAsync();
    }

    public async Task DeleteAsync(NoteModel note)
    {
        _db.Notes.Remove(note);
        await _db.SaveChangesAsync();
    }

    public async Task DeleteConceptLinksAsync(Guid noteId)
    {
        await _db.NoteConcepts.Where(nc => nc.NoteId == noteId).ExecuteDeleteAsync();
    }
}
