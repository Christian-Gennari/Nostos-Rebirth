using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Shared.Enums;

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

    // Register Reading Training (Nostos-owned source of truth)
    public DbSet<ReadingProgramme> ReadingProgrammes => Set<ReadingProgramme>();
    public DbSet<ReadingBookAssignment> ReadingBookAssignments => Set<ReadingBookAssignment>();
    public DbSet<ReadingSession> ReadingSessions => Set<ReadingSession>();
    public DbSet<ReadingCapture> ReadingCaptures => Set<ReadingCapture>();
    public DbSet<ReadingWeeklyReview> ReadingWeeklyReviews => Set<ReadingWeeklyReview>();
    public DbSet<ReadingModeDecision> ReadingModeDecisions => Set<ReadingModeDecision>();
    public DbSet<ReadingNotification> ReadingNotifications => Set<ReadingNotification>();
    public DbSet<ReadingCommandReceipt> ReadingCommandReceipts => Set<ReadingCommandReceipt>();
    public DbSet<ReadingImportReceipt> ReadingImportReceipts => Set<ReadingImportReceipt>();

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

        modelBuilder.Entity<NoteModel>().HasIndex(n => n.BookId);

        modelBuilder.Entity<CollectionModel>().HasIndex(c => c.ParentId);

        modelBuilder.Entity<WritingModel>().HasIndex(w => w.ParentId);

        modelBuilder.Entity<ConceptModel>().HasIndex(c => c.Concept).IsUnique();

        // --- READING TRAINING ---

        // Singleton policy row: exactly one ReadingProgramme.
        modelBuilder.Entity<ReadingProgramme>(e =>
        {
            e.HasIndex(p => p.SingletonSlot).IsUnique();
        });

        // Multiple assignments allowed; one default per mode via the nullable
        // DefaultSlot sentinel unique index.
        modelBuilder.Entity<ReadingBookAssignment>(e =>
        {
            e.HasIndex(a => a.DefaultSlot).IsUnique();
            e.HasIndex(a => new { a.Mode, a.Status, a.QueueOrder });
            e.HasOne(a => a.Book)
                .WithMany()
                .HasForeignKey(a => a.BookId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // One globally open session via the nullable OpenSlot sentinel unique index.
        modelBuilder.Entity<ReadingSession>(e =>
        {
            e.HasIndex(s => s.OpenSlot).IsUnique();
            e.HasIndex(s => s.BookId);
            e.HasIndex(s => new { s.Status, s.Mode });
            e.HasOne(s => s.BookAssignment)
                .WithMany()
                .HasForeignKey(s => s.BookAssignmentId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(s => s.Book)
                .WithMany()
                .HasForeignKey(s => s.BookId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // Capture ExternalId unique when present; verbatim text never rewritten.
        modelBuilder.Entity<ReadingCapture>(e =>
        {
            e.HasIndex(c => c.ExternalId).IsUnique();
            e.HasIndex(c => c.BookId);
            e.HasIndex(c => c.SessionId);
            e.HasOne(c => c.Book)
                .WithMany()
                .HasForeignKey(c => c.BookId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(c => c.Session)
                .WithMany()
                .HasForeignKey(c => c.SessionId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // Unique committed review per completed ISO week and mode.
        modelBuilder.Entity<ReadingWeeklyReview>(e =>
        {
            e.HasIndex(r => new { r.WeekKey, r.Mode }).IsUnique();
            e.HasMany(r => r.Decisions)
                .WithOne(d => d.WeeklyReview)
                .HasForeignKey(d => d.WeeklyReviewId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ReadingModeDecision>(e =>
        {
            e.HasIndex(d => d.SessionId);
            e.HasOne(d => d.Session)
                .WithMany()
                .HasForeignKey(d => d.SessionId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ReadingNotification>(e =>
        {
            e.HasIndex(n => n.AckedAt);
        });

        // Exact-once command idempotency.
        modelBuilder.Entity<ReadingCommandReceipt>(e =>
        {
            e.HasIndex(c => new { c.ClientId, c.IdempotencyKey }).IsUnique();
        });

        // Idempotent import by source fingerprint.
        modelBuilder.Entity<ReadingImportReceipt>(e =>
        {
            e.HasIndex(i => i.SourceFingerprint).IsUnique();
        });
    }
}
