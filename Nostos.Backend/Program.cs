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
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<BackupSettings>(builder.Configuration.GetSection("BackupSettings"));
builder.Services.Configure<ReadingTrainingOptions>(builder.Configuration.GetSection("ReadingTraining"));

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
builder.Services.AddScoped<BookLookupService>();
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
builder.Services.AddHostedService<ConceptCleanupWorker>();
builder.Services.AddHostedService<BackupWorker>();
builder.Services.AddHostedService<ReadingNotificationWorker>();
builder.Services.AddHostedService<ReadingWeeklyReviewWorker>();

var app = builder.Build();

// --- AUTOMATIC DATABASE MIGRATION ---
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
    db.Database.Migrate();
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
app.MapFallbackToFile("index.html");

// ------------------------------

app.Run();

public partial class Program;
