namespace Nostos.Shared.Dtos;

// Recursive DTO
public record CollectionDto(
    Guid Id,
    string Name,
    Guid? ParentId,
    List<CollectionDto> Children
);

public record CreateCollectionDto(
    string Name,
    Guid? ParentId // Optional: Create directly inside another folder
);

public record UpdateCollectionDto(
    string Name,
    Guid? ParentId // Optional: Move folder to another parent
);
