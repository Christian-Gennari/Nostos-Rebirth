using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Nostos.Backend.Data;

namespace Nostos.Backend.Cloud.Migrations;

/// <summary>
/// Migration-only PostgreSQL context.
///
/// It inherits the complete Nostos domain model from <see cref="NostosDbContext"/>
/// but has a distinct context type, so EF Core keeps PostgreSQL migrations
/// separate from the historic SelfHosted SQLite migration set.
/// </summary>
public sealed class PostgresNostosDbContext : NostosDbContext
{
    public PostgresNostosDbContext(DbContextOptions<PostgresNostosDbContext> options)
        : base(options)
    {
    }
}

/// <summary>
/// Design-time factory used only by `dotnet ef migrations ... --context
/// PostgresNostosDbContext`. Migration generation never needs real customer
/// credentials or a reachable database.
/// </summary>
public sealed class PostgresNostosDbContextFactory
    : IDesignTimeDbContextFactory<PostgresNostosDbContext>
{
    public PostgresNostosDbContext CreateDbContext(string[] args)
    {
        var connection =
            Environment.GetEnvironmentVariable("NOSTOS_POSTGRES_MIGRATION_CONNECTION")
            ?? "Host=localhost;Database=nostos_migrations;Username=postgres";

        var options = new DbContextOptionsBuilder<PostgresNostosDbContext>()
            .UseNpgsql(connection)
            .Options;

        return new PostgresNostosDbContext(options);
    }
}
