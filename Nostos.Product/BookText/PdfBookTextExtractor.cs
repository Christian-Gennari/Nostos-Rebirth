using UglyToad.PdfPig;

namespace Nostos.Product.BookText;

public sealed class PdfBookTextExtractor : IBookTextExtractor
{
    public BookTextSourceFormat Format => BookTextSourceFormat.Pdf;

    public Task<BookTextExtractedDocument> ExtractAsync(Stream source, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        if (source.CanSeek) source.Position = 0;

        using var document = PdfDocument.Open(source);
        var blocks = new List<BookTextArtifactBlock>();
        var order = 0;

        foreach (var page in document.GetPages())
        {
            ct.ThrowIfCancellationRequested();
            var text = BookTextNormalization.Normalize(page.Text);
            if (text.Length == 0)
                continue;

            blocks.Add(new BookTextArtifactBlock(
                Order: order++,
                Text: text,
                HeadingPath: [],
                SourceSegments:
                [
                    new BookTextSourceSegment(
                        TextStart: 0,
                        TextLength: text.Length,
                        Locator: new PdfBookTextSourceLocator(
                            PageIndex: Math.Max(0, page.Number - 1),
                            PageLabel: null,
                            StartTextOffset: 0,
                            EndTextOffset: text.Length)),
                ]));
        }

        return Task.FromResult(new BookTextExtractedDocument(Format, blocks));
    }
}
