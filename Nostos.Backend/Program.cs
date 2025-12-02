using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Features.Books;
using Nostos.Backend.Features.Notes;
using Nostos.Backend.Features.Collections;
using Nostos.Backend.Features.Concepts;
using Nostos.Backend.Services;
using Microsoft.AspNetCore.Http.Features;

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
app.MapOpenApi();

app.UseCors();

// Map all endpoints
app.MapBooksEndpoints();
app.MapNotesEndpoints();
app.MapCollectionsEndpoints();
app.MapConceptsEndpoints();


app.Run();

