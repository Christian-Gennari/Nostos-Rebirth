using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Interfaces;

public interface IBookRepository
{
    // The "Big One" - Handles all search/filter/sort/pagination logic
    Task<PaginatedResponse<BookModel>> GetBooksAsync(
        string? search,
        BookFilter? filter,
        BookSort? sort,
        int page,
        int pageSize,
        Guid? collectionId = null
    );

    Task<BookModel?> GetByIdAsync(Guid id);

    /// <summary>
    /// Returns all books that have an uploaded file, ordered by creation date descending.
    /// Used by the OPDS catalog feed.
    /// </summary>
    Task<List<BookModel>> GetBooksWithFilesAsync();

    Task AddAsync(BookModel book);

    Task UpdateAsync(BookModel book);

    Task DeleteAsync(BookModel book);
}
