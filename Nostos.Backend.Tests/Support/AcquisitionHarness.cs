using System.Net.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Library;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Tests.Support;

public sealed class FakeContentProvider : IContentProvider,
    IProviderSearch,
    IProviderCatalog,
    IProviderAcquisitionPlanner,
    IProviderDownloadPolicy
{
    public FakeContentProvider(
        string id = "fake-provider",
        string displayName = "Fake Provider",
        string? rightsNotice = "Public Domain (Fake)",
        IReadOnlyList<string>? allowedHosts = null,
        long maxBytesPerPart = 10 * 1024 * 1024,
        long maxTotalBytes = 50 * 1024 * 1024,
        int maxParts = 10)
    {
        Id = id;
        DisplayName = displayName;
        RightsNotice = rightsNotice;
        AllowedHosts = allowedHosts ?? new[] { "example.com", "fake.org" };
        MaxBytesPerPart = maxBytesPerPart;
        MaxTotalBytes = maxTotalBytes;
        MaxParts = maxParts;
    }

    public string Id { get; }
    public string DisplayName { get; }
    public ProviderCapabilities Capabilities { get; set; } =
        ProviderCapabilities.Search |
        ProviderCapabilities.ItemRetrieval |
        ProviderCapabilities.EbookAcquisition |
        ProviderCapabilities.AudiobookAcquisition |
        ProviderCapabilities.CoverArt |
        ProviderCapabilities.RightsInformation;

    public string? RightsNotice { get; }

    public IReadOnlyList<string> AllowedHosts { get; set; }
    public long MaxBytesPerPart { get; set; }
    public long MaxTotalBytes { get; set; }
    public int MaxParts { get; set; }

    public ProviderSearchPage SearchResult { get; set; } = new(Array.Empty<ProviderItem>());
    public ProviderItem? ItemResult { get; set; }
    public ProviderAcquisitionPlan? PlanResult { get; set; }
    public Exception? ExceptionToThrowOnPlan { get; set; }
    public int PlanCallCount { get; private set; }

    public Task<ProviderSearchPage> SearchAsync(ProviderSearchQuery query, CancellationToken ct = default) =>
        Task.FromResult(SearchResult);

    public Task<ProviderItem?> GetItemAsync(string externalId, CancellationToken ct = default) =>
        Task.FromResult(ItemResult);

    public Task<ProviderAcquisitionPlan?> PlanAcquisitionAsync(ProviderAcquisitionRequest request, CancellationToken ct = default)
    {
        PlanCallCount++;
        if (ExceptionToThrowOnPlan is not null)
            throw ExceptionToThrowOnPlan;

        return Task.FromResult(PlanResult);
    }
}

