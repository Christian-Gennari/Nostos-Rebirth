using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Features.Books;
using Nostos.Backend.Features.Notes;
using Nostos.Backend.Features.Collections;
using Nostos.Backend.Features.Concepts;
using Nostos.Backend.Services;
using Microsoft.AspNetCore.Http.Features;
using Nostos.Backend.Features.Writings;

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

builder.Services.AddCors(opt =>
{
    opt.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});
builder.Services.AddOpenApi();

// Services Dependency Injection
builder.Services.AddSingleton<FileStorageService>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<BookLookupService>();

var app = builder.Build();

// --- ANGULAR INTEGRATION START ---
// 1. Serve Static Files
// This serves the CSS, JS, and assets from the 'wwwroot' folder.
// .NET 10 uses MapStaticAssets for optimized delivery.
app.MapStaticAssets();
// --- ANGULAR INTEGRATION END ---

app.MapOpenApi();

app.UseCors();

// Map all endpoints
app.MapBooksEndpoints();
app.MapNotesEndpoints();
app.MapCollectionsEndpoints();
app.MapConceptsEndpoints();
app.MapWritingsEndpoints();

// --- ANGULAR INTEGRATION START ---
// 2. SPA Fallback
// This must be placed AFTER all your API endpoints.
// If a request comes in that is NOT an API call and NOT a static file,
// serve index.html so Angular Routing takes over.
app.MapFallbackToFile("index.html");
// --- ANGULAR INTEGRATION END ---

app.Run();