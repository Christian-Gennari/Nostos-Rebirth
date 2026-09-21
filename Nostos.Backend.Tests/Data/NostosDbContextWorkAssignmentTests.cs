using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Tests.Support;
using Xunit;

namespace Nostos.Backend.Tests.Data;

public sealed class NostosDbContextWorkAssignmentTests : IDisposable
{
    private readonly SqliteTestFixture _sqlite = new();

    [Fact]
    public void SaveChanges_reuses_persisted_work_that_is_not_already_tracked()
    {
        var path = _sqlite.CreateDatabasePath();
        var workId = SeedWork(path, "Meditations", "Marcus Aurelius");

        using var db = _sqlite.CreateContext(path);
        db.Works.Local.Should().BeEmpty();

        var book = new PhysicalBookModel
        {
            Title = "Meditations",
            Author = "Marcus Aurelius",
        };
        db.Books.Add(book);

        db.SaveChanges();

        book.WorkId.Should().Be(workId);
        db.Works.Count().Should().Be(1);
    }

    [Fact]
    public async Task SaveChangesAsync_reuses_the_same_persisted_work()
    {
        var path = _sqlite.CreateDatabasePath();
        var workId = SeedWork(path, "Meditations", "Marcus Aurelius");

        await using var db = _sqlite.CreateContext(path);
        db.Works.Local.Should().BeEmpty();

        var book = new PhysicalBookModel
        {
            Title = "Meditations",
            Author = "Marcus Aurelius",
        };
        db.Books.Add(book);

        await db.SaveChangesAsync();

        book.WorkId.Should().Be(workId);
        (await db.Works.CountAsync()).Should().Be(1);
    }

    [Fact]
    public void SaveChanges_prefers_a_matching_tracked_work_from_the_same_unit_of_work()
    {
        using var db = _sqlite.CreateContext();

        var work = CreateWork("The Republic", "Plato");
        var book = new PhysicalBookModel
        {
            Title = "The Republic",
            Author = "Plato",
        };

        db.Works.Add(work);
        db.Books.Add(book);

        db.SaveChanges();

        book.WorkId.Should().Be(work.Id);
        db.Works.Count().Should().Be(1);
    }

    private Guid SeedWork(string path, string title, string author)
    {
        using var db = _sqlite.CreateContext(path);
        var work = CreateWork(title, author);
        db.Works.Add(work);
        db.SaveChanges();
        return work.Id;
    }

    private static WorkModel CreateWork(string title, string author) =>
        new()
        {
            Title = title,
            Author = author,
            NormalizedTitle = BookIdentityNormalizer.NormalizeTitle(title),
            NormalizedAuthor = BookIdentityNormalizer.NormalizeAuthor(author),
        };

    public void Dispose() => _sqlite.Dispose();
}
