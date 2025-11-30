using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Features.Books;
using Nostos.Backend.Features.Notes;
using Nostos.Backend.Features.Collections;
using Nostos.Backend.Features.Concepts;
using Nostos.Backend.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<NostosDbContext>(options =>
{
    options.UseSqlite("Data Source=nostos.db");
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

