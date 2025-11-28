namespace Nostos.Backend.Services;

public class FileStorageService
{
  private readonly string _root;

  // Centralized allowed extensions
  private readonly HashSet<string> _allowedBookExtensions = new(StringComparer.OrdinalIgnoreCase)
  {
    ".epub",
    ".pdf",
    ".txt",
    ".mobi",
    ".azw3"
  };

  private readonly HashSet<string> _allowedCoverExtensions = new(StringComparer.OrdinalIgnoreCase)
  {
    ".png",
    ".jpg",
    ".jpeg"
  };

  public FileStorageService(IWebHostEnvironment env)
  {
    _root = Path.Combine(env.ContentRootPath, "Storage", "books");
    Directory.CreateDirectory(_root);
  }

  public async Task<string> SaveBookFileAsync(Guid bookId, IFormFile file)
  {
    var ext = Path.GetExtension(file.FileName);
    if (!_allowedBookExtensions.Contains(ext))
      throw new InvalidOperationException($"Unsupported file type: {ext}");

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

    var file = Directory
      .EnumerateFiles(folder)
      .FirstOrDefault(f => _allowedBookExtensions.Contains(Path.GetExtension(f)));

    return file is null
      ? null
      : new FileStream(file, FileMode.Open, FileAccess.Read);
  }

  public string? GetBookFileName(Guid bookId)
  {
    var folder = Path.Combine(_root, bookId.ToString());
    if (!Directory.Exists(folder)) return null;

    return Directory
      .EnumerateFiles(folder)
      .FirstOrDefault(f => _allowedBookExtensions.Contains(Path.GetExtension(f)));
  }

  public void DeleteBookFiles(Guid bookId)
  {
    var bookFolder = Path.Combine(_root, bookId.ToString());
    if (Directory.Exists(bookFolder))
      Directory.Delete(bookFolder, true);
  }

  public async Task<string> SaveBookCoverAsync(Guid bookId, IFormFile file)
  {
    var ext = Path.GetExtension(file.FileName).ToLower();
    if (!_allowedCoverExtensions.Contains(ext))
      throw new InvalidOperationException("Only PNG, JPG, or JPEG allowed.");

    var bookFolder = Path.Combine(_root, bookId.ToString());
    Directory.CreateDirectory(bookFolder);

    var filePath = Path.Combine(bookFolder, "cover.png");

    using var stream = new FileStream(filePath, FileMode.Create);
    await file.CopyToAsync(stream);

    return filePath;
  }

  public string? GetBookCoverPath(Guid bookId)
  {
    var path = Path.Combine(_root, bookId.ToString(), "cover.png");
    return File.Exists(path) ? path : null;
  }

  public bool DeleteCover(Guid bookId)
  {
    var folder = Path.Combine(_root, bookId.ToString());
    var coverPath = Path.Combine(folder, "cover.png");

    if (!File.Exists(coverPath)) return false;

    File.Delete(coverPath);
    return true;
  }
}
