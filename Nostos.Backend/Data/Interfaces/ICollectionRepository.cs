using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data.Interfaces;

public interface ICollectionRepository
{
    Task<List<CollectionModel>> GetAllAsync();
    Task<CollectionModel?> GetByIdAsync(Guid id);
    Task AddAsync(CollectionModel collection);
    Task UpdateAsync(CollectionModel collection);
    Task DeleteAsync(CollectionModel collection);

    /// <summary>
    /// Walks up the ancestor chain to detect cycles.
    /// Returns the ParentId of the given collection, or null if it's a root.
    /// </summary>
    Task<Guid?> GetParentIdAsync(Guid id);

    /// <summary>
    /// Removes every membership row for the given collection (books themselves
    /// are untouched — they belong to the library, not to the collection).
    /// </summary>
    Task UnlinkBooksAsync(Guid collectionId);
}
