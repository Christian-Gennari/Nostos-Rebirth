using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data;


public class NostosDbContext(DbContextOptions<NostosDbContext> options) : DbContext(options)
{
  public DbSet<BookModel> Books => Set<BookModel>();
  public DbSet<NoteModel> Notes => Set<NoteModel>();
  public DbSet<CollectionModel> Collections => Set<CollectionModel>();
  public DbSet<ConceptModel> Concepts => Set<ConceptModel>();
}
