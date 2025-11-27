using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data;

public class NostosDbContext(DbContextOptions<NostosDbContext> options) : DbContext(options)
{
  public DbSet<BookModel> Books => Set<BookModel>();
  public DbSet<NoteModel> Notes => Set<NoteModel>();
  public DbSet<CollectionModel> Collections => Set<CollectionModel>();
  public DbSet<ConceptModel> Concepts => Set<ConceptModel>();

  // NEW: Join Table
  public DbSet<NoteConceptModel> NoteConcepts => Set<NoteConceptModel>();

  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
    base.OnModelCreating(modelBuilder);

    // Configure Many-to-Many for Notes <-> Concepts
    modelBuilder.Entity<NoteConceptModel>()
        .HasKey(nc => new { nc.NoteId, nc.ConceptId });

    modelBuilder.Entity<NoteConceptModel>()
        .HasOne(nc => nc.Note)
        .WithMany(n => n.NoteConcepts) // Using the new navigation property
        .HasForeignKey(nc => nc.NoteId);

    modelBuilder.Entity<NoteConceptModel>()
        .HasOne(nc => nc.Concept)
        .WithMany()
        .HasForeignKey(nc => nc.ConceptId);
  }
}
