using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Features.Books;

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


var app = builder.Build();
app.MapOpenApi();

app.UseCors();

app.MapBooksEndpoints();

app.Run();

