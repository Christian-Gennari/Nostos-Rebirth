using System;
using System.Collections.Generic;

namespace Nostos.Shared.Dtos;

public record WritingDto(
    Guid Id,
    string Name,
    string Type,       // "Folder" or "Document"
    Guid? ParentId,
    DateTime UpdatedAt,
    List<WritingDto> Children // For the tree view
);

// A separate DTO for fetching the full content (to keep the tree lightweight)
public record WritingContentDto(
    Guid Id,
    string Name,
    string Content,
    DateTime UpdatedAt
);

// 👇 ADD THESE NEW INPUT DTOS
public record CreateWritingDto(
    string Name,
    string Type, // "Folder" or "Document"
    Guid? ParentId
);

public record UpdateWritingDto(
    string Name,
    string? Content
);

public record MoveWritingDto(
    Guid? NewParentId
);
