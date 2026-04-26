using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Services;
using Nostos.Backend.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<BackupSettings>(builder.Configuration.GetSection("BackupSettings"));

const long maxUploadSize = 100L * 1024 * 1024 * 1024; // 100GB
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadSize;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadSize;
});

builder.Services.AddDbContext<NostosDbContext>(options =>
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

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
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
builder.Services.AddHostedService<ConceptCleanupWorker>();
builder.Services.AddHostedService<BackupWorker>();

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

        if (exceptionFeature?.Error is not null)
        {
            logger.LogError(
                exceptionFeature.Error,
                "Unhandled exception on {Method} {Path}",
                context.Request.Method,
                context.Request.Path
            );
        }

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(
            new
            {
                type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
                title = "An unexpected error occurred.",
                status = 500,
            }
        );
    });
});
app.UseStatusCodePages();

// ----------------------------

// --- MAINTENANCE MODE MIDDLEWARE ---
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
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

// --- HANDLE ANGULAR ROUTING ---
app.MapFallbackToFile("index.html");

// ------------------------------

app.Run();
