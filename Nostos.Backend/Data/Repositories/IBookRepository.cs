using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Data.Repositories;

public interface IBookRepository
{
    // The "Big One" - Handles all search/filter/sort/pagination logic
    Task<PaginatedResponse<BookModel>> GetBooksAsync(
        string? search,
        BookFilter? filter,
        BookSort? sort,
        int page,
        int pageSize
    );

    Task<BookModel?> GetByIdAsync(Guid id);

    Task AddAsync(BookModel book);

    Task UpdateAsync(BookModel book);

    Task DeleteAsync(BookModel book);
}
