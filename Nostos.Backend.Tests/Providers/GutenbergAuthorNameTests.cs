using System.Net;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Providers.Gutenberg;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Providers;

/// <summary>
/// Gutenberg writes authors in catalogue order ("Shelley, Mary Wollstonecraft,
/// 1797-1851") and lists the same person more than once in a detail feed. Both
/// have to be absorbed at the provider boundary so the rest of Nostos just sees
/// an ordinary author string.
///
/// The cases run through the provider's own public surface rather than the
/// internal helper, so they exercise the path an import actually takes. The
/// fixture is the captured live feed for Pride and Prejudice with only its
/// author blocks substituted, which keeps the rest of the document real.
/// </summary>
public sealed class GutenbergAuthorNameTests
{
    private static string LoadFixture(string filename)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "gutenberg", filename);
        if (File.Exists(path))
            return File.ReadAllText(path);

        throw new FileNotFoundException($"Gutenberg test fixture '{filename}' is missing from the test output.");
    }

    /// <summary>
    /// The live feed names the author twice — once on a <c>dcterms:creator</c>
    /// entry and once on the OPDS entry — both written "Austen, Jane". Each
    /// occurrence is replaced with the blocks under test, so every input name is
    /// seen twice and de-duplication is exercised on every case. The feed's own
    /// <c>Project Gutenberg</c> author is deliberately left in place.
    /// </summary>
    private static string DetailFeedWithAuthors(params string[] authors)
    {
        var xml = LoadFixture("book-1342.opds");
        var blocks = string.Concat(authors.Select(a => $"<author><name>{a}</name></author>"));

        var substituted = Regex.Replace(xml, @"<author>\s*<name>Austen, Jane</name>\s*</author>", blocks);
        substituted.Should().NotBe(xml, "the fixture must contain the expected author blocks");

        return substituted;
    }

    private static async Task<string?> AuthorOfAsync(params string[] authors)
    {
        var handler = new StubHttpMessageHandler();
        handler.RegisterXml("/ebooks/1342.opds", DetailFeedWithAuthors(authors));

        var provider = new GutenbergProvider(
            new StubHttpClientFactory(handler), NullLogger<GutenbergProvider>.Instance);

        var item = await provider.GetItemAsync("1342", CancellationToken.None);

        item.Should().NotBeNull();
        return item!.Metadata.Author;
    }

    [Theory]
    [InlineData("Austen, Jane, 1775-1817", "Jane Austen")]
    [InlineData("Austen, Jane, 1775-", "Jane Austen")]
    [InlineData("Shelley, Mary Wollstonecraft, 1797-1851", "Mary Wollstonecraft Shelley")]
    [InlineData("King, Martin Luther, Jr.", "Martin Luther King, Jr.")]
    [InlineData("Engels, Friedrich", "Friedrich Engels")]
    [InlineData("Homer", "Homer")]
    [InlineData("  Austen ,  Jane  ", "Jane Austen")]
    public async Task Inverts_catalogue_order_and_drops_life_dates(string raw, string expected)
    {
        (await AuthorOfAsync(raw)).Should().Be(expected);
    }

    [Fact]
    public async Task Keeps_every_author_of_a_multi_author_work_in_feed_order()
    {
        (await AuthorOfAsync("Engels, Friedrich", "Marx, Karl"))
            .Should().Be("Friedrich Engels, Karl Marx");
    }

    [Fact]
    public async Task Names_the_same_person_once_when_the_feed_lists_them_twice()
    {
        // The defect the live feed exposed: Pride and Prejudice was acquiring an
        // author of "Jane Austen, Jane Austen".
        (await AuthorOfAsync("Austen, Jane", "Austen, Jane")).Should().Be("Jane Austen");
    }

    [Fact]
    public async Task Collapses_the_same_person_written_two_different_ways()
    {
        (await AuthorOfAsync("Austen, Jane", "Jane Austen")).Should().Be("Jane Austen");
    }

    [Fact]
    public async Task Stores_no_author_rather_than_the_feeds_own_publisher()
    {
        // The feed-level <author>Project Gutenberg</author> is the catalogue, not
        // the author of the work, and must never be picked up.
        (await AuthorOfAsync()).Should().BeNull();
    }

    [Fact]
    public async Task Keeps_the_book_when_the_author_is_unusable()
    {
        // A catalogue entry with no author is still importable.
        var handler = new StubHttpMessageHandler();
        handler.RegisterXml("/ebooks/1342.opds", DetailFeedWithAuthors(", ,"));

        var provider = new GutenbergProvider(
            new StubHttpClientFactory(handler), NullLogger<GutenbergProvider>.Instance);

        var item = await provider.GetItemAsync("1342", CancellationToken.None);

        item.Should().NotBeNull();
        item!.Metadata.Author.Should().BeNull();
        item.Metadata.Title.Should().Be("Pride and Prejudice");
    }
}
