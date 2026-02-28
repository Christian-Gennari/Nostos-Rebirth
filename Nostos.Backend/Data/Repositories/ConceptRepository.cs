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
            .Concepts.Select(c => new ConceptDto(c.Id, c.Concept, c.NoteConcepts.Count()))
            .OrderByDescending(x => x.UsageCount)
            .ThenBy(x => x.Name)
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
}
