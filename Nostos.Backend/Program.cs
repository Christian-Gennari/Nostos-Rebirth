using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Configuration;
using Nostos.Backend.Integrations.Mcp;
using Nostos.Backend.Providers;
using Nostos.Backend.Providers.Acquisition;
using Nostos.Backend.Providers.Acquisition.Media;
using Nostos.Backend.Providers.Contracts;
using Nostos.Backend.Providers.Gutenberg;
using Nostos.Backend.Providers.LibriVox;
using Nostos.Backend.Serialization;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<BackupSettings>(builder.Configuration.GetSection("BackupSettings"));

// Where locally stored book files live. Configurable so a test host (or a
// deployment with a dedicated media volume) can point it somewhere else —
// `Storage/books` under the content root stays the default.
builder.Services.Configure<FileStorageOptions>(
    builder.Configuration.GetSection(FileStorageOptions.SectionName));

// Library receipt retention (issue #51): the bound section is normalized
// once (unsafe values clamped) and registered as a singleton so the
// retention service and its hosted worker always agree on the effective
// bounds.
builder.Services.AddSingleton(LibraryReceiptRetentionOptions.Normalize(
    builder.Configuration.GetSection("LibraryReceiptRetention").Get<LibraryReceiptRetentionOptions>()
    ?? new LibraryReceiptRetentionOptions()));

// --- MCP (Model Context Protocol) Streamable HTTP foundation (Task 9A) ---
// Opt-in and disabled by default. When enabled, the bearer token is resolved
// ONLY from the configured environment variable at startup; a missing token
// fails startup closed so the server never runs unauthenticated. The
// validated options instance is registered as a singleton so the maintenance
// guard, the authentication middleware, and the endpoint mapping always
// agree on the normalized route. The token itself is captured in the local
// `mcpApiKey` variable, never stored in configuration, logging, or responses.
var mcpOptions = builder.Configuration.GetSection("Mcp").Get<McpOptions>() ?? new McpOptions();
string mcpApiKey = string.Empty;
if (mcpOptions.Enabled)
{
    if (!McpOptions.TryNormalizePath(mcpOptions.Path, out var normalizedPath, out var pathError))
    {
        throw new InvalidOperationException(
            $"MCP is enabled but 'Mcp:Path' is invalid ({pathError}). Disable MCP (Mcp:Enabled=false) or fix the path.");
    }

    mcpOptions.Path = normalizedPath;

    if (string.IsNullOrWhiteSpace(mcpOptions.ApiKeyEnvironmentVariable))
    {
        throw new InvalidOperationException(
            "MCP is enabled but 'Mcp:ApiKeyEnvironmentVariable' is empty. Configure an environment variable name.");
    }

    var resolvedToken = Environment.GetEnvironmentVariable(mcpOptions.ApiKeyEnvironmentVariable);
    if (!string.IsNullOrWhiteSpace(resolvedToken))
    {
        mcpApiKey = resolvedToken.Trim();
    }
    else
    {
        throw new InvalidOperationException(
            $"MCP is enabled but environment variable '{mcpOptions.ApiKeyEnvironmentVariable}' is not set or empty. " +
            "Set the token before starting Nostos, or disable MCP (Mcp:Enabled=false).");
    }

    builder.Services
        .AddMcpServer(server => server.ServerInfo = new Implementation
        {
            Name = "nostos",
            Version = "1.0.0",
        })
        .WithHttpTransport()
        .WithToolsFromAssembly();
}

builder.Services.AddSingleton(mcpOptions);

const long maxUploadSize = 100L * 1024 * 1024 * 1024; // 100GB
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadSize;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadSize;
});

builder.Services.AddDbContextFactory<NostosDbContext>(options =>
{
    var dbPath = Path.Combine(builder.Environment.ContentRootPath, "nostos.db");
    options.UseSqlite($"Data Source={dbPath}");
});
builder.Services.AddScoped<IDatabaseBootstrapService, DatabaseBootstrapService>();

// 4GB in bytes
const long maxUploadSizeGB = 4L * 1024 * 1024 * 1024;
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadSizeGB;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadSizeGB;
});

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
});

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();

// Services Dependency Injection
builder.Services.AddSingleton<IFileStorageService, FileStorageService>();
builder.Services.AddSingleton<BackupSettingsProvider>();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient(BookLookupService.HttpClientName, client =>
{
    // External metadata lookups must never occupy the whole request budget;
    // typed failure (null) flows out of the lookup service instead.
    client.Timeout = TimeSpan.FromSeconds(15);
});
builder.Services.AddScoped<BookLookupService>();
builder.Services.AddScoped<ILibraryService, LibraryService>();
builder.Services.AddScoped<LibraryReceiptRetentionService>();
builder.Services.AddScoped<MediaMetadataService>();
builder.Services.AddScoped<NoteProcessorService>();
builder.Services.AddScoped<IBackupService, BackupService>();
builder.Services.AddScoped<IBookRepository, BookRepository>();
builder.Services.AddScoped<ICollectionRepository, CollectionRepository>();
builder.Services.AddScoped<INoteRepository, NoteRepository>();
builder.Services.AddScoped<IConceptRepository, ConceptRepository>();
builder.Services.AddScoped<IWritingRepository, WritingRepository>();

