using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Services.BookText;
using Nostos.Product.BookText;
using Xunit;

namespace Nostos.Backend.Tests.BookText;

public sealed class BookTextSqliteIndexTests : IDisposable
{
    private readonly string _path =
        Path.Combine(Path.GetTempPath(), $"nostos-book-text-index-{Guid.NewGuid():N}.db");

    [Fact]
    public async Task Index_lifecycle_is_revision_safe_and_lexically_searchable()
    {
        var index = new SqliteBookTextIndex(new Factory(_path));
        await index.EnsureSchemaAsync();

        var bookId = Guid.NewGuid();
        await index.ScheduleAsync(bookId, "book.pdf", BookTextSourceFormat.Pdf);

        var pending = await index.GetStateAsync(bookId);
        Assert.NotNull(pending);
        Assert.Equal(BookTextIngestionStatus.Pending, pending!.Status);
        Assert.Equal(BookTextArtifactSchema.CurrentExtractorVersion, pending.ExtractorVersion);

        var work = await index.TryClaimNextAsync(TimeSpan.FromMinutes(15));
        Assert.NotNull(work);
        Assert.Equal(bookId, work!.BookId);
        Assert.Equal(1, work.Attempt);

        var revision = new BookTextSourceRevision(
            bookId,
            new string('a', 64),
            BookTextArtifactSchema.CurrentExtractorVersion,
            BookTextSourceFormat.Pdf);

        var chunk = new BookTextIndexedChunk(
            BookTextIdentity.ChunkId(revision, 0),
            bookId,
            revision.SourceSha256,
            revision.ExtractorVersion,
            revision.Format,
            0,
            "The lantern is the only deliberately unique searchable phrase.",
            ["Chapter One"],
            [
                new BookTextSourceSegment(
                    0,
                    64,
                    new PdfBookTextSourceLocator(4, "1", 0, 64)),
            ]);

        Assert.True(await index.ReplaceReadyAsync(revision, [chunk], chunk.Text.Length, work!.Attempt));

        var hits = await index.SearchAsync("lantern searchable", [bookId], 10);
        Assert.Single(hits);
        Assert.Equal(chunk.Id, hits[0].Chunk.Id);
        Assert.Equal(4, Assert.IsType<PdfBookTextSourceLocator>(
            hits[0].Chunk.SourceSegments.Single().Locator).PageIndex);

        var otherScope = await index.SearchAsync("lantern", [Guid.NewGuid()], 10);
        Assert.Empty(otherScope);

        // A replacement invalidates and removes the old revision before the new
        // source has finished indexing: stale text can never answer a question.
        await index.ScheduleAsync(bookId, "book.pdf", BookTextSourceFormat.Pdf);
        Assert.Empty(await index.SearchAsync("lantern", [bookId], 10));

        await index.DeleteBookAsync(bookId);
        Assert.Null(await index.GetStateAsync(bookId));
    }

    [Fact]
    public async Task Stale_processing_work_is_retryable_but_fresh_work_is_not_double_claimed()
    {
        var index = new SqliteBookTextIndex(new Factory(_path));
        await index.EnsureSchemaAsync();
        var bookId = Guid.NewGuid();
        await index.ScheduleAsync(bookId, "book.epub", BookTextSourceFormat.Epub);

        var first = await index.TryClaimNextAsync(TimeSpan.FromHours(1));
        Assert.NotNull(first);

        var duplicate = await index.TryClaimNextAsync(TimeSpan.FromHours(1));
        Assert.Null(duplicate);

        // Zero stale window is normalized by the SQL comparison to "anything
        // older than now", making the persisted Processing row claimable again.
        await Task.Delay(5);
        var retry = await index.TryClaimNextAsync(TimeSpan.Zero);
        Assert.NotNull(retry);
        Assert.Equal(2, retry!.Attempt);
    }

    public void Dispose()
    {
        foreach (var suffix in new[] { "", "-shm", "-wal" })
        {
            try { File.Delete(_path + suffix); } catch { }
        }
    }

    private sealed class Factory(string path) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext()
        {
            var options = new DbContextOptionsBuilder<NostosDbContext>()
                .UseSqlite($"Data Source={path}")
                .Options;
            return new NostosDbContext(options);
        }

        public Task<NostosDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }
}
