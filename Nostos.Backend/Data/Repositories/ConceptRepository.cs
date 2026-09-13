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

    public async Task<ConceptStatsDto> GetStatsAsync()
    {
        var stats = await _db
            .Concepts.Select(c => new
            {
                c.Concept,
                UsageCount = c.NoteConcepts.Count(),
            })
            .GroupBy(_ => 1)
            .Select(group => new ConceptStatsDto(
                group.Count(),
                group.Sum(c => c.UsageCount),
                group.Count(c => c.UsageCount == 1),
                group
                    .OrderByDescending(c => c.UsageCount)
                    .ThenBy(c => c.Concept)
                    .Select(c => c.Concept)
                    .FirstOrDefault(),
                group.Max(c => c.UsageCount)
            ))
            .SingleOrDefaultAsync();

        return stats ?? new ConceptStatsDto(0, 0, 0, null, 0);
    }

    public async Task<List<RelatedConceptDto>> GetRelatedAsync(Guid id)
    {
        // Keep the two sides of the NoteConcept relationship in separate
        // queries. Including NoteConcepts back through NoteConcepts creates an
        // EF Core include cycle and fails for no-tracking queries.
        var noteIds = await _db
            .NoteConcepts.Where(nc => nc.ConceptId == id)
            .Select(nc => nc.NoteId)
            .ToListAsync();

        if (noteIds.Count == 0)
            return [];

        var relatedQuery = _db
            .NoteConcepts.Where(nc => noteIds.Contains(nc.NoteId) && nc.ConceptId != id)
            .GroupBy(nc => nc.ConceptId)
            .Select(group => new
            {
                Id = group.Key,
                SharedNotes = group.Count(),
            })
            .Join(
                _db.Concepts,
                related => related.Id,
                concept => concept.Id,
                (related, concept) => new
                {
                    Id = concept.Id,
                    Name = concept.Concept,
                    related.SharedNotes,
                }
            );

        return await relatedQuery
            .OrderByDescending(related => related.SharedNotes)
            .ThenBy(related => related.Name)
            .Select(related => new RelatedConceptDto(
                related.Id,
                related.Name,
                related.SharedNotes
            ))
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

    public async Task<ConceptModel?> RenameAsync(Guid id, string name)
    {
        var source = await _db
            .Concepts.Include(c => c.NoteConcepts)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (source is null)
            return null;

        var target = await _db
            .Concepts.Include(c => c.NoteConcepts)
            .FirstOrDefaultAsync(c => c.Id != id && c.Concept == name);

        if (target is null)
        {
            source.Concept = name;
            await _db.SaveChangesAsync();
            return source;
        }

        MoveLinks(source, target);
        _db.Concepts.Remove(source);
        await _db.SaveChangesAsync();
        return target;
    }

    public async Task<ConceptModel?> MergeAsync(Guid sourceId, Guid targetId)
    {
        var source = await _db
            .Concepts.Include(c => c.NoteConcepts)
            .FirstOrDefaultAsync(c => c.Id == sourceId);
        var target = await _db
            .Concepts.Include(c => c.NoteConcepts)
            .FirstOrDefaultAsync(c => c.Id == targetId);

        if (source is null || target is null)
            return null;

        MoveLinks(source, target);
        _db.Concepts.Remove(source);
        await _db.SaveChangesAsync();
        return target;
    }

    public async Task<bool> DeleteAsync(Guid id)
    {
        var concept = await _db
            .Concepts.Include(c => c.NoteConcepts)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (concept is null)
            return false;

        _db.NoteConcepts.RemoveRange(concept.NoteConcepts);
        _db.Concepts.Remove(concept);
        await _db.SaveChangesAsync();
        return true;
    }

    private void MoveLinks(ConceptModel source, ConceptModel target)
    {
        var targetNoteIds = target.NoteConcepts.Select(link => link.NoteId).ToHashSet();

        foreach (var sourceLink in source.NoteConcepts.ToList())
        {
            _db.NoteConcepts.Remove(sourceLink);

            if (targetNoteIds.Contains(sourceLink.NoteId))
                continue;

            var targetLink = new NoteConceptModel
            {
                NoteId = sourceLink.NoteId,
                ConceptId = target.Id,
                Concept = target,
            };
            target.NoteConcepts.Add(targetLink);
            _db.NoteConcepts.Add(targetLink);
            targetNoteIds.Add(sourceLink.NoteId);
        }
    }

    // --- Methods for NoteProcessorService ---

    public async Task<List<ConceptModel>> GetByNamesAsync(IEnumerable<string> names)
    {
        var nameList = names.ToList();
        return await _db.Concepts.Where(c => nameList.Contains(c.Concept)).ToListAsync();
    }

    public void AddRange(IEnumerable<ConceptModel> concepts)
    {
        _db.Concepts.AddRange(concepts);
    }

    public async Task ClearNoteLinksAsync(Guid noteId)
    {
        var currentLinks = await _db.NoteConcepts.Where(nc => nc.NoteId == noteId).ToListAsync();

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
        return await _db.Concepts.Where(c => !c.NoteConcepts.Any()).ExecuteDeleteAsync(ct);
    }
}
