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
    public DbSet<BackupRecord> BackupRecords => Set<BackupRecord>();

    // Register Library domain (issue #34)
    public DbSet<LibraryCommandReceipt> LibraryCommandReceipts => Set<LibraryCommandReceipt>();
    public DbSet<LibraryState> LibraryStates => Set<LibraryState>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeValueConverter>();
        configurationBuilder.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeValueConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // --- POLYMORPHIC CONFIGURATION ---
        modelBuilder
            .Entity<BookModel>()
            .HasDiscriminator<string>("BookType") // Creates a hidden column 'BookType'
            .HasValue<PhysicalBookModel>("physical")
            .HasValue<EBookModel>("ebook")
            .HasValue<AudioBookModel>("audiobook");

        modelBuilder
            .Entity<WritingModel>()
            .HasOne(w => w.Parent)
            .WithMany(w => w.Children)
            .HasForeignKey(w => w.ParentId)
            .OnDelete(DeleteBehavior.Cascade); // If you delete a folder, delete its contents

        // Configure Many-to-Many for Notes <-> Concepts
        modelBuilder.Entity<NoteConceptModel>().HasKey(nc => new { nc.NoteId, nc.ConceptId });

        modelBuilder
            .Entity<NoteConceptModel>()
            .HasOne(nc => nc.Note)
            .WithMany(n => n.NoteConcepts)
            .HasForeignKey(nc => nc.NoteId);

        modelBuilder
            .Entity<NoteConceptModel>()
            .HasOne(nc => nc.Concept)
            .WithMany(c => c.NoteConcepts) // <--- UPDATED: Connects the navigation property
            .HasForeignKey(nc => nc.ConceptId);

        // --- INDEXES ---
        modelBuilder.Entity<BookModel>().HasIndex(b => b.Title);

        modelBuilder.Entity<BookModel>().HasIndex(b => b.Author);

        modelBuilder.Entity<BookModel>().HasIndex(b => b.CollectionId);

        // Normalized identity uniqueness (filtered: NULLs are unlimited).
        modelBuilder.Entity<BookModel>()
            .HasIndex(b => b.NormalizedIsbn)
            .IsUnique()
            .HasFilter("\"NormalizedIsbn\" IS NOT NULL");
        modelBuilder.Entity<BookModel>()
            .HasIndex(b => b.NormalizedAsin)
            .IsUnique()
            .HasFilter("\"NormalizedAsin\" IS NOT NULL");

        modelBuilder.Entity<NoteModel>().HasIndex(n => n.BookId);

        modelBuilder.Entity<CollectionModel>().HasIndex(c => c.ParentId);

        // --- COLLECTIONS PHASE 1: EXPLICIT RESTRICTIVE FKs ---
        // A collection that has children or books must never be deleted by
        // a raw SQL DELETE: the database itself rejects it (the service
        // unlinks books and refuses children first with typed codes).
        modelBuilder.Entity<CollectionModel>()
            .HasOne(c => c.Parent)
            .WithMany(c => c.Children)
            .HasForeignKey(c => c.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<BookModel>()
            .HasOne(b => b.Collection)
            .WithMany()
            .HasForeignKey(b => b.CollectionId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<WritingModel>().HasIndex(w => w.ParentId);

        modelBuilder.Entity<ConceptModel>().HasIndex(c => c.Concept).IsUnique();

        // Idempotent receipt with bounded inputs (SQLite enforces the limits
        // via the CHECK constraint, not the metadata-only MaxLength). The
        // CreatedAt index backs the retention prune (issue #51).
        modelBuilder.Entity<LibraryCommandReceipt>(e =>
        {
            e.HasIndex(x => new { x.ClientId, x.IdempotencyKey }).IsUnique();
            e.HasIndex(x => x.CreatedAt);
            e.ToTable(t => t.HasCheckConstraint(
                "CK_LibraryCommandReceipts_Bounds",
                "length(\"ClientId\") <= 64 AND length(\"IdempotencyKey\") <= 128 AND " +
                "length(\"CommandKind\") <= 32 AND length(\"ResponseJson\") <= 131072"));
        });

        // --- LIBRARY DOMAIN (issue #34) ---

        // Singleton library state row: exactly one LibraryState. The fixed
        // sentinel is enforced by a CHECK constraint; the unique index on
        // SingletonSlot then allows at most one row.
        modelBuilder.Entity<LibraryState>(e =>
        {
            e.HasIndex(s => s.SingletonSlot).IsUnique();
            e.ToTable(t => t.HasCheckConstraint(
                "CK_LibraryStates_SingletonSlot",
                $"SingletonSlot = {LibraryState.SingletonSentinel}"));
        });

        // Exact-once command idempotency for library mutations.
        modelBuilder.Entity<LibraryCommandReceipt>(e =>
        {
            e.HasIndex(c => new { c.ClientId, c.IdempotencyKey }).IsUnique();
        });
    }
}
