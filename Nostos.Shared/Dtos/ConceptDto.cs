namespace Nostos.Shared.Dtos;

// For the list
public record ConceptDto(Guid Id, string Name, int UsageCount);

// For the detail view
public record ConceptDetailDto(Guid Id, string Name, List<NoteContextDto> Notes);

public record ConceptStatsDto(
    int TotalConcepts,
    int TotalReferences,
    int SingleNoteConcepts,
    string? MostUsedName,
    int MostUsedCount
);

public record RelatedConceptDto(Guid Id, string Name, int SharedNotes);

// UPDATED: Added SelectedText and CfiRange
public record NoteContextDto(
    Guid NoteId,
    string Content,
    string? SelectedText,
    string? CfiRange,
    Guid BookId,
    string BookTitle,
    DateTime CreatedAt
);

public record CreateConceptDto(string Concept);
public record UpdateConceptDto(string Concept);
public record MergeConceptDto(Guid TargetId);
