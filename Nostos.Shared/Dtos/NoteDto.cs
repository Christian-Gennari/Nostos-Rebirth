using System;

namespace Nostos.Shared.Dtos;

public record NoteDto(
    Guid Id,
    Guid BookId,
    string Content,
    string? CfiRange,
    string? SelectedText,
    DateTime CreatedAt,
    string? BookTitle
);

public record CreateNoteDto(
    string Content,
    string? CfiRange = null,
    string? SelectedText = null
);

public record UpdateNoteDto(string Content, string? SelectedText = null);

/// <summary>
/// A note found by searching note text, or listed because it belongs to no concept
/// (issue #158). `Snippet` is the fragment around the match, so the index can show
/// why a note matched without shipping the whole note to every row.
/// </summary>
public record NoteSearchHitDto(
    Guid Id,
    Guid BookId,
    string? BookTitle,
    string Content,
    string? SelectedText,
    string? Snippet,
    IReadOnlyList<string> ConceptNames,
    DateTime CreatedAt
);

/// <summary>
/// One bounded page of the unlinked-note review queue, plus the total still
/// waiting. The review mode traverses the whole set, so the total is what keeps
/// `Items` from reading as the whole set — 50 of 63 unlinked notes must never be
/// presented as "the unlinked notes" (issue #256).
/// </summary>
public record NoteSearchPageDto(
    IReadOnlyList<NoteSearchHitDto> Items,
    int TotalCount,
    int Offset,
    int Limit
);
