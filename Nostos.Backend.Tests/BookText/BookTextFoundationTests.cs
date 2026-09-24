using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Nostos.Product.BookText;

namespace Nostos.Backend.Tests.BookText;

public sealed class BookTextFoundationTests
{
    private static readonly JsonSerializerOptions Json =
        new(JsonSerializerDefaults.Web);

    [Fact]
    public void Source_revision_is_exact_source_hash_plus_extractor_identity()
    {
        var bookId = Guid.Parse("00000000-0000-0000-0000-000000000468");
        var revision = new BookTextSourceRevision(
            bookId,
            new string('A', 64),
            " extractor-v7 ",
            BookTextSourceFormat.Pdf);

        Assert.Equal(bookId, revision.BookId);
        Assert.Equal(new string('a', 64), revision.SourceSha256);
        Assert.Equal("extractor-v7", revision.ExtractorVersion);
        Assert.Equal(BookTextSourceFormat.Pdf, revision.Format);

        Assert.Throws<ArgumentException>(() =>
            new BookTextSourceRevision(
                bookId,
                "not-a-sha256",
                "extractor-v7",
                BookTextSourceFormat.Pdf));
    }

    [Fact]
    public void Artifact_round_trip_preserves_pdf_page_index_label_and_cross_page_segments()
    {
        BookTextArtifactRecord record = new BookTextArtifactBlock(
            Order: 12,
            Text: "end of page one beginning of page two",
            HeadingPath: ["Chapter One"],
            SourceSegments:
            [
                new BookTextSourceSegment(
                    TextStart: 0,
                    TextLength: 15,
                    Locator: new PdfBookTextSourceLocator(
                        PageIndex: 10,
                        PageLabel: "xii",
                        StartTextOffset: 420,
                        EndTextOffset: 435)),
                new BookTextSourceSegment(
                    TextStart: 16,
                    TextLength: 21,
                    Locator: new PdfBookTextSourceLocator(
                        PageIndex: 11,
                        PageLabel: "1",
                        StartTextOffset: 0,
                        EndTextOffset: 21)),
            ]);

        var json = JsonSerializer.Serialize(record, Json);
        var restored = JsonSerializer.Deserialize<BookTextArtifactRecord>(json, Json);

        Assert.Contains("\"recordType\":\"block\"", json, StringComparison.Ordinal);
        Assert.Contains("\"type\":\"pdf\"", json, StringComparison.Ordinal);

        var block = Assert.IsType<BookTextArtifactBlock>(restored);
        Assert.Equal(2, block.SourceSegments.Count);

        var first = Assert.IsType<PdfBookTextSourceLocator>(block.SourceSegments[0].Locator);
        var second = Assert.IsType<PdfBookTextSourceLocator>(block.SourceSegments[1].Locator);
        Assert.Equal(10, first.PageIndex);
        Assert.Equal("xii", first.PageLabel);
        Assert.Equal(11, second.PageIndex);
        Assert.Equal("1", second.PageLabel);
    }

    [Fact]
    public void Artifact_round_trip_preserves_epub_cfi_and_structural_fallback()
    {
        BookTextArtifactRecord record = new BookTextArtifactBlock(
            Order: 3,
            Text: "A sentence with nested markup.",
            HeadingPath: ["Chapter One", "A section"],
            SourceSegments:
            [
                new BookTextSourceSegment(
                    TextStart: 0,
                    TextLength: 30,
                    Locator: new EpubBookTextSourceLocator(
                        SpineIndex: 2,
                        ResourceHref: "chapter-1.xhtml",
                        Cfi: "epubcfi(/6/4!/4/2/6:0)",
                        StartTextOffset: 100,
                        EndTextOffset: 130)),
            ]);

        var json = JsonSerializer.Serialize(record, Json);
        var restored = JsonSerializer.Deserialize<BookTextArtifactRecord>(json, Json);

        var block = Assert.IsType<BookTextArtifactBlock>(restored);
        var locator = Assert.IsType<EpubBookTextSourceLocator>(block.SourceSegments.Single().Locator);
        Assert.Equal(2, locator.SpineIndex);
        Assert.Equal("chapter-1.xhtml", locator.ResourceHref);
        Assert.Equal("epubcfi(/6/4!/4/2/6:0)", locator.Cfi);
        Assert.Equal(100, locator.StartTextOffset);
        Assert.Equal(130, locator.EndTextOffset);
    }

