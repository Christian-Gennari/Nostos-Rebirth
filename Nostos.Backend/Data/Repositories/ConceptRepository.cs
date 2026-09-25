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

    public async Task<List<ConceptDto>> SearchByNoteTextAsync(string term)
    {
        if (string.IsNullOrWhiteSpace(term))
            return [];

        var cleanTerm = term.Trim();
        var pattern = $"%{cleanTerm}%";

        var matchingRows = await _db.NoteConcepts
            .AsNoTracking()
            .Where(nc =>
                EF.Functions.Like(nc.Note.Content, pattern) ||
                (nc.Note.SelectedText != null && EF.Functions.Like(nc.Note.SelectedText, pattern)) ||
                (nc.Note.Book != null && EF.Functions.Like(nc.Note.Book.Title, pattern)))
            .Select(nc => new
            {
                nc.ConceptId,
                ConceptName = nc.Concept.Concept,
                TotalUsageCount = nc.Concept.NoteConcepts.Count(),
                nc.NoteId,
                nc.Note.Content,
                nc.Note.SelectedText,
                BookTitle = nc.Note.Book != null ? nc.Note.Book.Title : null,
                nc.Note.CreatedAt
            })
            .ToListAsync();

        if (matchingRows.Count == 0)
            return [];

        var results = new List<ConceptDto>();
        var groupedByConcept = matchingRows.GroupBy(r => r.ConceptId);

        foreach (var group in groupedByConcept)
        {
            var firstRow = group.First();
            var conceptId = group.Key;
            var conceptName = firstRow.ConceptName;
            var totalUsageCount = firstRow.TotalUsageCount;

            var noteGroups = group.GroupBy(r => r.NoteId).ToList();
            int noteMatchCount = noteGroups.Count;

            string? snippet = null;
            var orderedNotes = noteGroups
                .Select(g => g.OrderBy(r => r.CreatedAt).First())
                .OrderBy(r => r.CreatedAt);

            foreach (var note in orderedNotes)
            {
                if (!string.IsNullOrEmpty(note.Content) &&
                    note.Content.Contains(cleanTerm, StringComparison.OrdinalIgnoreCase))
                {
                    snippet = CreateSnippet(note.Content, cleanTerm);
                    break;
                }

                if (!string.IsNullOrEmpty(note.SelectedText) &&
                    note.SelectedText.Contains(cleanTerm, StringComparison.OrdinalIgnoreCase))
                {
                    snippet = CreateSnippet(note.SelectedText, cleanTerm);
                    break;
                }

                if (!string.IsNullOrEmpty(note.BookTitle) &&
                    note.BookTitle.Contains(cleanTerm, StringComparison.OrdinalIgnoreCase))
                {
                    snippet = CreateSnippet(note.BookTitle, cleanTerm);
                    break;
                }
            }

            results.Add(new ConceptDto(
                conceptId,
                conceptName,
                totalUsageCount,
                noteMatchCount,
                snippet
            ));
        }

        // Order by NoteMatchCount descending, then Name ascending.
        // Cap the returned list at 50 rows — the point of server-side matching is a flat payload.
        return results
            .OrderByDescending(c => c.NoteMatchCount)
            .ThenBy(c => c.Name)
            .Take(50)
            .ToList();
    }

    private static string CreateSnippet(string text, string term)
    {
        if (string.IsNullOrWhiteSpace(text) || string.IsNullOrWhiteSpace(term))
            return string.Empty;

        var cleaned = System.Text.RegularExpressions.Regex.Replace(text, @"\s+", " ").Trim();
        int matchIndex = cleaned.IndexOf(term, StringComparison.OrdinalIgnoreCase);
        if (matchIndex < 0)
            return string.Empty;

        int matchLength = term.Length;
        int targetStart = Math.Max(0, matchIndex - 60);
        int targetEnd = Math.Min(cleaned.Length, matchIndex + matchLength + 60);

        int start = targetStart;
        bool truncatedStart = false;
        if (start > 0)
        {
            truncatedStart = true;
            if (char.IsWhiteSpace(cleaned[start]))
            {
                while (start < matchIndex && char.IsWhiteSpace(cleaned[start]))
                    start++;
            }
            else if (!char.IsWhiteSpace(cleaned[start - 1]))
            {
                int spaceIndex = cleaned.IndexOf(' ', start);
                if (spaceIndex >= 0 && spaceIndex < matchIndex)
                {
                    start = spaceIndex + 1;
                    while (start < matchIndex && char.IsWhiteSpace(cleaned[start]))
                        start++;
                }
            }
        }

        int end = targetEnd;
        bool truncatedEnd = false;
        if (end < cleaned.Length)
        {
            truncatedEnd = true;
            if (char.IsWhiteSpace(cleaned[end]))
            {
                // Word boundary already
            }
            else if (char.IsWhiteSpace(cleaned[end - 1]))
            {
                while (end > matchIndex + matchLength && char.IsWhiteSpace(cleaned[end - 1]))
                    end--;
            }
            else
            {
                int spaceIndex = cleaned.LastIndexOf(' ', end - 1);
                if (spaceIndex >= matchIndex + matchLength)
                {
                    end = spaceIndex;
                    while (end > matchIndex + matchLength && char.IsWhiteSpace(cleaned[end - 1]))
                        end--;
                }
            }
        }

        var fragment = cleaned.Substring(start, end - start).Trim();
        return $"{(truncatedStart ? "…" : "")}{fragment}{(truncatedEnd ? "…" : "")}";
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
        var noteIds = await _db
            .NoteConcepts.Where(nc => nc.ConceptId == id)
            .Select(nc => nc.NoteId)
            .ToListAsync();

        if (noteIds.Count == 0)
            return [];

        // Keep the raw co-occurrence rows so the API can explain each structural
        // relationship with the exact shared notes rather than only a score.
        var relatedRows = await _db
            .NoteConcepts.AsNoTracking()
            .Where(nc => noteIds.Contains(nc.NoteId) && nc.ConceptId != id)
            .Select(nc => new
            {
                nc.ConceptId,
                Name = nc.Concept.Concept,
                nc.NoteId,
            })
            .ToListAsync();

        return relatedRows
            .GroupBy(row => new { row.ConceptId, row.Name })
            .Select(group =>
            {
                var sharedNoteIds = group
                    .Select(row => row.NoteId)
                    .Distinct()
                    .OrderBy(noteId => noteId)
                    .ToList();

                return new RelatedConceptDto(
                    group.Key.ConceptId,
                    group.Key.Name,
                    sharedNoteIds.Count,
                    sharedNoteIds
                );
            })
            .OrderByDescending(related => related.SharedNotes)
            .ThenBy(related => related.Name)
            .ToList();
    }

    public async Task<ConceptGraphDto> GetGraphAsync()
    {
        // All concepts as nodes, including isolates (0 note links).
        var nodes = await _db
            .Concepts.OrderByDescending(c => c.NoteConcepts.Count())
            .ThenBy(c => c.Concept)
            .Select(c => new ConceptGraphNodeDto(c.Id, c.Concept, c.NoteConcepts.Count()))
            .ToListAsync();

        // All note-concept pairs (note → concept id) in one query.
        var pairs = await _db.NoteConcepts
            .Select(nc => new { nc.NoteId, nc.ConceptId })
            .ToListAsync();

        // Group by note to find co-occurring pairs, then aggregate edge weights.
        var byNote = pairs.GroupBy(p => p.NoteId);
        var edgeMap = new Dictionary<(Guid, Guid), int>();

        foreach (var group in byNote)
        {
            var conceptIds = group.Select(p => p.ConceptId).Distinct().OrderBy(id => id).ToList();
            for (int i = 0; i < conceptIds.Count; i++)
            {
                for (int j = i + 1; j < conceptIds.Count; j++)
                {
                    var key = (conceptIds[i], conceptIds[j]);
                    edgeMap[key] = edgeMap.GetValueOrDefault(key) + 1;
                }
            }
        }

        var edges = edgeMap
            .Select(kv => new ConceptGraphEdgeDto(kv.Key.Item1, kv.Key.Item2, kv.Value))
            .OrderByDescending(e => e.SharedNotes)
            .ThenBy(e => e.SourceId)
            .ThenBy(e => e.TargetId)
            .ToList();

        return new ConceptGraphDto(nodes, edges);
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
