using System;

namespace Nostos.Shared.Dtos;

public record NoteDto(
    Guid Id,
    Guid BookId,
    string Content
);

public record CreateNoteDto(string Content);
public record UpdateNoteDto(string Content);
