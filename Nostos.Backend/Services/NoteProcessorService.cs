using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Services;

public partial class NoteProcessorService
{
    private readonly NostosDbContext _db;

    public NoteProcessorService(NostosDbContext db)
    {
        _db = db;
    }

    // 1. Encapsulate the Regex here
    [GeneratedRegex(@"\[\[(.*?)\]\]", RegexOptions.Compiled)]
    private static partial Regex ConceptRegex();

    /// <summary>
    /// Parses the note content for [[Concepts]], creates them if missing,
    /// and updates the Many-to-Many links.
    /// </summary>
    public async Task ProcessNoteAsync(NoteModel note)
    {
        // A. Parse content
        var matches = ConceptRegex().Matches(note.Content);

        var foundNames = matches
            .Select(m => m.Groups[1].Value.Trim())
            .Where(s => !string.IsNullOrEmpty(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // B. Clear existing links for this note (Full refresh strategy)
        // We load them first to ensure we are working with the tracked entities
        var currentLinks = await _db.NoteConcepts.Where(nc => nc.NoteId == note.Id).ToListAsync();

        if (currentLinks.Count != 0)
        {
            _db.NoteConcepts.RemoveRange(currentLinks);
        }

        if (foundNames.Count == 0)
            return;

        // C. Find existing concepts in DB to reuse
        var existingConcepts = await _db
            .Concepts.Where(c => foundNames.Contains(c.Concept))
            .ToListAsync();

        var existingNames = existingConcepts
            .Select(c => c.Concept)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // D. Create new concepts
        var newConcepts = foundNames
            .Where(name => !existingNames.Contains(name))
            .Select(name => new ConceptModel { Concept = name })
            .ToList();

        if (newConcepts.Count != 0)
        {
            _db.Concepts.AddRange(newConcepts);
        }

        // E. Create Links
        var allRelevantConcepts = existingConcepts.Concat(newConcepts);

        foreach (var concept in allRelevantConcepts)
        {
            _db.NoteConcepts.Add(new NoteConceptModel { Note = note, Concept = concept });
        }
    }
}
