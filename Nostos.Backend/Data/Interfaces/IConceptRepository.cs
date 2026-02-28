using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Data.Interfaces;

public interface IConceptRepository
{
    /// <summary>
    /// Returns all concepts with their usage count, ordered by usage desc then name asc.
    /// </summary>
    Task<List<ConceptDto>> GetAllWithUsageCountAsync();

    /// <summary>
    /// Gets a concept with its linked notes (deep includes for Book and Note data).
    /// Returns null if not found.
    /// </summary>
    Task<ConceptModel?> GetByIdWithNotesAsync(Guid id);
}
