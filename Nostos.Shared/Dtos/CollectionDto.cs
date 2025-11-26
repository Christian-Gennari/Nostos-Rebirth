using System;

namespace Nostos.Shared.Dtos;

public record CollectionDto(
    Guid Id,
    string Name
);

public record CreateCollectionDto(string Name);
public record UpdateCollectionDto(string Name);
