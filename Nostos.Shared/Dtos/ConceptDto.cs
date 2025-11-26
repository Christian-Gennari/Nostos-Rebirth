using System;

namespace Nostos.Shared.Dtos;

public record ConceptDto(
    Guid Id,
    string Concept
);

public record CreateConceptDto(string Concept);
public record UpdateConceptDto(string Concept);
