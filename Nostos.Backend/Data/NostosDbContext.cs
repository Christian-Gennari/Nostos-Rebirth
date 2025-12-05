using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Data;

public class NostosDbContext(DbContextOptions<NostosDbContext> options) : DbContext(options)
{

    // Register the Base class (books)
    public DbSet<BookModel> Books => Set<BookModel>();

    // Register the Derived Classes (books)
    public DbSet<PhysicalBookModel> PhysicalBooks => Set<PhysicalBookModel>();
    public DbSet<EBookModel> EBooks => Set<EBookModel>();
    public DbSet<AudioBookModel> AudioBooks => Set<AudioBookModel>();

    // Register the Base class (writings)
    public DbSet<WritingModel> Writings => Set<WritingModel>();

    public DbSet<NoteModel> Notes => Set<NoteModel>();
    public DbSet<CollectionModel> Collections => Set<CollectionModel>();
    public DbSet<ConceptModel> Concepts => Set<ConceptModel>();
    public DbSet<NoteConceptModel> NoteConcepts => Set<NoteConceptModel>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // --- POLYMORPHIC CONFIGURATION ---
        modelBuilder.Entity<BookModel>()
            .HasDiscriminator<string>("BookType") // Creates a hidden column 'BookType'
            .HasValue<PhysicalBookModel>("physical")
            .HasValue<EBookModel>("ebook")
            .HasValue<AudioBookModel>("audiobook");


        modelBuilder.Entity<WritingModel>()
            .HasOne(w => w.Parent)
            .WithMany(w => w.Children)
            .HasForeignKey(w => w.ParentId)
            .OnDelete(DeleteBehavior.Cascade); // If you delete a folder, delete its contents


        // Configure Many-to-Many for Notes <-> Concepts
        modelBuilder.Entity<NoteConceptModel>()
                .HasKey(nc => new
                {
                    nc.NoteId,
                    nc.ConceptId
                });

        modelBuilder.Entity<NoteConceptModel>()
            .HasOne(nc => nc.Note)
            .WithMany(n => n.NoteConcepts)
            .HasForeignKey(nc => nc.NoteId);

        modelBuilder.Entity<NoteConceptModel>()
                    .HasOne(nc => nc.Concept)
                    .WithMany(c => c.NoteConcepts) // <--- UPDATED: Connects the navigation property
                    .HasForeignKey(nc => nc.ConceptId);
    }
}
