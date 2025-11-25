using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

// Configure the database
builder.Services.AddDbContext<NostosDbContext>(options =>
    options.UseSqlite("Data Source=nostos.db"));

var app = builder.Build();



// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}



app.UseHttpsRedirection();

app.Run();