// --- External content providers and acquisition (issue #166) ---
// A provider only describes remote content; the acquisition layer turns a
// described item into an ordinary local book. Adding a source is a normal DI
// registration here — there is no dynamic assembly loading and no third-party
// plugin surface.
builder.Services.Configure<AcquisitionOptions>(
    builder.Configuration.GetSection(AcquisitionOptions.SectionName));

// Auto-redirect is deliberately OFF: the downloader follows redirects itself,
// one hop at a time, so that every hop is checked against the provider's host
// allow-list instead of only the first URL.
builder.Services.AddHttpClient(ProviderContentDownloader.HttpClientName, client =>
{
    // Per-attempt deadlines belong to the downloader, not to the client: one
    // short HttpClient timeout would kill every multi-hour audiobook download.
    client.Timeout = Timeout.InfiniteTimeSpan;
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
}).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    AllowAutoRedirect = false,
    ConnectTimeout = TimeSpan.FromSeconds(30),
});

builder.Services.AddSingleton<IProviderRegistry, ProviderRegistry>();
builder.Services.AddSingleton<ITranscodeLimiter, TranscodeLimiter>();
builder.Services.AddSingleton<IProviderContentDownloader, ProviderContentDownloader>();
builder.Services.AddScoped<IAcquisitionService, AcquisitionService>();

// --- Project Gutenberg (#167) ---
// One identifiable client for the catalogue, with a short per-request timeout:
// Gutenberg asks to be treated politely, and a search must not hold a request
// open. The content downloads themselves use the separate provider-content
// client, which has its own (much longer) per-attempt budget.
builder.Services.AddHttpClient(GutenbergProvider.HttpClientName, client =>
{
    client.BaseAddress = new Uri(GutenbergCatalog.BaseUrl);
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
});

builder.Services.AddSingleton<IContentProvider, GutenbergProvider>();

// --- LibriVox (#168) ---
// The media tooling is an explicit runtime prerequisite, not an assumption:
// MediaProcessRunner resolves ffmpeg/ffprobe at startup and publishes whether
// they are present, so a missing dependency is a clear message at the point of
// use rather than a confusing failure halfway through an import.
builder.Services.Configure<MediaToolOptions>(
    builder.Configuration.GetSection(MediaToolOptions.SectionName));

builder.Services.AddSingleton<IMediaProcessRunner, MediaProcessRunner>();
builder.Services.AddSingleton<LibriVoxM4bAssembler>();

