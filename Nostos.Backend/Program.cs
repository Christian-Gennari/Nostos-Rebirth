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
using Nostos.Backend.Serialization;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining.Import;
using Nostos.Backend.Workers;

var builder = WebApplication.CreateBuilder(args);

// --- LOCAL ONE-SHOT READING IMPORT (Task 11B2) ---
// An import run must emit exactly one JSON document on stdout; drop console
// logging so no startup log can pollute it. Detection here mirrors the
// command's own exact-token detection and only affects import runs.
if (HermesReadingImportCommand.IsImportInvocation(args))
{
    builder.Logging.ClearProviders();
}

builder.Services.Configure<BackupSettings>(builder.Configuration.GetSection("BackupSettings"));
builder.Services.Configure<ReadingTrainingOptions>(builder.Configuration.GetSection("ReadingTraining"));

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
            "MCP is enabled but 'Mcp:ApiKeyEnvironmentVariable' is not configured. Disable MCP (Mcp:Enabled=false) or configure the variable name.");
    }

    mcpApiKey = Environment.GetEnvironmentVariable(mcpOptions.ApiKeyEnvironmentVariable) ?? string.Empty;
    if (string.IsNullOrEmpty(mcpApiKey))
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
builder.Services.AddSingleton(sp => sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ReadingTrainingOptions>>().Value);
builder.Services.AddSingleton<IReadingClock, SystemReadingClock>();
builder.Services.AddScoped<IReadingTrainingService, ReadingTrainingService>();
builder.Services.AddScoped<IReadingGatewayDispatcher, ReadingGatewayDispatcher>();
builder.Services.AddScoped<IReadingNotificationOutbox, ReadingNotificationOutbox>();
builder.Services.AddScoped<IHermesReadingImportService, HermesReadingImportService>();
builder.Services.AddTransient<HermesReadingImportCommand>();
builder.Services.AddHostedService<ConceptCleanupWorker>();
builder.Services.AddHostedService<BackupWorker>();
builder.Services.AddHostedService<ReadingNotificationWorker>();
builder.Services.AddHostedService<ReadingWeeklyReviewWorker>();
builder.Services.AddHostedService<LibraryReceiptRetentionWorker>();

var app = builder.Build();

var importEngaged = HermesReadingImportCommand.TryParse(
    args, out var importArguments, out var importParseError);
if (!importEngaged && importParseError is not null)
{
    var exitCode = HermesReadingImportCommand.WriteArgumentError(importParseError, Console.Out);
    await app.DisposeAsync();
    return exitCode;
}

// --- DATABASE BOOTSTRAP / MIGRATION ---
// A truly empty SQLite database (brand-new or zero tables) is bootstrapped
// to the complete current schema with an accurate EF migration-history
// baseline, in one transaction (see DatabaseBootstrapService). Any existing
// database goes through the ordinary EF migration path and is never
// rebaselined; a partial or unknown schema fails closed here.
try
{
    using var scope = app.Services.CreateScope();
    var bootstrap = scope.ServiceProvider.GetRequiredService<IDatabaseBootstrapService>();
    await bootstrap.EnsureReadyAsync();
}
catch when (importEngaged)
{
    var exitCode = HermesReadingImportCommand.WriteStartupError(
        HermesReadingImportCommand.ErrorCodes.DatabaseMigrationFailed, Console.Out);
    await app.DisposeAsync();
    return exitCode;
}

// ------------------------------------

// --- LOCAL ONE-SHOT READING IMPORT (Task 11B2) ---
// Purely local CLI: when the exact `--reading-import <absolute-directory>`
// argument is present, run a single dry run (default) or a confirmed commit
// through the DI service and exit. Kestrel and the background workers never
// start, so nothing listens on the network and no live data is touched by
// this branch itself. All other argument shapes leave normal startup below
// untouched.
if (importEngaged)
{
    await using var commandScope = app.Services.CreateAsyncScope();
    var importCommand = commandScope.ServiceProvider.GetRequiredService<HermesReadingImportCommand>();
    var exitCode = await importCommand.RunAsync(importArguments!, Console.Out);
    await app.DisposeAsync();
    return exitCode;
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

// ----------------------------

// --- MAINTENANCE MODE MIDDLEWARE ---
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

// -----------------------------

app.MapOpenApi();

// --- SERVE ANGULAR FRONTEND ---
app.UseDefaultFiles();
app.UseStaticFiles();

// ------------------------------

// Map all endpoints
app.MapBooksEndpoints();
app.MapNotesEndpoints();
app.MapCollectionsEndpoints();
app.MapConceptsEndpoints();
app.MapWritingsEndpoints();
app.MapOpdsEndpoints();
app.MapBackupEndpoints();
app.MapReadingTrainingEndpoints();

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
// static-file layer (and the previous MapFallbackToFile): the routing
// method matcher keeps answering every other verb on unmapped paths with
// 405 before this delegate ever runs, so mapped POST routes are never
// shadowed.
app.MapFallback(serveClientRoute)
    .WithMetadata(new HttpMethodMetadata(new[] { "GET", "HEAD" }));

// ------------------------------

app.Run();
return 0;

public partial class Program;
