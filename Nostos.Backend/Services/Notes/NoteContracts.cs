namespace Nostos.Backend.Services.Notes;

/// <summary>
/// Outcome of a note mutation. Deliberately carries no HTTP type and no status
/// code: the endpoint maps <see cref="ErrorCode"/> to a status and body, the
/// same separation <c>ILibraryService</c> keeps for the library domain.
/// </summary>
public sealed record NoteCommandResult<T>(
    bool Success,
    string? ErrorCode,
    string? ErrorMessage,
    T? Value)
{
    public static NoteCommandResult<T> Ok(T value) => new(true, null, null, value);

    public static NoteCommandResult<T> Fail(string errorCode, string errorMessage) =>
        new(false, errorCode, errorMessage, default);
}

/// <summary>
/// The typed failure codes <see cref="INoteService"/> emits. Exact strings are
/// part of the service contract.
/// </summary>
public static class NoteErrorCodes
{
    public const string BookNotFound = "book_not_found";
    public const string NoteNotFound = "note_not_found";
    public const string EmptyNote = "empty_note";
    public const string ConceptNotFound = "concept_not_found";
}

/// <summary>
/// Read model for the note-review flow (issue #261): what the note says, which
/// book it belongs to, and the concepts it is currently linked to. Service
/// internal — no client contract is defined for it yet.
/// </summary>
public sealed record NoteReviewDto(
    Guid NoteId,
    Guid BookId,
    string? BookTitle,
    string Content,
    string? SelectedText,
    IReadOnlyList<string> ConceptNames);
