using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Repositories;

public class BookRepository : IBookRepository
{
    // "The library's downloadable books" — one definition so the OPDS feed's
    // page query and its total count can never disagree about what the
    // catalogue contains.
    private static readonly Expression<Func<BookModel, bool>> BooksWithFiles = b =>
        b.FileDetails.HasFile && b.FileDetails.FileName != null;

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
        int pageSize,
        Guid? collectionId = null
    )
    {
        var query = _db.Books.AsNoTracking().AsQueryable();

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
                // Membership lives in the join table now; a book is unsorted
                // when it belongs to no collection at all.
                BookFilter.Unsorted => query.Where(b =>
                    !_db.BookCollections.Any(bc => bc.BookId == b.Id)),
                _ => query,
            };
        }

        // 3. Collection filtering (Explicit)
        if (collectionId.HasValue)
        {
            // Any membership in the requested collection matches.
            query = query.Where(b =>
                _db.BookCollections.Any(bc => bc.BookId == b.Id && bc.CollectionId == collectionId.Value));
        }

        // 4. Sorting
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

        // 5. Pagination
        var totalCount = await query.CountAsync();

        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return new PaginatedResponse<BookModel>(items, totalCount, page, pageSize);
    }

    public async Task<BookModel?> GetByIdAsync(Guid id)
    {
        return await _db.Books.FindAsync(id);
    }

    public async Task<int> CountBooksWithFilesAsync()
    {
        return await _db.Books.AsNoTracking().CountAsync(BooksWithFiles);
    }

    public async Task<List<BookModel>> GetBooksWithFilesPageAsync(int skip, int take)
    {
        return await _db
            .Books.AsNoTracking()
            .Where(BooksWithFiles)
            // Creation date is not unique (an import can create several books in
            // the same tick), and SQLite is free to return tied rows in any
            // order — which would let a paged feed repeat one book and skip
            // another. The id is the tiebreaker that makes the ordering total.
            .OrderByDescending(b => b.CreatedAt)
            .ThenBy(b => b.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync();
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