builder.Services.AddHttpClient(LibriVoxProvider.HttpClientName, client =>
{
    client.BaseAddress = new Uri(LibriVoxCatalog.BaseUrl);
    // The catalogue client is only used for the JSON feed, which is small and
    // fast; the section downloads use the separate provider-content client with
    // its own long per-attempt budget.
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Nostos/1.0 (+https://github.com/Christian-Gennari/Nostos-Rebirth)");
});

builder.Services.AddSingleton<IContentProvider, LibriVoxProvider>();

// One instance serves as the job store, the hosted worker that drains it, and
// the IAcquisitionJobManager the endpoints talk to.
builder.Services.AddSingleton<AcquisitionJobManager>();
builder.Services.AddSingleton<IAcquisitionJobManager>(sp => sp.GetRequiredService<AcquisitionJobManager>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<AcquisitionJobManager>());
builder.Services.AddHostedService<AcquisitionReconciliationWorker>();
builder.Services.AddHostedService<ConceptCleanupWorker>();
builder.Services.AddHostedService<BackupWorker>();
builder.Services.AddHostedService<LibraryReceiptRetentionWorker>();

var app = builder.Build();

// --- DATABASE BOOTSTRAP / MIGRATION ---
// A truly empty SQLite database (brand-new or zero tables) is bootstrapped
// to the complete current schema with an accurate EF migration-history
// baseline, in one transaction (see DatabaseBootstrapService). Any existing
// database goes through the ordinary EF migration path and is never
// rebaselined; a partial or unknown schema fails closed here.
using (var scope = app.Services.CreateScope())
{
    var bootstrap = scope.ServiceProvider.GetRequiredService<IDatabaseBootstrapService>();
    await bootstrap.EnsureReadyAsync();
}

// ------------------------------------

// --- GLOBAL ERROR HANDLING ---
app.UseExceptionHandler(exceptionApp =>
{
    exceptionApp.Run(async context =>
    {
        context.Response.ContentType = "application/problem+json";
        var exceptionFeature = context.Features.Get<IExceptionHandlerFeature>();
        var logger = context
            .RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("GlobalExceptionHandler");

        var error = exceptionFeature?.Error;
        var statusCode = error is BadHttpRequestException badRequest
            ? badRequest.StatusCode
            : StatusCodes.Status500InternalServerError;

        if (error is not null && statusCode >= StatusCodes.Status500InternalServerError)
        {
            logger.LogError(
                error,
                "Unhandled exception on {Method} {Path}",
                context.Request.Method,
                context.Request.Path
            );
        }

        context.Response.StatusCode = statusCode;
        await Results.Problem(
            statusCode: statusCode,
            type: statusCode == StatusCodes.Status400BadRequest
                ? "https://tools.ietf.org/html/rfc9110#section-15.5.1"
                : "https://tools.ietf.org/html/rfc9110#section-15.6.1",
            title: statusCode == StatusCodes.Status400BadRequest
                ? "The request could not be processed."
                : "An unexpected error occurred."
        ).ExecuteAsync(context);
    });
});

app.UseStatusCodePages();

// --- ROUTE & RESTORE MAINTENANCE GUARD ---
// Guards both the REST API surface and (when enabled) the MCP route. This
// middleware is registered before the MCP authentication gate, so
// maintenance stays authoritative: during a restore, MCP requests receive
// the existing 503 even with a valid bearer token.
app.Use(async (context, next) =>
{
    var mcpOptions = context.RequestServices.GetRequiredService<McpOptions>();
    var isApiPath = context.Request.Path.StartsWithSegments("/api");
    var isMcpPath = mcpOptions.Enabled && mcpOptions.Path.Length > 0 &&
                    context.Request.Path.StartsWithSegments(mcpOptions.Path);
    if (isApiPath || isMcpPath)
    {
        var settingsProvider = context.RequestServices.GetRequiredService<BackupSettingsProvider>();
        if (settingsProvider.IsInMaintenanceMode)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new { error = "Application is in maintenance mode during restore." });
            return;
        }
    }

    await next(context);
});

// --- MCP AUTHENTICATION GATE ---
// Registered after the maintenance guard (so maintenance cannot be bypassed
// by authenticating) and before static files and endpoint routing (so the
// configured MCP route cannot be reached without the exact bearer token).
// When MCP is disabled nothing is registered and the route stays unmapped.
if (mcpOptions.Enabled)
{
    app.UseMiddleware<McpAuthenticationMiddleware>(mcpApiKey);
}

// -----------------------------------

app.MapOpenApi();

// --- SERVE ANGULAR FRONTEND ---
app.UseDefaultFiles();
app.UseStaticFiles();

// ------------------------------

// Map all endpoints
app.MapBooksEndpoints();
app.MapProviderEndpoints();
app.MapNotesEndpoints();
app.MapCollectionsEndpoints();
app.MapConceptsEndpoints();
app.MapWritingsEndpoints();
app.MapOpdsEndpoints();
app.MapBackupEndpoints();

// --- MCP STREAMABLE HTTP ENDPOINT ---
if (mcpOptions.Enabled)
{
    app.MapMcp(mcpOptions.Path);
}

// --- HANDLE ANGULAR ROUTING ---
// The SPA shell is served ONLY for client-side routes. The API and MCP
// namespaces are never answered by index.html: unknown /api paths, wrong
// methods on API routes, and the MCP route family (the configured path
// when enabled, plus the conventional /mcp namespace in every
// configuration) resolve as ordinary 404/405 responses, so probes and
// misdirected clients never receive the Angular application shell. The
// fallback is deliberately method-constrained (GET/HEAD only), mirroring
// the static-file layer: every other verb on an unmapped path stays a 405
// instead of being answered with the shell.
RequestDelegate serveClientRoute = async context =>
{
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
        return;
    }

    var path = context.Request.Path;
    var isMcpPath = mcpOptions.Enabled && mcpOptions.Path.Length > 0 &&
                    path.StartsWithSegments(mcpOptions.Path);
    if (path.StartsWithSegments("/api") || path.StartsWithSegments("/mcp") || isMcpPath)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var indexHtml = Path.Combine(app.Environment.WebRootPath, "index.html");
    if (!File.Exists(indexHtml))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html";
    await context.Response.SendFileAsync(indexHtml);
};

// The fallback endpoint carries the same GET/HEAD method constraint as the
// static-file layer: the routing method matcher keeps answering every other
// verb on unmapped paths with 405 before this delegate ever runs, so mapped
// POST routes are never shadowed.
app.MapFallback(serveClientRoute)
    .WithMetadata(new HttpMethodMetadata(new[] { "GET", "HEAD" }));

app.Run();
return 0;

public partial class Program;
