using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Services;
using Nostos.Backend.Tests.Support;
using Nostos.Backend.Workers;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Workers;

public sealed class AcquisitionReconciliationWorkerTests : IDisposable
{
    private readonly string _tempRoot;
    private readonly string _booksRoot;
    private readonly string _workingRoot;

    public AcquisitionReconciliationWorkerTests()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), $"nostos-recon-test-{Guid.NewGuid():N}");
        _booksRoot = Path.Combine(_tempRoot, "books");
        _workingRoot = Path.Combine(_tempRoot, "tmp", "acquisitions");
        Directory.CreateDirectory(_booksRoot);
        Directory.CreateDirectory(_workingRoot);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempRoot))
                Directory.Delete(_tempRoot, recursive: true);
        }
        catch
        {
            // Best effort cleanup
        }
    }

    [Fact]
    public async Task ReconcileAsync_FlipsStrandedDownloadingAndTranscoding_ToFailed()
    {
        using var h = AcquisitionHarness.Create();

        // Seed books: one Ready, one Downloading, one Transcoding, one Failed
        var readyId = Guid.NewGuid();
        var downloadingId = Guid.NewGuid();
        var transcodingId = Guid.NewGuid();
        var failedId = Guid.NewGuid();

        await using (var db = await h.ContextFactory.CreateDbContextAsync())
        {
            db.Books.AddRange(
                new EBookModel { Id = readyId, Title = "Ready Book", Status = BookStatus.Ready },
                new EBookModel { Id = downloadingId, Title = "Downloading Book", Status = BookStatus.Downloading },
                new AudioBookModel { Id = transcodingId, Title = "Transcoding Book", Status = BookStatus.Transcoding },
                new EBookModel { Id = failedId, Title = "Failed Book", Status = BookStatus.Failed, StatusMessage = "Existing fail" }
            );
            await db.SaveChangesAsync();
        }

        // Create an orphaned scratch directory
        var orphanedDir = Path.Combine(_workingRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(orphanedDir);
        File.WriteAllText(Path.Combine(orphanedDir, "part.tmp"), "scratch content");

        var env = new FakeWebHostEnvironment { ContentRootPath = _tempRoot };
        var storageOptions = Microsoft.Extensions.Options.Options.Create(
            new FileStorageOptions { BooksRoot = _booksRoot });
        var options = Microsoft.Extensions.Options.Options.Create(
            new AcquisitionOptions { WorkingRoot = _workingRoot });

        var worker = new AcquisitionReconciliationWorker(
            h.ContextFactory,
            env,
            storageOptions,
            options,
            NullLogger<AcquisitionReconciliationWorker>.Instance);

        await worker.ReconcileAsync();

        // 1. Check orphaned scratch directory is cleaned up
        Directory.GetDirectories(_workingRoot).Should().BeEmpty();

        // 2. Check book statuses
        await using (var db = await h.ContextFactory.CreateDbContextAsync())
        {
            var readyBook = await db.Books.SingleAsync(b => b.Id == readyId);
            readyBook.Status.Should().Be(BookStatus.Ready);

            var downloadingBook = await db.Books.SingleAsync(b => b.Id == downloadingId);
            downloadingBook.Status.Should().Be(BookStatus.Failed);
            downloadingBook.StatusMessage.Should().Be("Import interrupted by server restart.");

            var transcodingBook = await db.Books.SingleAsync(b => b.Id == transcodingId);
            transcodingBook.Status.Should().Be(BookStatus.Failed);
            transcodingBook.StatusMessage.Should().Be("Import interrupted by server restart.");

            var failedBook = await db.Books.SingleAsync(b => b.Id == failedId);
            failedBook.Status.Should().Be(BookStatus.Failed);
            failedBook.StatusMessage.Should().Be("Existing fail");
        }
    }

    private sealed class FakeWebHostEnvironment : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = null!;
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "Nostos.Tests";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}
