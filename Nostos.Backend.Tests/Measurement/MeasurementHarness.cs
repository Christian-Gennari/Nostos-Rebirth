using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Integrations.Assistant;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Ai;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Services.Notes;
using Nostos.Backend.Tests.Services.Ai;
using Nostos.Backend.Tests.Support;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Execution harness for assistant measurement turns, wiring real SQLite services and orchestrator
/// with either the live Gemini provider or an offline scripted fake provider.
/// </summary>
public sealed class MeasurementHarness : IDisposable
{
    private readonly string _databasePath;
    private readonly ILlmProvider _llm;

    private MeasurementHarness(
        string databasePath,
        NostosDbContext dbContext,
        AssistantOrchestrator orchestrator,
        MeasurementCaptureLogger llmMetrics,
        ILlmProvider llm)
    {
        _databasePath = databasePath;
        DbContext = dbContext;
        Orchestrator = orchestrator;
        LlmMetrics = llmMetrics;
        _llm = llm;
    }

    /// <summary>Real SQLite database context for the harness.</summary>
    public NostosDbContext DbContext { get; }

    /// <summary>Production orchestrator instance under test.</summary>
    public AssistantOrchestrator Orchestrator { get; }

    /// <summary>Measurement capture logger recording execution metrics.</summary>
    public MeasurementCaptureLogger LlmMetrics { get; }

    /// <summary>
    /// Provider-reported HTTP attempts for the current harness instance. Used only when a turn threw
    /// before the orchestrator emitted its structured metrics row, so no fabricated count is recorded.
    /// </summary>
    public int UpstreamHttpAttempts => (_llm as GeminiMeasurementLlmProvider)?.UpstreamRequestCount ?? 0;

    /// <summary>
    /// Creates a fresh measurement harness. Uses live Gemini if credentials exist and fake mode is unset;
    /// otherwise configures a scripted fake provider for the specified scenario.
    /// </summary>
    public static MeasurementHarness Create(int scenarioNumber = 1)
    {
        var fixture = new SqliteTestFixture();
        var databasePath = fixture.CreateDatabasePath();

        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={databasePath}")
            .Options;

        using (var bootstrap = new NostosDbContext(options))
        {
            bootstrap.Database.EnsureCreated();
        }

        var factory = new HarnessContextFactory(options);
        var db = new NostosDbContext(options);

        var concepts = new ConceptRepository(db);
        var noteService = new NoteService(
            new NoteRepository(db),
            new BookRepository(db),
            concepts,
            new NoteProcessorService(concepts),
            new FakeThoughtProcessor(),
            db,
            NullLogger<NoteService>.Instance);

        var libraryService = new LibraryService(
            factory,
            new BookLookupService(new HarnessNoopHttpClientFactory(), new HarnessSilentLogger<BookLookupService>()));

        var registry = new AssistantCapabilityRegistry(
            AssistantCapabilities.Build(noteService, libraryService, concepts));

        var captureLogger = new MeasurementCaptureLogger();
        var assistantOptions = new AssistantOptions
        {
            Enabled = true,
            MaxToolIterations = 6,
        };
        var plans = new AssistantPlanStore();
        var settings = new AssistantSettingsService(factory);

        ILlmProvider llm = MeasurementEnvironment.HasLiveCredential && !MeasurementEnvironment.IsFake
            ? new GeminiMeasurementLlmProvider(
                MeasurementEnvironment.ApiKeys,
                MeasurementEnvironment.Model,
                MeasurementEnvironment.ThinkingLevel)
            : new ScriptedMeasurementFakeLlmProvider(scenarioNumber);

        var orchestrator = new AssistantOrchestrator(
            registry,
            llm,
            plans,
            settings,
            libraryService,
            assistantOptions,
            captureLogger);

        return new MeasurementHarness(databasePath, db, orchestrator, captureLogger, llm);
    }

    public void Dispose()
    {
        DbContext.Dispose();
        if (_llm is IDisposable disposableLlm)
        {
            disposableLlm.Dispose();
        }

        foreach (var suffix in new[] { "", "-shm", "-wal" })
        {
            try
            {
                File.Delete(_databasePath + suffix);
            }
            catch (IOException)
            {
            }
        }
    }

    private sealed class HarnessContextFactory(DbContextOptions<NostosDbContext> options)
        : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);

        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class HarnessNoopHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    private sealed class HarnessSilentLogger<T> : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => false;
        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
        }
    }

    /// <summary>
    /// Tiny deterministic scripted fake provider for offline measurement runs without network access.
    /// </summary>
    private sealed class ScriptedMeasurementFakeLlmProvider(int scenarioNumber) : ILlmProvider
    {
        private int _callCount;

        public Task<LlmCompletion> CompleteAsync(LlmCompletionRequest request, CancellationToken ct = default)
        {
            _callCount++;

            if (_callCount == 1)
            {
                var toolCall = scenarioNumber switch
                {
                    4 => new LlmToolCall("call-measure-4", "notes_capture", """{"content":"Synthetic fake capture."}"""),
                    6 => new LlmToolCall("call-measure-6", "library_create_collection", """{"name":"Fake Winter Reading"}"""),
                    7 => new LlmToolCall("call-measure-7", "library_delete_collection", """{"collectionId":"00000000-0000-0000-0000-000000000999"}"""),
                    8 => new LlmToolCall("call-measure-8", "notes_capture", """{"content":"Synthetic fake capture."}"""),
                    _ => new LlmToolCall($"call-measure-{scenarioNumber}", "library_list_collections", "{}")
                };

                return Task.FromResult(new LlmCompletion(
                    null,
                    "tool_calls",
                    [toolCall],
                    PromptTokens: 120,
                    CompletionTokens: 30,
                    ThinkingTokens: null));
            }

            return Task.FromResult(new LlmCompletion(
                "Fake mode.",
                "STOP",
                [],
                PromptTokens: 150,
                CompletionTokens: 25,
                ThinkingTokens: null));
        }
    }
}
