using System.Net;
using System.Xml;
using System.Xml.Linq;
using Nostos.Backend.Providers.Contracts;

namespace Nostos.Backend.Providers.Wikisource;

/// <summary>
/// English Wikisource as a Nostos ebook source, backed by WS Export OPDS.
///
/// The provider only describes and resolves remote content. The common
/// acquisition layer downloads the chosen EPUB and turns it into an ordinary
/// local Nostos book.
/// </summary>
public sealed class WikisourceProvider : IContentProvider,
    IProviderSearch,
    IProviderCatalog,
    IProviderAcquisitionPlanner,
    IProviderDownloadPolicy
{
    public const string ProviderIdentifier = "wikisource";
    public const string HttpClientName = "wikisource";

    private const long MaxEbookBytes = 128L * 1024 * 1024;
    private const int MaxExternalIdLength = 512;

    private readonly HttpClient _http;

    public WikisourceProvider(IHttpClientFactory httpClientFactory)
    {
        _http = httpClientFactory.CreateClient(HttpClientName);
    }

    public string Id => ProviderIdentifier;
    public string DisplayName => "Wikisource";

    public ProviderCapabilities Capabilities =>
        ProviderCapabilities.Search
        | ProviderCapabilities.ItemRetrieval
        | ProviderCapabilities.EbookAcquisition
        | ProviderCapabilities.CoverArt
        | ProviderCapabilities.RightsInformation;

    // Rights vary by work. The per-item Atom <rights> value is preserved
    // verbatim rather than turning Wikisource into a blanket public-domain
    // claim.
    public string? RightsNotice => null;

    public IReadOnlyList<string> AllowedHosts =>
    [
        "ws-export.wmcloud.org",
        "upload.wikimedia.org",
        "thumb.wikimedia.org",
    ];

    public long MaxBytesPerPart => MaxEbookBytes;
    public long MaxTotalBytes => MaxEbookBytes;
    public int MaxParts => 1;

    public async Task<ProviderSearchPage> SearchAsync(ProviderSearchQuery query, CancellationToken ct)
    {
        if (query.Kind is not null && query.Kind != ProviderMediaKind.Ebook)
            return new ProviderSearchPage([], HasMore: false);

        var feed = await LoadAsync(WikisourceCatalog.CatalogPath, ct);
        if (feed is null)
            return new ProviderSearchPage([], HasMore: false);

        var books = WikisourceCatalog.ParseFeed(feed);
        var terms = (query.Query ?? string.Empty)
            .Split(' ', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

        var filtered = books
            .Where(book => Matches(book, terms))
            .ToList();

        var offset = Math.Max(0, query.Offset);
        var limit = Math.Clamp(query.Limit, 1, 100);
        var page = filtered.Skip(offset).Take(limit).Select(ToProviderItem).ToList();

        return new ProviderSearchPage(
            Items: page,
            HasMore: filtered.Count > offset + page.Count,
            Notice: null);
    }

    public async Task<ProviderItem?> GetItemAsync(string externalId, CancellationToken ct)
    {
        var book = await LoadBookAsync(externalId, ct);
        return book is null ? null : ToProviderItem(book);
    }

    public async Task<ProviderAcquisitionPlan?> PlanAcquisitionAsync(
        ProviderAcquisitionRequest request,
        CancellationToken ct)
    {
        var book = await LoadBookAsync(request.ExternalId, ct);
        if (book is null)
            return null;

        if (request.AssetId is not null
            && !string.Equals(request.AssetId, "epub", StringComparison.OrdinalIgnoreCase))
        {
            throw ProviderException.AssetUnavailableFor(Id, book.Page, request.AssetId);
        }

        if (book.Asset is null)
            throw ProviderException.AssetUnavailableFor(Id, book.Page, request.AssetId ?? "epub");

        var asset = new ProviderAsset(
            Id: "epub",
            Kind: ProviderMediaKind.Ebook,
            Label: "EPUB",
            SourceFormat: "application/epub+zip",
            SizeBytes: null,
            IsPreferred: true);

        return new ProviderAcquisitionPlan(
            ProviderId: Id,
            ExternalId: book.Page,
            Asset: asset,
            Metadata: MetadataFor(book),
            Parts:
            [
                new ProviderDownloadPart(
                    Url: book.Asset.Url,
                    FileExtension: ".epub",
                    ExpectedBytes: null,
                    Label: "EPUB"),
            ],
            Output: new ProviderOutput(".epub", "application/epub+zip", "EPUB"),
            Cover: book.Cover,
            Source: new ProviderSourceInfo(
                ItemUrl: book.SourceUrl?.ToString(),
                RightsStatement: book.Rights,
                RightsUrl: null));
    }

    private async Task<WikisourceBook?> LoadBookAsync(string externalId, CancellationToken ct)
    {
        var page = NormalizeExternalId(externalId);
        if (page is null)
            return null;

        var escaped = Uri.EscapeDataString(page);
        var feed = await LoadAsync("/?lang=en&format=atom&page=" + escaped, ct);
        return feed is null ? null : WikisourceCatalog.ParseItem(feed, page);
    }

    private async Task<XDocument?> LoadAsync(string path, CancellationToken ct)
    {
        try
        {
            using var response = await _http.GetAsync(path, HttpCompletionOption.ResponseHeadersRead, ct);

            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
                return null;

            if (!response.IsSuccessStatusCode)
                throw ProviderException.UnavailableFor(Id, "WS Export answered HTTP " + (int)response.StatusCode);

            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                var document = await XDocument.LoadAsync(stream, LoadOptions.None, ct);
                if (!WikisourceCatalog.IsAtomFeed(document))
                    throw ProviderException.InvalidResponse(Id, "the response was not an Atom feed");

                return document;
            }
            catch (XmlException ex)
            {
                throw ProviderException.InvalidResponse(Id, ex.Message);
            }
        }
        catch (HttpRequestException ex)
        {
            throw ProviderException.UnavailableFor(Id, ex.Message);
        }
    }

    private static bool Matches(WikisourceBook book, IReadOnlyList<string> terms)
    {
        if (terms.Count == 0)
            return true;

        var haystack = string.Join(
            "\n",
            new[] { book.Title, book.Author, book.Categories }
                .Where(value => !string.IsNullOrWhiteSpace(value)));

        return terms.All(term => haystack.Contains(term, StringComparison.OrdinalIgnoreCase));
    }

    private static string? NormalizeExternalId(string? externalId)
    {
        if (string.IsNullOrWhiteSpace(externalId))
            return null;

        var page = externalId.Trim();
        if (page.Length > MaxExternalIdLength || page.Any(char.IsControl))
            return null;

        return page;
    }

    private ProviderItem ToProviderItem(WikisourceBook book) => new(
        ProviderId: Id,
        ExternalId: book.Page,
        Metadata: MetadataFor(book),
        Assets: book.Asset is null
            ? []
            :
            [
                new ProviderAsset(
                    Id: "epub",
                    Kind: ProviderMediaKind.Ebook,
                    Label: "EPUB",
                    SourceFormat: "application/epub+zip",
                    SizeBytes: null,
                    IsPreferred: true),
            ],
        Cover: book.Cover,
        Source: new ProviderSourceInfo(
            ItemUrl: book.SourceUrl?.ToString(),
            RightsStatement: book.Rights,
            RightsUrl: null),
        PartCount: null);

    private static ProviderMetadata MetadataFor(WikisourceBook book) => new(
        Title: book.Title,
        Author: book.Author,
        Description: book.Description,
        Language: book.Language,
        Categories: book.Categories);
}
