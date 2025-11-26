namespace Nostos.Backend.Services;

public class FileStorageService
{
  private readonly string _root;

  public FileStorageService(IWebHostEnvironment env)
  {
    _root = Path.Combine(env.ContentRootPath, "Storage", "books");
    Directory.CreateDirectory(_root);
  }

  public async Task<string> SaveBookFileAsync(Guid bookId, IFormFile file)
  {
    var bookFolder = Path.Combine(_root, bookId.ToString());
    Directory.CreateDirectory(bookFolder);

    var filePath = Path.Combine(bookFolder, file.FileName);

    using var stream = new FileStream(filePath, FileMode.Create);
    await file.CopyToAsync(stream);

    return filePath;
  }

  public FileStream? GetBookFile(Guid bookId)
  {
    var folder = Path.Combine(_root, bookId.ToString());
    if (!Directory.Exists(folder)) return null;

    var file = Directory.GetFiles(folder).FirstOrDefault();
    if (file is null) return null;

    return new FileStream(file, FileMode.Open, FileAccess.Read);
  }

  public string? GetBookFileName(Guid bookId)
  {
    var folder = Path.Combine(_root, bookId.ToString());
    if (!Directory.Exists(folder)) return null;

    return Directory.GetFiles(folder).FirstOrDefault();
  }

  public void DeleteBookFiles(Guid bookId)
  {
    var bookFolder = Path.Combine(_root, bookId.ToString());
    if (Directory.Exists(bookFolder))
    {
      Directory.Delete(bookFolder, true);
    }
  }


}
