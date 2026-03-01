using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Data.Repositories;

public class ConceptRepository : IConceptRepository
{
    private readonly NostosDbContext _db;

    public ConceptRepository(NostosDbContext db)
    {
        _db = db;
    }

    public async Task<List<ConceptDto>> GetAllWithUsageCountAsync()
    {
        return await _db
            .Concepts.OrderByDescending(c => c.NoteConcepts.Count())
            .ThenBy(c => c.Concept)
            .Select(c => new ConceptDto(c.Id, c.Concept, c.NoteConcepts.Count()))
            .ToListAsync();
    }

    public async Task<ConceptModel?> GetByIdWithNotesAsync(Guid id)
    {
        return await _db
            .Concepts.Include(c => c.NoteConcepts)
            .ThenInclude(nc => nc.Note)
            .ThenInclude(n => n.Book)
            .FirstOrDefaultAsync(c => c.Id == id);
    }

    // --- Methods for NoteProcessorService ---

    public async Task<List<ConceptModel>> GetByNamesAsync(IEnumerable<string> names)
    {
        var nameList = names.ToList();
        return await _db.Concepts
            .Where(c => nameList.Contains(c.Concept))
            .ToListAsync();
    }

    public void AddRange(IEnumerable<ConceptModel> concepts)
    {
        _db.Concepts.AddRange(concepts);
    }

    public async Task ClearNoteLinksAsync(Guid noteId)
    {
        var currentLinks = await _db.NoteConcepts
            .Where(nc => nc.NoteId == noteId)
            .ToListAsync();

        if (currentLinks.Count != 0)
        {
            _db.NoteConcepts.RemoveRange(currentLinks);
        }
    }

    public void AddNoteLink(NoteConceptModel link)
    {
        _db.NoteConcepts.Add(link);
    }

    // --- Method for ConceptCleanupWorker ---

    public async Task<int> DeleteOrphanedAsync(CancellationToken ct = default)
    {
        return await _db.Concepts
            .Where(c => !c.NoteConcepts.Any())
            .ExecuteDeleteAsync(ct);
    }
}
