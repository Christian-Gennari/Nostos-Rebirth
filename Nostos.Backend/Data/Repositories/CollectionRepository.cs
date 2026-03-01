using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data.Repositories;

public class CollectionRepository : ICollectionRepository
{
    private readonly NostosDbContext _db;

    public CollectionRepository(NostosDbContext db)
    {
        _db = db;
    }

    public async Task<List<CollectionModel>> GetAllAsync()
    {
        return await _db.Collections.ToListAsync();
    }

    public async Task<CollectionModel?> GetByIdAsync(Guid id)
    {
        return await _db.Collections.FindAsync(id);
    }

    public async Task AddAsync(CollectionModel collection)
    {
        _db.Collections.Add(collection);
        await _db.SaveChangesAsync();
    }

    public async Task UpdateAsync(CollectionModel collection)
    {
        _db.Collections.Update(collection);
        await _db.SaveChangesAsync();
    }

    public async Task DeleteAsync(CollectionModel collection)
    {
        _db.Collections.Remove(collection);
        await _db.SaveChangesAsync();
    }

    public async Task<Guid?> GetParentIdAsync(Guid id)
    {
        var result = await _db
            .Collections.Where(c => c.Id == id)
            .Select(c => new { c.ParentId })
            .FirstOrDefaultAsync();

        return result?.ParentId;
    }

    public async Task UnlinkBooksAsync(Guid collectionId)
    {
        var books = await _db.Books.Where(b => b.CollectionId == collectionId).ToListAsync();

        foreach (var book in books)
        {
            book.CollectionId = null;
        }
    }
}
