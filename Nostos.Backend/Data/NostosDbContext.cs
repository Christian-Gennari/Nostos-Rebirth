using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data;

public class NostosDbContext(DbContextOptions<NostosDbContext> options) : DbContext(options)
{
  public DbSet<BookModel> Books { get; set; }
}
