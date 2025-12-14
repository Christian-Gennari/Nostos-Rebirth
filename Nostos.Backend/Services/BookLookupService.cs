using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services;

public partial class BookLookupService(IHttpClientFactory httpClientFactory)
{
    // OPTIMIZATION: Generate Regex at compile time for better performance
    [GeneratedRegex("[^0-9X]", RegexOptions.IgnoreCase)]
    private static partial Regex IsbnCleanupRegex();

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
            Type: "physical",
            Title: "",
            Subtitle: null,
            Author: null,
            Editor: null,            // <--- NEW
            Translator: null,
            Narrator: null,
            Description: null,
            Isbn: isbn,
            Asin: null,
            Duration: null,
            Publisher: null,
            PlaceOfPublication: null, // <--- NEW
            PublishedDate: null,
            Edition: null,
            PageCount: null,
            Language: null,
            Categories: null,
            Series: null,
            VolumeNumber: null,
            CollectionId: null,
            Rating: 0,
            IsFavorite: false,
            PersonalReview: null,    // <--- NEW
            FinishedAt: null
        );

        if (gbData is null) return baseData;

        // Progressive Merging: Keep baseData (OL) value if present, otherwise take gbData (GB)
        return baseData with
        {
            Title = !string.IsNullOrWhiteSpace(baseData.Title) ? baseData.Title : gbData.Title,
            Subtitle = !string.IsNullOrWhiteSpace(baseData.Subtitle) ? baseData.Subtitle : gbData.Subtitle,
            Author = !string.IsNullOrWhiteSpace(baseData.Author) ? baseData.Author : gbData.Author,
            // Google Books rarely gives explicit Translator/Editor fields distinct from Authors in the simple API,
            // so we mostly rely on what we have or user input.
            Description = !string.IsNullOrWhiteSpace(baseData.Description) ? baseData.Description : gbData.Description,
            Publisher = !string.IsNullOrWhiteSpace(baseData.Publisher) ? baseData.Publisher : gbData.Publisher,

            // OpenLibrary is much better at PlaceOfPublication, but if we missed it and GB had it (unlikely), we merge.
            PlaceOfPublication = !string.IsNullOrWhiteSpace(baseData.PlaceOfPublication) ? baseData.PlaceOfPublication : gbData.PlaceOfPublication,

            PublishedDate = !string.IsNullOrWhiteSpace(baseData.PublishedDate) ? baseData.PublishedDate : gbData.PublishedDate,
            PageCount = baseData.PageCount ?? gbData.PageCount,
            Language = !string.IsNullOrWhiteSpace(baseData.Language) ? baseData.Language : gbData.Language,
            Categories = !string.IsNullOrWhiteSpace(baseData.Categories) ? baseData.Categories : gbData.Categories
        };
    }

    private string CleanIsbn(string isbn)
    {
        if (string.IsNullOrWhiteSpace(isbn)) return "";

        // Use the compile-time generated regex to strip invalid characters
        return IsbnCleanupRegex().Replace(isbn, "").ToUpper();
    }

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
                Type: "physical",
                Title: item["title"]?.ToString() ?? "",
                Subtitle: item["subtitle"]?.ToString(),
                Author: ParseArray(item["authors"]),
                Editor: null,             // API doesn't clearly separate editors
                Translator: null,
                Narrator: null,
                Description: item["description"]?.ToString(),
                Isbn: isbn,
                Asin: null,
                Duration: null,
                Publisher: item["publisher"]?.ToString(),
                PlaceOfPublication: null, // Google Books API rarely provides city/place
                PublishedDate: item["publishedDate"]?.ToString(),
                Edition: null,
                PageCount: item["pageCount"]?.GetValue<int>(),
                Language: item["language"]?.ToString(),
                Categories: ParseArray(item["categories"]),
                Series: null,
                VolumeNumber: null,
                CollectionId: null,
                Rating: 0,
                IsFavorite: false,
                PersonalReview: null,
                FinishedAt: null
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

            // Extract Place of Publication (Critical for Harvard)
            // OpenLibrary usually returns: "publish_places": [{"name": "London"}, ...]
            var placesList = item["publish_places"]?.AsArray().Select(p => p?["name"]?.ToString()).Where(x => x != null);
            var place = placesList?.FirstOrDefault(); // Pick the first one (e.g., "London")

            return new CreateBookDto(
                Type: "physical",
                Title: item["title"]?.ToString() ?? "",
                Subtitle: item["subtitle"]?.ToString(),
                Author: authors,
                Editor: null,            // Hard to distinguish reliably from API data
                Translator: null,
                Narrator: null,
                Description: null,       // OL 'data' endpoint often lacks descriptions
                Isbn: isbn,
                Asin: null,
                Duration: null,
                Publisher: item["publishers"]?[0]?["name"]?.ToString(),
                PlaceOfPublication: place, // <--- Fetched here
                PublishedDate: item["publish_date"]?.ToString(),
                Edition: null,
                PageCount: item["number_of_pages"]?.GetValue<int>(),
                Language: null,
                Categories: null,
                Series: null,
                VolumeNumber: null,
                CollectionId: null,
                Rating: 0,
                IsFavorite: false,
                PersonalReview: null,
                FinishedAt: null
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