public sealed class FakeAssemblingContentProvider : IContentProvider,
    IProviderSearch,
    IProviderCatalog,
    IProviderAcquisitionPlanner,
    IProviderDownloadPolicy,
    IAcquisitionAssembler
{
    public FakeAssemblingContentProvider(
        string id = "fake-assembler",
        string displayName = "Fake Assembling Provider",
        string? rightsNotice = "Public Domain (Fake)",
        IReadOnlyList<string>? allowedHosts = null,
        long maxBytesPerPart = 10 * 1024 * 1024,
        long maxTotalBytes = 50 * 1024 * 1024,
        int maxParts = 10)
    {
        Id = id;
        DisplayName = displayName;
        RightsNotice = rightsNotice;
        AllowedHosts = allowedHosts ?? new[] { "example.com", "fake.org" };
        MaxBytesPerPart = maxBytesPerPart;
        MaxTotalBytes = maxTotalBytes;
        MaxParts = maxParts;
    }

    public string Id { get; }
    public string DisplayName { get; }
    public ProviderCapabilities Capabilities =>
        ProviderCapabilities.Search |
        ProviderCapabilities.ItemRetrieval |
        ProviderCapabilities.EbookAcquisition |
        ProviderCapabilities.AudiobookAcquisition |
        ProviderCapabilities.CoverArt |
        ProviderCapabilities.RightsInformation |
        ProviderCapabilities.RequiresAssembly;

    public string? RightsNotice { get; }

    public IReadOnlyList<string> AllowedHosts { get; set; }
    public long MaxBytesPerPart { get; set; }
    public long MaxTotalBytes { get; set; }
    public int MaxParts { get; set; }

    public ProviderSearchPage SearchResult { get; set; } = new(Array.Empty<ProviderItem>());
    public ProviderItem? ItemResult { get; set; }
    public ProviderAcquisitionPlan? PlanResult { get; set; }
    public Exception? ExceptionToThrowOnPlan { get; set; }
    public int PlanCallCount { get; private set; }

    public Func<AcquisitionAssemblyContext, CancellationToken, Task<AcquisitionArtifact>>? AssembleFunc { get; set; }
    public Exception? ExceptionToThrowOnAssemble { get; set; }
    public int AssembleCallCount { get; private set; }

    public Task<ProviderSearchPage> SearchAsync(ProviderSearchQuery query, CancellationToken ct = default) =>
        Task.FromResult(SearchResult);

    public Task<ProviderItem?> GetItemAsync(string externalId, CancellationToken ct = default) =>
        Task.FromResult(ItemResult);

    public Task<ProviderAcquisitionPlan?> PlanAcquisitionAsync(ProviderAcquisitionRequest request, CancellationToken ct = default)
    {
        PlanCallCount++;
        if (ExceptionToThrowOnPlan is not null)
            throw ExceptionToThrowOnPlan;

        return Task.FromResult(PlanResult);
    }

    public async Task<AcquisitionArtifact> AssembleAsync(AcquisitionAssemblyContext context, CancellationToken ct = default)
    {
        AssembleCallCount++;
        if (ExceptionToThrowOnAssemble is not null)
            throw ExceptionToThrowOnAssemble;

        if (AssembleFunc is not null)
            return await AssembleFunc(context, ct);

        // Default assembly implementation: write combined artifact
        var outputPath = Path.Combine(context.WorkingDirectory, $"assembled{context.Plan.Output.FileExtension}");
        await File.WriteAllBytesAsync(outputPath, new byte[] { 1, 2, 3, 4 }, ct);
        return new AcquisitionArtifact(outputPath, context.Plan.Output.FileExtension, context.Plan.Output.ContentType);
    }
}

public sealed class FakeProviderContentDownloader : IProviderContentDownloader
{
    public List<Uri> RequestedUrls { get; } = new();
    public byte[] DefaultPayload { get; set; } = new byte[] { 10, 20, 30, 40, 50 };
    public byte[]? DefaultCoverPayload { get; set; }
    public Func<CancellationToken, Task>? OnDownloadAsync { get; set; }
    public Exception? ExceptionToThrowOnDownload { get; set; }
    public Exception? ExceptionToThrowOnDownloadBytes { get; set; }
    public int DownloadCallCount { get; private set; }
    public int DownloadBytesCallCount { get; private set; }

    public async Task<long> DownloadAsync(
        Uri url,
        string destinationPath,
        IProviderDownloadPolicy policy,
        long totalBudgetBytes,
        IProgress<long>? progress,
        CancellationToken ct)
    {
        DownloadCallCount++;
        RequestedUrls.Add(url);

        if (OnDownloadAsync is not null)
            await OnDownloadAsync(ct);

        if (ExceptionToThrowOnDownload is not null)
            throw ExceptionToThrowOnDownload;

        var dir = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        await File.WriteAllBytesAsync(destinationPath, DefaultPayload, ct);
        progress?.Report(DefaultPayload.Length);
        return DefaultPayload.Length;
    }

    public Task<byte[]> DownloadBytesAsync(
        Uri url,
        IProviderDownloadPolicy policy,
        long maxBytes,
        CancellationToken ct)
    {
        DownloadBytesCallCount++;
        RequestedUrls.Add(url);

        if (ExceptionToThrowOnDownloadBytes is not null)
            throw ExceptionToThrowOnDownloadBytes;

        return Task.FromResult(DefaultCoverPayload ?? Array.Empty<byte>());
    }
}

public sealed class AcquisitionHarness : IDisposable
{
    public string RootDir { get; }
    public string BooksRootDir { get; }
    public string WorkingRootDir { get; }
    public string DatabasePath { get; }

    public DbContextOptions<NostosDbContext> DbOptions { get; }
    public IDbContextFactory<NostosDbContext> ContextFactory { get; }
    public FileStorageService Storage { get; }
    public LibraryService Library { get; }
    public TranscodeLimiter Limiter { get; }
    public FakeProviderContentDownloader Downloader { get; }
    public AcquisitionOptions AcquisitionOpts { get; }
    public TestWebHostEnvironment Environment { get; }

