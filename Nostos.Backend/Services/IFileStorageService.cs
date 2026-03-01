namespace Nostos.Backend.Services;

public interface IFileStorageService
{
    Task<string> SaveBookFileAsync(Guid bookId, IFormFile file);
    FileStream? GetBookFile(Guid bookId);
    string? GetBookFileName(Guid bookId);
    void DeleteBookFiles(Guid bookId);
    Task<string> SaveBookCoverAsync(Guid bookId, IFormFile file);
    string? GetBookCoverPath(Guid bookId);
    bool DeleteCover(Guid bookId);
}
