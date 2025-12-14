using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Services;

public partial class BookLookupService(IHttpClientFactory httpClientFactory)
{
    [GeneratedRegex("[^0-9X]", RegexOptions.IgnoreCase)]
    private static partial Regex IsbnCleanupRegex();

    public async Task<CreateBookDto?> LookupCombinedAsync(string isbn)
    {
        var client = httpClientFactory.CreateClient();
        isbn = CleanIsbn(isbn);

        // 1. Fire both requests in parallel
        var olTask = FetchOpenLibrary(client, isbn);
        var gbTask = FetchGoogleBooks(client, isbn);

        await Task.WhenAll(olTask, gbTask);

        var olData = olTask.Result;
        var gbData = gbTask.Result;

        // 2. Fail fast
        if (olData is null && gbData is null)
            return null;

        // 3. Base Data (Priority: OpenLibrary)
        var baseData =
            olData
            ?? new CreateBookDto(
                Type: "physical",
                Title: "",
                Subtitle: null,
                Author: null,
                Editor: null,
                Translator: null,
                Narrator: null,
                Description: null,
                Isbn: isbn,
                Asin: null,
                Duration: null,
                Publisher: null,
                PlaceOfPublication: null,
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
                PersonalReview: null,
                FinishedAt: null
            );

        if (gbData is null)
            return baseData;

        // 4. Merge (Priority: Keep existing OL data, fill gaps with GB)
        return baseData with
        {
            Title = !string.IsNullOrWhiteSpace(baseData.Title) ? baseData.Title : gbData.Title,
            Subtitle = !string.IsNullOrWhiteSpace(baseData.Subtitle)
                ? baseData.Subtitle
                : gbData.Subtitle,
            Author = !string.IsNullOrWhiteSpace(baseData.Author) ? baseData.Author : gbData.Author,
            Description = !string.IsNullOrWhiteSpace(baseData.Description)
                ? baseData.Description
                : gbData.Description,
            Publisher = !string.IsNullOrWhiteSpace(baseData.Publisher)
                ? baseData.Publisher
                : gbData.Publisher,
            PlaceOfPublication = !string.IsNullOrWhiteSpace(baseData.PlaceOfPublication)
                ? baseData.PlaceOfPublication
                : gbData.PlaceOfPublication,
            PublishedDate = !string.IsNullOrWhiteSpace(baseData.PublishedDate)
                ? baseData.PublishedDate
                : gbData.PublishedDate,
            PageCount = baseData.PageCount ?? gbData.PageCount,
            Language = !string.IsNullOrWhiteSpace(baseData.Language)
                ? baseData.Language
                : gbData.Language,
            Categories = !string.IsNullOrWhiteSpace(baseData.Categories)
                ? baseData.Categories
                : gbData.Categories,
        };
    }

    private string CleanIsbn(string isbn)
    {
        if (string.IsNullOrWhiteSpace(isbn))
            return "";
        return IsbnCleanupRegex().Replace(isbn, "").ToUpper();
    }

    // --- GOOGLE BOOKS FETCH (Strictly Typed) ---
    private async Task<CreateBookDto?> FetchGoogleBooks(HttpClient client, string isbn)
    {
        try
        {
            // Note: Use 'volumeInfo' in the response record directly
            var response = await client.GetFromJsonAsync<GoogleBooksResponse>(
                $"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}"
            );

            var item = response?.Items?.FirstOrDefault()?.VolumeInfo;
            if (item is null)
                return null;

            return new CreateBookDto(
                Type: "physical",
                Title: item.Title ?? "",
                Subtitle: item.Subtitle,
                Author: item.Authors is not null ? string.Join(", ", item.Authors) : null,
                Editor: null,
                Translator: null,
                Narrator: null,
                Description: item.Description,
                Isbn: isbn,
                Asin: null,
                Duration: null,
                Publisher: item.Publisher,
                PlaceOfPublication: null,
                PublishedDate: item.PublishedDate,
                Edition: null,
                PageCount: item.PageCount,
                Language: item.Language,
                Categories: item.Categories is not null ? string.Join(", ", item.Categories) : null,
                Series: null,
                VolumeNumber: null,
                CollectionId: null,
                Rating: 0,
                IsFavorite: false,
                PersonalReview: null,
                FinishedAt: null
            );
        }
        catch
        {
            return null;
        }
    }

    // --- OPEN LIBRARY FETCH (Strictly Typed) ---
    private async Task<CreateBookDto?> FetchOpenLibrary(HttpClient client, string isbn)
    {
        try
        {
            var key = $"ISBN:{isbn}";

            // OpenLibrary returns a Dictionary keyed by the ISBN string.
            // We deserialize into a Dictionary<string, OpenLibraryBook>
            var response = await client.GetFromJsonAsync<Dictionary<string, OpenLibraryBook>>(
                $"https://openlibrary.org/api/books?bibkeys={key}&jscmd=data&format=json"
            );

            if (response is null || !response.TryGetValue(key, out var item))
                return null;

            var authors = item.Authors?.Select(a => a.Name).Where(x => !string.IsNullOrEmpty(x));
            var place = item.PublishPlaces?.FirstOrDefault()?.Name;

            return new CreateBookDto(
                Type: "physical",
                Title: item.Title ?? "",
                Subtitle: item.Subtitle,
                Author: authors != null ? string.Join(", ", authors) : null,
                Editor: null,
                Translator: null,
                Narrator: null,
                Description: null,
                Isbn: isbn,
                Asin: null,
                Duration: null,
                Publisher: item.Publishers?.FirstOrDefault()?.Name,
                PlaceOfPublication: place,
                PublishedDate: item.PublishDate,
                Edition: null,
                PageCount: item.NumberOfPages,
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
        catch
        {
            return null;
        }
    }
}

// --- STRICT TYPES (Internal) ---

// 1. Google Books Records
record GoogleBooksResponse(List<GoogleBookItem>? Items);

record GoogleBookItem(GoogleVolumeInfo VolumeInfo);

record GoogleVolumeInfo(
    string? Title,
    string? Subtitle,
    string[]? Authors,
    string? Description,
    string? Publisher,
    string? PublishedDate,
    int? PageCount,
    string? Language,
    string[]? Categories
);

// 2. Open Library Records
// Note: JSON properties often have snake_case, we use [JsonPropertyName] if we want C# PascalCase,
// or we can just match the API casing strictly for simple internal DTOs.
// To avoid importing System.Text.Json.Serialization everywhere, I'll stick to matching the API naming or using the simple options.
// For simplicity and zero-dependency bloat in this file, let's use the [JsonPropertyName] attribute.
// I will need: using System.Text.Json.Serialization;

record OpenLibraryBook(
    [property: System.Text.Json.Serialization.JsonPropertyName("title")] string? Title,
    [property: System.Text.Json.Serialization.JsonPropertyName("subtitle")] string? Subtitle,
    [property: System.Text.Json.Serialization.JsonPropertyName("authors")] List<OlName>? Authors,
    [property: System.Text.Json.Serialization.JsonPropertyName("publishers")]
        List<OlName>? Publishers,
    [property: System.Text.Json.Serialization.JsonPropertyName("publish_places")]
        List<OlName>? PublishPlaces,
    [property: System.Text.Json.Serialization.JsonPropertyName("publish_date")] string? PublishDate,
    [property: System.Text.Json.Serialization.JsonPropertyName("number_of_pages")]
        int? NumberOfPages
);

record OlName([property: System.Text.Json.Serialization.JsonPropertyName("name")] string? Name);