    private AcquisitionHarness(
        string rootDir,
        string booksRootDir,
        string workingRootDir,
        string databasePath,
        DbContextOptions<NostosDbContext> dbOptions,
        IDbContextFactory<NostosDbContext> contextFactory,
        FileStorageService storage,
        LibraryService library,
        TranscodeLimiter limiter,
        FakeProviderContentDownloader downloader,
        AcquisitionOptions acquisitionOpts,
        TestWebHostEnvironment environment)
    {
        RootDir = rootDir;
        BooksRootDir = booksRootDir;
        WorkingRootDir = workingRootDir;
        DatabasePath = databasePath;
        DbOptions = dbOptions;
        ContextFactory = contextFactory;
        Storage = storage;
        Library = library;
        Limiter = limiter;
        Downloader = downloader;
        AcquisitionOpts = acquisitionOpts;
        Environment = environment;
    }

    public static AcquisitionHarness Create()
    {
        var rootDir = Path.Combine(Path.GetTempPath(), $"nostos-acq-test-{Guid.NewGuid():N}");
        var booksRootDir = Path.Combine(rootDir, "books");
        var workingRootDir = Path.Combine(rootDir, "staging");
        var databasePath = Path.Combine(rootDir, "nostos.db");

        Directory.CreateDirectory(booksRootDir);
        Directory.CreateDirectory(workingRootDir);

        var dbOptions = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={databasePath}")
            .Options;

        using (var bootstrap = new NostosDbContext(dbOptions))
        {
            bootstrap.Database.EnsureCreated();
        }

        var contextFactory = new TestContextFactory(dbOptions);

        var env = new TestWebHostEnvironment
        {
            ApplicationName = "Nostos.Backend",
            EnvironmentName = "Test",
            ContentRootPath = rootDir,
            WebRootPath = Path.Combine(rootDir, "wwwroot"),
        };

        var fileStorageOptions = Microsoft.Extensions.Options.Options.Create(new FileStorageOptions
        {
            BooksRoot = booksRootDir,
        });
        var storage = new FileStorageService(env, fileStorageOptions, new SilentLogger<FileStorageService>());

        var lookup = new BookLookupService(new NoopHttpClientFactory(), new SilentLogger<BookLookupService>());
        var library = new LibraryService(contextFactory, lookup);

        var acqOptions = new AcquisitionOptions
        {
            WorkingRoot = workingRootDir,
            MinimumFreeSpaceBytes = 1,
            FreeSpaceFactor = 1.0,
            DownloadConcurrency = 2,
            DownloadAttempts = 2,
        };
        var acqOptionsWrapper = Microsoft.Extensions.Options.Options.Create(acqOptions);

        var limiter = new TranscodeLimiter(acqOptionsWrapper, new SilentLogger<TranscodeLimiter>());
        var downloader = new FakeProviderContentDownloader();

        return new AcquisitionHarness(
            rootDir,
            booksRootDir,
            workingRootDir,
            databasePath,
            dbOptions,
            contextFactory,
            storage,
            library,
            limiter,
            downloader,
            acqOptions,
            env);
    }

    public AcquisitionService CreateService(
        IProviderRegistry registry,
        IFileStorageService? storageOverride = null,
        IProviderContentDownloader? downloaderOverride = null,
        ILibraryService? libraryOverride = null)
    {
        return new AcquisitionService(
            registry,
            downloaderOverride ?? Downloader,
            storageOverride ?? Storage,
            libraryOverride ?? Library,
            ContextFactory,
            Environment,
            Limiter,
            Microsoft.Extensions.Options.Options.Create(AcquisitionOpts),
            new SilentLogger<AcquisitionService>());
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(RootDir))
                Directory.Delete(RootDir, true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    public sealed class TestContextFactory(DbContextOptions<NostosDbContext> options) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    public sealed class NoopHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    public sealed class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = string.Empty;
        public string ContentRootPath { get; set; } = string.Empty;

        public IFileProvider ContentRootFileProvider { get; set; } =
            new PhysicalFileProvider(Path.GetTempPath());

        public string WebRootPath { get; set; } = Path.GetTempPath();

        public IFileProvider WebRootFileProvider { get; set; } =
            new PhysicalFileProvider(Path.GetTempPath());
    }

    public sealed class SilentLogger<T> : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => false;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
        }
    }
}
