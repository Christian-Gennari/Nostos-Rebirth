using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Repositories;

public class BookRepository : IBookRepository
{
    private readonly NostosDbContext _db;

    public BookRepository(NostosDbContext db)
    {
        _db = db;
    }

    public async Task<PaginatedResponse<BookModel>> GetBooksAsync(
        string? search,
        BookFilter? filter,
        BookSort? sort,
        int page,
        int pageSize
    )
    {
        var query = _db.Books.AsQueryable();

        // 1. Search
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search}%";
            query = query.Where(b =>
                EF.Functions.Like(b.Title, term) || EF.Functions.Like(b.Author, term)
            );
        }

        // 2. Filters
        if (filter.HasValue)
        {
            query = filter.Value switch
            {
                BookFilter.Favorites => query.Where(b => b.Progress.IsFavorite),
                BookFilter.Finished => query.Where(b => b.Progress.FinishedAt != null),
                BookFilter.Reading => query.Where(b =>
                    b.Progress.FinishedAt == null && b.Progress.ProgressPercent > 0
                ),
                BookFilter.Unsorted => query.Where(b => b.CollectionId == null),
                _ => query,
            };
        }

        // 3. Sorting
        var sortValue = sort ?? BookSort.Recent;
        query = sortValue switch
        {
            BookSort.Title => query.OrderBy(b => b.Title),
            BookSort.Rating => query.OrderByDescending(b => b.Progress.Rating),
            BookSort.LastRead => query
                .OrderByDescending(b => b.Progress.LastReadAt.HasValue)
                .ThenByDescending(b => b.Progress.LastReadAt),
            BookSort.Recent or _ => query.OrderByDescending(b => b.CreatedAt),
        };

        // 4. Pagination
        var totalCount = await query.CountAsync();

        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return new PaginatedResponse<BookModel>(items, totalCount, page, pageSize);
    }

    public async Task<BookModel?> GetByIdAsync(Guid id)
    {
        return await _db.Books.FindAsync(id);
    }

    public async Task AddAsync(BookModel book)
    {
        _db.Books.Add(book);
        await _db.SaveChangesAsync();
    }

    public async Task UpdateAsync(BookModel book)
    {
        // Entity is likely already tracked, so Update usually just means SaveChanges
        // But explicit Update call is safe.
        _db.Books.Update(book);
        await _db.SaveChangesAsync();
    }

    public async Task DeleteAsync(BookModel book)
    {
        _db.Books.Remove(book);
        await _db.SaveChangesAsync();
    }
}
