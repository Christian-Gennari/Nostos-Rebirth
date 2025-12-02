namespace Nostos.Shared.Dtos;

// For the list
public record ConceptDto(Guid Id, string Name, int UsageCount);

// For the detail view
public record ConceptDetailDto(Guid Id, string Name, List<NoteContextDto> Notes);

// UPDATED: Added SelectedText and CfiRange
public record NoteContextDto(
    Guid NoteId,
    string Content,
    string? SelectedText,
    string? CfiRange,
    Guid BookId,
    string BookTitle
);

public record CreateConceptDto(string Concept);
public record UpdateConceptDto(string Concept);
