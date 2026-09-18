using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Services;

namespace Nostos.Backend.Endpoints;

/// <summary>
/// The OPDS 1.2 export of the local library (issue #186).
///
/// This is an <b>acquisition</b> feed: its entries are publications, each with
/// an acquisition link to the stored file, so the feed advertises itself as
/// <c>kind=acquisition</c>. It used to declare <c>kind=navigation</c>, which
/// describes a feed of links to other feeds and is not what this is.
///
/// Access model (see <see cref="OpdsOptions"/> for the full statement): the
/// catalogue and the acquisitions it links to are served without
/// authentication, so Nostos is only safe to expose on a private network.
/// </summary>
public static class OpdsEndpoints
{
    private static readonly XNamespace Atom = "http://www.w3.org/2005/Atom";
    private static readonly XNamespace OpdsCatalog = "http://opds-spec.org/2010/catalog";
    private static readonly XNamespace DcTerms = "http://purl.org/dc/terms/";

    private const string AtomFeedType = "application/atom+xml";
    private const string AcquisitionFeedType =
        "application/atom+xml;profile=opds-catalog;kind=acquisition";

    private const string ImageRel = "http://opds-spec.org/image";
    private const string ThumbnailRel = "http://opds-spec.org/image/thumbnail";
    private const string AcquisitionRel = "http://opds-spec.org/acquisition";

    /// <summary>
    /// Maps <c>/opds/</c> unless the export is switched off. Passing the
    /// validated options in (rather than reading configuration here) keeps the
    /// per-request behaviour and the mapping decision on the same instance.
    /// </summary>
    public static IEndpointRouteBuilder MapOpdsEndpoints(
        this IEndpointRouteBuilder routes,
        OpdsOptions options
    )
    {
        if (!options.Enabled)
            return routes;

        var group = routes.MapGroup("/opds");

        group.MapGet(
            "/",
            async (HttpContext context, IBookRepository bookRepo) =>
            {
                // The feed is paginated, so the request describes a window into
                // the collection rather than the collection itself.
                var total = await bookRepo.CountBooksWithFilesAsync();
                var pageSize = options.PageSize;
                var lastPage = Math.Max(1, (total + pageSize - 1) / pageSize);
                var page = Math.Clamp(ParsePage(context.Request.Query["page"]), 1, lastPage);

                var books = await bookRepo.GetBooksWithFilesPageAsync(
                    (page - 1) * pageSize,
                    pageSize
                );

                var selfUrl = GetAbsoluteUrl(context, options, PagePath(page));

                var feed = new XElement(
                    Atom + "feed",
                    new XAttribute(XNamespace.Xmlns + "opds", OpdsCatalog),
                    new XAttribute(XNamespace.Xmlns + "dc", DcTerms),
                    // The feed's own IRI is its identity. It has to differ per
                    // page, and the previous hard-coded value was not a valid
                    // URN, so the URL doubles as the id.
                    new XElement(Atom + "id", selfUrl),
                    new XElement(Atom + "title", "Nostos Library"),
                    new XElement(Atom + "updated", FeedUpdated(books)),
                    new XElement(Atom + "author", new XElement(Atom + "name", "Nostos")),
                    FeedLink("self", selfUrl),
                    FeedLink("start", GetAbsoluteUrl(context, options, PagePath(1)))
                );

                if (lastPage > 1)
                {
                    feed.Add(FeedLink("first", GetAbsoluteUrl(context, options, PagePath(1))));
                    feed.Add(FeedLink("last", GetAbsoluteUrl(context, options, PagePath(lastPage))));

                    if (page < lastPage)
                    {
                        feed.Add(
                            FeedLink("next", GetAbsoluteUrl(context, options, PagePath(page + 1)))
                        );
                    }

                    if (page > 1)
                    {
                        feed.Add(
                            FeedLink(
                                "previous",
                                GetAbsoluteUrl(context, options, PagePath(page - 1))
                            )
                        );
                    }
                }

                foreach (var book in books)
                    feed.Add(BuildEntry(context, options, book));

                return Results.Text(Serialize(feed), AtomFeedType, Encoding.UTF8);
            }
        );

        return routes;
    }

