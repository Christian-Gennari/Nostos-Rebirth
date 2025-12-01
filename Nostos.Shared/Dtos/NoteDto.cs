// Nostos.Shared/Dtos/NoteDto.cs
using System;

namespace Nostos.Shared.Dtos;

public record NoteDto(
    Guid Id,
    Guid BookId,
    string Content,
    string? CfiRange,      // <--- NEW
    string? SelectedText   // <--- NEW
);

public record CreateNoteDto(
    string Content,
    string? CfiRange = null,     // <--- NEW
    string? SelectedText = null  // <--- NEW
);

public record UpdateNoteDto(string Content); // Updates usually just change the user's comment
