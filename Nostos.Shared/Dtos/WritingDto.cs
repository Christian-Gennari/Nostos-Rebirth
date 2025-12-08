using System;

namespace Nostos.Shared.Dtos;

// Removed "Children" property
public record WritingDto(
    Guid Id,
    string Name,
    string Type,       // "Folder" or "Document"
    Guid? ParentId,
    DateTime UpdatedAt
);

public record WritingContentDto(
    Guid Id,
    string Name,
    string Content,
    DateTime UpdatedAt
);

public record CreateWritingDto(
    string Name,
    string Type,
    Guid? ParentId
);

public record UpdateWritingDto(
    string Name,
    string? Content
);

public record MoveWritingDto(
    Guid? NewParentId
);
