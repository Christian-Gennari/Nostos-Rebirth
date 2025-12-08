using System;

namespace Nostos.Shared.Dtos;

// Removed "Children" property
public record CollectionDto(
    Guid Id,
    string Name,
    Guid? ParentId
);

public record CreateCollectionDto(
    string Name,
    Guid? ParentId
);

public record UpdateCollectionDto(
    string Name,
    Guid? ParentId
);
