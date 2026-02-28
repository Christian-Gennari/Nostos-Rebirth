using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data.Repositories;

public class WritingRepository : IWritingRepository
{
    private readonly NostosDbContext _db;

    public WritingRepository(NostosDbContext db)
    {
        _db = db;
    }

    public async Task<List<WritingModel>> GetAllAsync()
    {
        return await _db.Writings.ToListAsync();
    }

    public async Task<WritingModel?> GetByIdAsync(Guid id)
    {
        return await _db.Writings.FindAsync(id);
    }

    public async Task AddAsync(WritingModel writing)
    {
        _db.Writings.Add(writing);
        await _db.SaveChangesAsync();
    }

    public async Task UpdateAsync(WritingModel writing)
    {
        _db.Writings.Update(writing);
        await _db.SaveChangesAsync();
    }

    public async Task DeleteAsync(WritingModel writing)
    {
        // Cascade delete is configured in DbContext, so this deletes all children too.
        _db.Writings.Remove(writing);
        await _db.SaveChangesAsync();
    }

    public async Task<Guid?> GetParentIdAsync(Guid id)
    {
        var result = await _db
            .Writings.Where(w => w.Id == id)
            .Select(w => new { w.ParentId })
            .FirstOrDefaultAsync();

        return result?.ParentId;
    }
}
