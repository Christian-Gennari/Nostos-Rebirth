using System.Text;
using System.Xml;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Features.Opds;

public static class OpdsEndpoints
{
    public static IEndpointRouteBuilder MapOpdsEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/opds");

        group.MapGet(
            "/",
            async (HttpContext context, NostosDbContext db) =>
            {
                // 1. Fetch books that actually have files
                var books = await db
                    .Books.AsNoTracking()
                    .Where(b => b.HasFile && b.FileName != null)
                    .OrderByDescending(b => b.CreatedAt)
                    .ToListAsync();

                // 2. Build the Feed Metadata
                XNamespace atom = "http://www.w3.org/2005/Atom";
                XNamespace opds = "http://opds-spec.org/2010/catalog";

                var doc = new XDocument(
                    new XDeclaration("1.0", "utf-8", null),
                    new XElement(
                        atom + "feed",
                        new XAttribute(XNamespace.Xmlns + "opds", opds),
                        new XElement(atom + "id", "urn:uuid:nostos-rebirth-library"),
                        new XElement(atom + "title", "Nostos Library"),
                        new XElement(atom + "updated", DateTime.UtcNow.ToString("O")),
                        new XElement(atom + "author", new XElement(atom + "name", "Nostos System")),
                        new XElement(
                            atom + "link",
                            new XAttribute("rel", "self"),
                            new XAttribute("href", GetAbsoluteUrl(context, "/opds")),
                            new XAttribute(
                                "type",
                                "application/atom+xml;profile=opds-catalog;kind=navigation"
                            )
                        ),
                        new XElement(
                            atom + "link",
                            new XAttribute("rel", "start"),
                            new XAttribute("href", GetAbsoluteUrl(context, "/opds")),
                            new XAttribute(
                                "type",
                                "application/atom+xml;profile=opds-catalog;kind=navigation"
                            )
                        )
                    )
                );

                // 3. Add Entries for each book
                foreach (var book in books)
                {
                    var entry = new XElement(
                        atom + "entry",
                        new XElement(atom + "title", book.Title),
                        new XElement(atom + "id", $"urn:uuid:{book.Id}"),
                        new XElement(atom + "updated", book.CreatedAt.ToString("O")),
                        new XElement(atom + "published", book.CreatedAt.ToString("O"))
                    );

                    if (!string.IsNullOrEmpty(book.Author))
                    {
                        entry.Add(
                            new XElement(atom + "author", new XElement(atom + "name", book.Author))
                        );
                    }

                    if (!string.IsNullOrEmpty(book.Description))
                    {
                        entry.Add(
                            new XElement(
                                atom + "content",
                                new XAttribute("type", "text"),
                                book.Description
                            )
                        );
                    }

                    if (!string.IsNullOrEmpty(book.Language))
                    {
                        entry.Add(new XElement(XNamespace.Xml + "lang", book.Language)); // standard xml:lang
                        entry.Add(
                            new XElement(
                                atom + "category",
                                new XAttribute("term", book.Language),
                                new XAttribute("label", "Language")
                            )
                        );
                    }

                    // Cover Image Link
                    if (!string.IsNullOrEmpty(book.CoverFileName))
                    {
                        entry.Add(
                            new XElement(
                                atom + "link",
                                new XAttribute("rel", "http://opds-spec.org/image"),
                                new XAttribute(
                                    "href",
                                    GetAbsoluteUrl(context, $"/api/books/{book.Id}/cover")
                                ),
                                new XAttribute("type", "image/png") // Assuming PNG based on storage service
                            )
                        );

                        // Thumbnail (reuse cover for now)
                        entry.Add(
                            new XElement(
                                atom + "link",
                                new XAttribute("rel", "http://opds-spec.org/image/thumbnail"),
                                new XAttribute(
                                    "href",
                                    GetAbsoluteUrl(context, $"/api/books/{book.Id}/cover")
                                ),
                                new XAttribute("type", "image/png")
                            )
                        );
                    }

                    // Acquisition Link (Download)
                    if (book.FileName != null)
                    {
                        var mimeType = GetMimeType(book.FileName);
                        entry.Add(
                            new XElement(
                                atom + "link",
                                new XAttribute("rel", "http://opds-spec.org/acquisition"),
                                new XAttribute(
                                    "href",
                                    GetAbsoluteUrl(context, $"/api/books/{book.Id}/file")
                                ),
                                new XAttribute("type", mimeType)
                            )
                        );
                    }

                    doc.Root?.Add(entry);
                }

                // Return XML
                return Results.Text(doc.ToString(), "application/atom+xml", Encoding.UTF8);
            }
        );

        return routes;
    }

    private static string GetAbsoluteUrl(HttpContext context, string relativePath)
    {
        var request = context.Request;
        var host = request.Host.ToUriComponent();
        var scheme = request.Scheme;
        return $"{scheme}://{host}{relativePath}";
    }

    private static string GetMimeType(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".epub" => "application/epub+zip",
            ".pdf" => "application/pdf",
            ".mobi" => "application/x-mobipocket-ebook",
            ".azw3" => "application/x-mobi8-ebook",
            ".txt" => "text/plain",
            ".cbz" => "application/vnd.comicbook+zip",
            ".cbr" => "application/vnd.comicbook-rar",
            _ => "application/octet-stream",
        };
    }
}
