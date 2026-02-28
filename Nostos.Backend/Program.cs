using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Endpoints;
using Nostos.Backend.Services;
using Nostos.Backend.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<NostosDbContext>(options =>
{
    options.UseSqlite("Data Source=nostos.db");
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

// Services Dependency Injection
builder.Services.AddSingleton<FileStorageService>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<BookLookupService>();
builder.Services.AddScoped<MediaMetadataService>();
builder.Services.AddScoped<NoteProcessorService>();
builder.Services.AddScoped<IBookRepository, BookRepository>();
builder.Services.AddScoped<ICollectionRepository, CollectionRepository>();
builder.Services.AddScoped<INoteRepository, NoteRepository>();
builder.Services.AddScoped<IConceptRepository, ConceptRepository>();
builder.Services.AddScoped<IWritingRepository, WritingRepository>();
builder.Services.AddHostedService<ConceptCleanupWorker>();

var app = builder.Build();

// --- AUTOMATIC DATABASE MIGRATION ---
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<NostosDbContext>();
    db.Database.Migrate();
}

// ------------------------------------

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

// --- HANDLE ANGULAR ROUTING ---
app.MapFallbackToFile("index.html");

// ------------------------------

app.Run();
