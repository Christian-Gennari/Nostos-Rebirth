using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Services.Library;

/// <summary>
/// One-time idempotent backfill of normalized book identity after the
/// AddLibraryCommandSurface migration adds the columns. Runs at startup
/// through DatabaseBootstrapService so legacy rows (created before the
/// library service existed) gain canonical identity using the exact same
/// rules as the live service. Only touches rows whose normalized values
/// differ; safe to run on every boot.
/// </summary>
public static class LibraryIdentityBackfill
{
    public static async Task BackfillAsync(NostosDbContext db, CancellationToken ct = default)
    {
        var books = await db.Books.ToListAsync(ct);
        var dirty = false;
        foreach (var book in books)
        {
            var (nIsbn, nAsin) = ComputeNormalizedIdentity(book);
            if (book.NormalizedIsbn != nIsbn || book.NormalizedAsin != nAsin)
            {
                book.NormalizedIsbn = nIsbn;
                book.NormalizedAsin = nAsin;
                dirty = true;
            }
        }

        if (dirty)
            await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Canonical normalized identity for a book, type-aware: ISBN identity
    /// only for physical/ebook, ASIN identity only for audiobooks. The
    /// library service must use this same computation everywhere.
    /// </summary>
    public static (string? NormalizedIsbn, string? NormalizedAsin) ComputeNormalizedIdentity(BookModel book)
    {
        var nIsbn = book switch
        {
            PhysicalBookModel p => BookIdentityNormalizer.NormalizeIsbn(p.Isbn),
            EBookModel e => BookIdentityNormalizer.NormalizeIsbn(e.Isbn),
            _ => null,
        };
        var nAsin = book is AudioBookModel audioBook
            ? BookIdentityNormalizer.NormalizeAsin(audioBook.Asin)
            : null;
        return (nIsbn, nAsin);
    }
}
