using System.Text.Json;
using System.Text.Json.Nodes;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services;

public class BookLookupService(IHttpClientFactory httpClientFactory)
{
  public async Task<CreateBookDto?> LookupCombinedAsync(string isbn)
  {
    var client = httpClientFactory.CreateClient();
    isbn = CleanIsbn(isbn);

    // 1. Fire both requests in parallel for speed
    var olTask = FetchOpenLibrary(client, isbn);
    var gbTask = FetchGoogleBooks(client, isbn);

    await Task.WhenAll(olTask, gbTask);

    var olData = olTask.Result;
    var gbData = gbTask.Result;

    // 2. If both failed, return null
    if (olData is null && gbData is null) return null;

    // 3. Merge Logic: Start with OpenLibrary (Priority 1), fill gaps with Google Books (Priority 2)
    // If OL is null, we just use GB.
    var baseData = olData ?? new CreateBookDto(
        Type: "physical", // <--- NEW: Default to physical for ISBN lookups
        Title: "",
        Subtitle: null,
        Author: null,
        Description: null,
        Isbn: isbn,
        Asin: null,       // <--- NEW
        Duration: null,   // <--- NEW
        Publisher: null,
        PublishedDate: null,
        Edition: null,    // <--- NEW
        PageCount: null,
        Language: null,
        Categories: null,
        Series: null,
        VolumeNumber: null,
        CollectionId: null
    );

    if (gbData is null) return baseData;

    // Progressive Merging
    return baseData with
    {
      Title = !string.IsNullOrWhiteSpace(baseData.Title) ? baseData.Title : gbData.Title,
      Subtitle = !string.IsNullOrWhiteSpace(baseData.Subtitle) ? baseData.Subtitle : gbData.Subtitle,
      Author = !string.IsNullOrWhiteSpace(baseData.Author) ? baseData.Author : gbData.Author,
      Description = !string.IsNullOrWhiteSpace(baseData.Description) ? baseData.Description : gbData.Description,
      Publisher = !string.IsNullOrWhiteSpace(baseData.Publisher) ? baseData.Publisher : gbData.Publisher,
      PublishedDate = !string.IsNullOrWhiteSpace(baseData.PublishedDate) ? baseData.PublishedDate : gbData.PublishedDate,
      PageCount = baseData.PageCount ?? gbData.PageCount,
      Language = !string.IsNullOrWhiteSpace(baseData.Language) ? baseData.Language : gbData.Language,
      Categories = !string.IsNullOrWhiteSpace(baseData.Categories) ? baseData.Categories : gbData.Categories
    };
  }

  private string CleanIsbn(string isbn) => isbn.Replace("-", "").Replace(" ", "").Trim();

  // --- GOOGLE BOOKS FETCH ---
  private async Task<CreateBookDto?> FetchGoogleBooks(HttpClient client, string isbn)
  {
    try
    {
      var json = await client.GetStringAsync($"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}");
      var node = JsonNode.Parse(json);
      var item = node?["items"]?[0]?["volumeInfo"];

      if (item is null) return null;

      return new CreateBookDto(
          Type: "physical", // <--- NEW
          Title: item["title"]?.ToString() ?? "",
          Subtitle: item["subtitle"]?.ToString(),
          Author: ParseArray(item["authors"]),
          Description: item["description"]?.ToString(),
          Isbn: isbn,
          Asin: null,      // <--- NEW
          Duration: null,  // <--- NEW
          Publisher: item["publisher"]?.ToString(),
          PublishedDate: item["publishedDate"]?.ToString(),
          Edition: null,   // <--- NEW
          PageCount: item["pageCount"]?.GetValue<int>(),
          Language: item["language"]?.ToString(),
          Categories: ParseArray(item["categories"]),
          Series: null,
          VolumeNumber: null,
          CollectionId: null
      );
    }
    catch { return null; }
  }

  // --- OPEN LIBRARY FETCH ---
  private async Task<CreateBookDto?> FetchOpenLibrary(HttpClient client, string isbn)
  {
    try
    {
      var key = $"ISBN:{isbn}";
      var json = await client.GetStringAsync($"https://openlibrary.org/api/books?bibkeys={key}&jscmd=data&format=json");
      var node = JsonNode.Parse(json);
      var item = node?[key];

      if (item is null) return null;

      // Extract Authors
      var authorsList = item["authors"]?.AsArray().Select(a => a?["name"]?.ToString()).Where(x => x != null);
      var authors = authorsList != null ? string.Join(", ", authorsList!) : null;

      return new CreateBookDto(
          Type: "physical", // <--- NEW
          Title: item["title"]?.ToString() ?? "",
          Subtitle: item["subtitle"]?.ToString(),
          Author: authors,
          Description: null, // OL descriptions are complex (often objects), keeping simple for now
          Isbn: isbn,
          Asin: null,      // <--- NEW
          Duration: null,  // <--- NEW
          Publisher: item["publishers"]?[0]?["name"]?.ToString(),
          PublishedDate: item["publish_date"]?.ToString(),
          Edition: null,   // <--- NEW
          PageCount: item["number_of_pages"]?.GetValue<int>(),
          Language: null, // OL doesn't always provide simple language codes here
          Categories: null,
          Series: null,
          VolumeNumber: null,
          CollectionId: null
      );
    }
    catch { return null; }
  }

  private string? ParseArray(JsonNode? node)
  {
    if (node is not JsonArray arr) return null;
    var values = arr.Select(x => x?.ToString()).Where(x => !string.IsNullOrWhiteSpace(x));
    return string.Join(", ", values);
  }
}