    private static XElement BuildEntry(HttpContext context, OpdsOptions options, BookModel book)
    {
        var entry = new XElement(
            Atom + "entry",
            new XElement(Atom + "title", book.Title),
            new XElement(Atom + "id", $"urn:uuid:{book.Id}"),
            new XElement(Atom + "updated", Timestamp(book.CreatedAt)),
            new XElement(Atom + "published", Timestamp(book.CreatedAt))
        );

        if (!string.IsNullOrWhiteSpace(book.Author))
            entry.Add(new XElement(Atom + "author", new XElement(Atom + "name", book.Author)));

        if (!string.IsNullOrWhiteSpace(book.Metadata.Description))
        {
            entry.Add(
                new XElement(
                    Atom + "content",
                    new XAttribute("type", "text"),
                    book.Metadata.Description
                )
            );
        }

        // Language is publication metadata, so it is exported as Dublin Core
        // rather than as an xml:lang attribute — the previous
        // `<xml:lang>` ELEMENT was not valid Atom at all, and no OPDS client
        // read it.
        if (!string.IsNullOrWhiteSpace(book.Metadata.Language))
            entry.Add(new XElement(DcTerms + "language", book.Metadata.Language));

        if (Identifier(book) is { } identifier)
            entry.Add(new XElement(DcTerms + "identifier", identifier));

        // Cover and thumbnail both point at the stored cover image, with the
        // media type the file actually has (26 of the live library's covers are
        // JPEG, and every one of them used to be advertised as image/png).
        //
        // The thumbnail relation deliberately reuses the full cover: the app's
        // real thumbnail endpoint serves WebP, which e-ink OPDS readers
        // frequently cannot decode, and a broken thumbnail is worse for them
        // than a larger one they can.
        if (!string.IsNullOrWhiteSpace(book.FileDetails.CoverFileName))
        {
            var coverUrl = GetAbsoluteUrl(context, options, $"/api/books/{book.Id}/cover");
            var coverType = MediaTypeMap.ForCover(book.FileDetails.CoverFileName);

            entry.Add(Link(ImageRel, coverUrl, coverType));
            entry.Add(Link(ThumbnailRel, coverUrl, coverType));
        }

        if (!string.IsNullOrWhiteSpace(book.FileDetails.FileName))
        {
            entry.Add(
                Link(
                    AcquisitionRel,
                    GetAbsoluteUrl(context, options, $"/api/books/{book.Id}/file"),
                    MediaTypeMap.ForBookFile(book.FileDetails.FileName)
                )
            );
        }

        return entry;
    }

    private static XElement Link(string rel, string href, string type) =>
        new(
            Atom + "link",
            new XAttribute("rel", rel),
            new XAttribute("href", href),
            new XAttribute("type", type)
        );

    private static XElement FeedLink(string rel, string href) => Link(rel, href, AcquisitionFeedType);

    /// <summary>
    /// A stable identifier for the publication, when Nostos knows one.
    /// </summary>
    private static string? Identifier(BookModel book)
    {
        if (!string.IsNullOrWhiteSpace(book.NormalizedIsbn))
            return $"urn:isbn:{book.NormalizedIsbn}";

        if (!string.IsNullOrWhiteSpace(book.NormalizedAsin))
            return $"urn:asin:{book.NormalizedAsin}";

        return null;
    }

    // The feed's `updated` value is the most recently added book it contains,
    // not "now": a feed whose update time changes on every request defeats
    // client-side conditional fetching and tells a reader nothing.
    private static string FeedUpdated(IReadOnlyList<BookModel> books) =>
        books.Count == 0
            ? Timestamp(DateTime.UtcNow)
            : Timestamp(books.Max(book => book.CreatedAt));

    // RFC 3339, always with an explicit UTC offset — SQLite hands back
    // DateTimes whose Kind is not guaranteed, and an Atom timestamp without an
    // offset is not a valid RFC 3339 date-time.
    private static string Timestamp(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();
        return utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
    }

    private static int ParsePage(string? raw) =>
        int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var page)
        && page > 0
            ? page
            : 1;

    private static string PagePath(int page) => page <= 1 ? "/opds/" : $"/opds/?page={page}";

    /// <summary>
    /// The externally visible URL for a path inside the catalogue.
    ///
    /// Normally scheme and host come from the request, which is only correct
    /// when the reverse proxy's X-Forwarded-Proto / X-Forwarded-Host headers
    /// are honoured (Program.cs registers ForwardedHeaders for exactly this).
    /// <see cref="OpdsOptions.PublicBaseUrl"/> overrides both when the
    /// deployment cannot tell.
    /// </summary>
    private static string GetAbsoluteUrl(HttpContext context, OpdsOptions options, string path)
    {
        if (!string.IsNullOrEmpty(options.PublicBaseUrl))
            return options.PublicBaseUrl + path;

        var request = context.Request;
        return $"{request.Scheme}://{request.Host.ToUriComponent()}{path}";
    }

    private static string Serialize(XElement feed)
    {
        var settings = new XmlWriterSettings
        {
            OmitXmlDeclaration = false,
            Encoding = Encoding.UTF8,
            Indent = true,
        };

        var builder = new StringBuilder();
        using (var writer = XmlWriter.Create(builder, settings))
        {
            new XDocument(new XDeclaration("1.0", "utf-8", null), feed).Save(writer);
        }

        return builder.ToString();
    }
}
