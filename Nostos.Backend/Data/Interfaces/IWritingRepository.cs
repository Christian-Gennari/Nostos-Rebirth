using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data.Interfaces;

public interface IWritingRepository
{
    Task<List<WritingModel>> GetAllAsync();
    Task<WritingModel?> GetByIdAsync(Guid id);
    Task AddAsync(WritingModel writing);
    Task UpdateAsync(WritingModel writing);
    Task DeleteAsync(WritingModel writing);

    /// <summary>
    /// Gets the ParentId of a writing item for ancestor-chain cycle detection.
    /// </summary>
    Task<Guid?> GetParentIdAsync(Guid id);
}
