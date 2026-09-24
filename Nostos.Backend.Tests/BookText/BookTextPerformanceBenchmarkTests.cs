using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Services.BookText;
using Nostos.Product.BookText;
using Xunit;
using Xunit.Abstractions;

namespace Nostos.Backend.Tests.BookText;

public sealed class BookTextPerformanceBenchmarkTests(ITestOutputHelper output) : IDisposable
{
    private readonly string _path =
        Path.Combine(Path.GetTempPath(), $"nostos-book-text-benchmark-{Guid.NewGuid():N}.db");

    [Fact]
    [Trait("Category", "BookTextBenchmark")]
    public async Task Indexed_lookup_can_be_measured_against_full_source_reparse()
    {
        var fixture = BookTextFixtureFactory.CreateLargePdf();
        var extractor = new PdfBookTextExtractor();

        var parseTimer = Stopwatch.StartNew();
        BookTextExtractedDocument? extracted = null;
        const int reparseIterations = 3;
        for (var i = 0; i < reparseIterations; i++)
        {
            await using var source = new MemoryStream(fixture.Bytes);
            extracted = await extractor.ExtractAsync(source);
        }
        parseTimer.Stop();
        Assert.NotNull(extracted);

        var revision = new BookTextSourceRevision(
            Guid.NewGuid(),
            Convert.ToHexString(SHA256.HashData(fixture.Bytes)),
            BookTextArtifactSchema.CurrentExtractorVersion,
            BookTextSourceFormat.Pdf);
        var chunks = BookTextChunker.Chunk(revision, extracted!.Blocks, 1500, 2500, 180);

        var index = new SqliteBookTextIndex(new Factory(_path));
        await index.EnsureSchemaAsync();
        await index.ScheduleAsync(revision.BookId, fixture.FileName, revision.Format);
        var work = await index.TryClaimNextAsync(TimeSpan.FromMinutes(15));
        Assert.NotNull(work);

        var indexTimer = Stopwatch.StartNew();
        Assert.True(await index.ReplaceReadyAsync(revision, chunks, extracted.CharacterCount, work!.Attempt));
        indexTimer.Stop();

        const int queryIterations = 40;
        var queryTimer = Stopwatch.StartNew();
        IReadOnlyList<BookTextSearchHit> hits = [];
        for (var i = 0; i < queryIterations; i++)
        {
            hits = await index.SearchAsync(
                "amber lighthouse benchmark retrieval",
                [revision.BookId],
                8);
        }
        queryTimer.Stop();

        Assert.NotEmpty(hits);
        Assert.Contains("amber lighthouse", hits[0].Chunk.Text, StringComparison.OrdinalIgnoreCase);

        output.WriteLine(
            "source_bytes={0}; pages={1}; chars={2}; chunks={3}; " +
            "reparse_iterations={4}; reparse_total_ms={5:F1}; reparse_avg_ms={6:F1}; " +
            "index_ms={7:F1}; query_iterations={8}; query_total_ms={9:F1}; query_avg_ms={10:F2}",
            fixture.Bytes.Length,
            extracted.Blocks.Count,
            extracted.CharacterCount,
            chunks.Count,
            reparseIterations,
            parseTimer.Elapsed.TotalMilliseconds,
            parseTimer.Elapsed.TotalMilliseconds / reparseIterations,
            indexTimer.Elapsed.TotalMilliseconds,
            queryIterations,
            queryTimer.Elapsed.TotalMilliseconds,
            queryTimer.Elapsed.TotalMilliseconds / queryIterations);
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