    [Fact]
    public void Manifest_round_trip_keeps_schema_and_exact_source_revision()
    {
        var fixture = BookTextFixtureFactory.CreatePdf();
        var hash = Convert.ToHexString(SHA256.HashData(fixture.Bytes));

        BookTextArtifactRecord record = new BookTextArtifactManifest(
            BookTextArtifactSchema.CurrentVersion,
            new BookTextSourceRevision(
                Guid.Parse("00000000-0000-0000-0000-000000000468"),
                hash,
                BookTextArtifactSchema.CurrentExtractorVersion,
                fixture.Format));

        var json = JsonSerializer.Serialize(record, Json);
        var restored = JsonSerializer.Deserialize<BookTextArtifactRecord>(json, Json);

        Assert.Contains("\"recordType\":\"manifest\"", json, StringComparison.Ordinal);
        var manifest = Assert.IsType<BookTextArtifactManifest>(restored);
        Assert.Equal(BookTextArtifactSchema.CurrentVersion, manifest.SchemaVersion);
        Assert.Equal(hash.ToLowerInvariant(), manifest.Source.SourceSha256);
    }

    [Fact]
    public void Pdf_fixture_is_deterministic_and_contains_adversarial_structure()
    {
        var first = BookTextFixtureFactory.CreatePdf();
        var second = BookTextFixtureFactory.CreatePdf();

        Assert.True(first.Bytes.SequenceEqual(second.Bytes));
        Assert.Equal(BookTextSourceFormat.Pdf, first.Format);
        Assert.Equal("application/pdf", first.ContentType);

        var source = Encoding.ASCII.GetString(first.Bytes);
        Assert.StartsWith("%PDF-1.4", source, StringComparison.Ordinal);
        Assert.Contains("/Count 4", source, StringComparison.Ordinal);
        Assert.Contains(
            "/PageLabels << /Nums [0 << /S /r >> 2 << /S /D /St 1 >>] >>",
            source,
            StringComparison.Ordinal);
        Assert.Equal(2, Count(source, "A repeated sentence appears here."));
        Assert.Contains("This line ends with inter-", source, StringComparison.Ordinal);
        Assert.Contains("national prose on the next line.", source, StringComparison.Ordinal);
    }

    [Fact]
    public void Epub_fixture_is_deterministic_and_spine_order_is_explicit()
    {
        var first = BookTextFixtureFactory.CreateEpub();
        var second = BookTextFixtureFactory.CreateEpub();

        Assert.True(first.Bytes.SequenceEqual(second.Bytes));
        Assert.Equal(BookTextSourceFormat.Epub, first.Format);

        using var archive = new ZipArchive(new MemoryStream(first.Bytes), ZipArchiveMode.Read);
        Assert.Equal("mimetype", archive.Entries[0].FullName);
        Assert.Equal("application/epub+zip", ReadEntry(archive, "mimetype"));

        var package = ReadEntry(archive, "OEBPS/package.opf");
        var c1 = package.IndexOf("<itemref idref=\"c1\"/>", StringComparison.Ordinal);
        var c2a = package.IndexOf("<itemref idref=\"c2a\"/>", StringComparison.Ordinal);
        var c2b = package.IndexOf("<itemref idref=\"c2b\"/>", StringComparison.Ordinal);

        Assert.True(c1 >= 0 && c1 < c2a && c2a < c2b);

        var chapterOne = ReadEntry(archive, "OEBPS/chapter-1.xhtml");
        var chapterTwoA = ReadEntry(archive, "OEBPS/chapter-2a.xhtml");
        var chapterTwoB = ReadEntry(archive, "OEBPS/chapter-2b.xhtml");

        Assert.Contains("<em>nested</em>", chapterOne, StringComparison.Ordinal);
        Assert.Contains("Café déjà vu — Göteborg &amp; Malmö.", chapterOne, StringComparison.Ordinal);
        Assert.Contains("The duplicate quotation belongs to chapter one.", chapterOne, StringComparison.Ordinal);
        Assert.Contains("The duplicate quotation belongs to chapter one.", chapterTwoA, StringComparison.Ordinal);
        Assert.Contains("chapter-2b.xhtml#continuation", chapterTwoA, StringComparison.Ordinal);
        Assert.Contains("id=\"continuation\"", chapterTwoB, StringComparison.Ordinal);
    }

    [Fact]
    public void Future_audio_locator_is_representable_without_enabling_audio_ingestion()
    {
        BookTextSourceLocator locator = new AudioBookTextSourceLocator(
            StartMs: 8_071_000,
            EndMs: 8_164_000);

        var json = JsonSerializer.Serialize(locator, Json);
        var restored = JsonSerializer.Deserialize<BookTextSourceLocator>(json, Json);

        var audio = Assert.IsType<AudioBookTextSourceLocator>(restored);
        Assert.Equal(8_071_000, audio.StartMs);
        Assert.Equal(8_164_000, audio.EndMs);
    }

    private static string ReadEntry(ZipArchive archive, string path)
    {
        var entry = archive.GetEntry(path)
            ?? throw new InvalidOperationException($"Fixture entry '{path}' is missing.");

        using var reader = new StreamReader(
            entry.Open(),
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    private static int Count(string source, string value)
    {
        var count = 0;
        var offset = 0;

        while ((offset = source.IndexOf(value, offset, StringComparison.Ordinal)) >= 0)
        {
            count++;
            offset += value.Length;
        }

        return count;
    }
}
