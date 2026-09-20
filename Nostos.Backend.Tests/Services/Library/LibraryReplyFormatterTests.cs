using FluentAssertions;
using Nostos.Backend.Services.Library;
using Xunit;

namespace Nostos.Backend.Tests.Services.Library;

/// <summary>
/// The domain word for a group of editions is "Work" — in the database, in the
/// service, in the endpoints. It kept reaching copy the user actually reads: the
/// editions modal's own title, the confirmations that modal opens, and these
/// replies. The UI's vocabulary is "editions" / "edition set", so what is pinned
/// here is the LEAK, not a sentence: rewording a reply is fine, rewording it back
/// into "work" is not.
/// </summary>
public sealed class LibraryReplyFormatterTests
{
    [Fact]
    public void Work_membership_replies_do_not_expose_the_internal_word()
    {
        // Synthetic single-letter titles: a real title containing "work" would
        // make this assertion say something it does not mean.
        var replies = new[]
        {
            LibraryReplyFormatter.WorkLinked("A", "B"),
            LibraryReplyFormatter.WorkAlreadyLinked("A", "B"),
            LibraryReplyFormatter.WorkUnlinked("A"),
            LibraryReplyFormatter.WorkAlreadyStandalone("A"),
        };

        replies
            .Should()
            .OnlyContain(reply => !reply.Contains("work", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Unlinking_says_the_book_is_now_its_own_edition_set()
    {
        // The same words the store's toast uses, so the assistant's reply and the
        // toast do not describe one event two ways.
        LibraryReplyFormatter.WorkUnlinked("A").Should().Be("\"A\" is now its own edition set.");
    }
}
