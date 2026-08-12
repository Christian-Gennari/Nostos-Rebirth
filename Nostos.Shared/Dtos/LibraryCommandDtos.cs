using System;
using System.Collections.Generic;

namespace Nostos.Shared.Dtos;

// --- STABLE RESPONSE ENVELOPE (library domain) ---
// Mirror of the reading envelope. Every library mutation accepts a client id
// and idempotency key and returns this same semantic result across REST, MCP
// and the UI. `duplicate` means receipt replay ONLY — matching an existing
// book is `outcome: matched`, never `duplicate: true`.
public sealed record LibraryCommandResultDto(
    string Reply,
    object? Data,
    string StateVersion,
    bool Duplicate = false
);

public sealed record LibraryErrorDto(string Code);

/// <summary>
/// Error payload carrying the candidate rows that require a caller decision
/// (outcome: confirmation_required). Serialized as data on the envelope.
/// </summary>
public sealed record LibraryConfirmationErrorDto(string Code, IReadOnlyList<LibraryCandidate> Candidates);

// --- BASE REQUEST ---
public record LibraryCommandRequest(string ClientId, string IdempotencyKey);

// --- BOOK CREATE / MATCH ---
public sealed record LibraryCreateBookRequest(
    string ClientId,
    string IdempotencyKey,
    string Type,
    string Title,
    string? Subtitle = null,
    string? Author = null,
    string? Editor = null,
    string? Translator = null,
    string? Narrator = null,
    string? Description = null,
    string? Isbn = null,
    string? Asin = null,
    string? Duration = null,
    string? Publisher = null,
    string? PlaceOfPublication = null,
    string? PublishedDate = null,
    string? Edition = null,
    int? PageCount = null,
    string? Language = null,
    string? Categories = null,
    string? Series = null,
    string? VolumeNumber = null,
    Guid? CollectionId = null,
    int Rating = 0,
    bool IsFavorite = false,
    string? PersonalReview = null,
    DateTime? FinishedAt = null,
    Guid? ConfirmedBookId = null,
    bool ForceCreate = false
);

// --- BOOK UPDATE ---
// Null = leave unchanged; empty string = clear (repo NullIfEmpty convention).
// CollectionId alone cannot express "clear", so ClearCollection does.
public sealed record LibraryUpdateBookRequest(
    string ClientId,
    string IdempotencyKey,
    Guid BookId,
    string? Title = null,
    string? Subtitle = null,
    string? Author = null,
    string? Editor = null,
    string? Translator = null,
    string? Narrator = null,
    string? Description = null,
    string? Isbn = null,
    string? Asin = null,
    string? Duration = null,
    string? Publisher = null,
    string? PlaceOfPublication = null,
    string? PublishedDate = null,
    string? Edition = null,
    int? PageCount = null,
    string? Language = null,
    string? Categories = null,
    string? Series = null,
    string? VolumeNumber = null,
    Guid? CollectionId = null,
    bool ClearCollection = false,
    int? Rating = null,
    bool? IsFavorite = null,
    string? PersonalReview = null,
    DateTime? FinishedAt = null,
    bool? IsFinished = null
);

// --- RESOLVE (read-only identity resolution) ---
public sealed record LibraryResolveBookRequest(
    string? Isbn = null,
    string? Asin = null,
    string? Title = null,
    string? Author = null,
    bool IncludeExternalMetadata = true
);

public enum LibraryResolution
{
    ExactMatch,
    Candidates,
    NotFound,
    IdentityConflict,
}

public sealed record LibraryCandidate(
    Guid BookId,
    string Title,
    string? Author,
    string? Isbn,
    string? Asin,
    string MatchReason
);

public sealed record LibraryResolveResult(
    LibraryResolution Resolution,
    BookDto? MatchedBook = null,
    IReadOnlyList<LibraryCandidate>? Candidates = null,
    CreateBookDto? Prefill = null,
    string? LookupError = null
);

// --- CREATE-OR-MATCH OUTCOME (data payload of LibraryCommandResultDto) ---
public sealed record LibraryCreateOrMatchResultDto(
    string Outcome, // created | matched | confirmation_required
    Guid? BookId = null,
    BookDto? Book = null,
    IReadOnlyList<LibraryCandidate> Candidates = null!
);

// --- COLLECTIONS ---
public sealed record LibraryCreateCollectionRequest(
    string ClientId,
    string IdempotencyKey,
    string Name,
    Guid? ParentId = null
);

public sealed record LibraryRenameCollectionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid CollectionId,
    string Name
);

public sealed record LibraryMoveCollectionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid CollectionId,
    Guid? NewParentId = null
);

public sealed record LibraryDeleteCollectionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid CollectionId,
    bool Confirm = false
);

public sealed record LibraryDeleteCollectionResultDto(
    Guid CollectionId,
    int BooksUnlinked,
    int ChildrenAffected
);
