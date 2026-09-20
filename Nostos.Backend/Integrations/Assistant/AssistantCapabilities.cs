using System.Text.Json;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Services.Library;
using Nostos.Backend.Services.Notes;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Integrations.Assistant;

/// <summary>
/// The complete assistant action surface (issue #260 §5, §6). It is
/// deliberately small: every capability delegates to a canonical service
/// (<see cref="INoteService"/>, <see cref="ILibraryService"/>, or the existing
/// concept read repository) and nothing here reimplements library or note
/// logic.
///
/// Trust classes: read-only capabilities are <see cref="AssistantTrustClass.Suggest"/>
/// and never call a write method; capture is <see cref="AssistantTrustClass.Capture"/>
/// and runs immediately; concept linking and collection writes are
/// <see cref="AssistantTrustClass.PlanAndAct"/> and cannot run without a
/// matching approval. There is deliberately no delete, remove, purge, reset,
/// import, or bulk capability.
/// </summary>
public static class AssistantCapabilities
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Builds the ordered capability list against the canonical services. The
    /// registry owns enforcement; this method only declares what can be done.
    /// </summary>
    public static IReadOnlyList<AssistantCapability> Build(
        INoteService notes,
        ILibraryService library,
        IConceptRepository concepts) =>
    [
        // ------------------------------------------------------------------
        // Read (Suggest): proposals/reads only, structurally unable to mutate.
        // ------------------------------------------------------------------

        new AssistantCapability(
            "library_resolve_book",
            AssistantTrustClass.Suggest,
            "Finds a book by ISBN, ASIN, title, or author without changing the library.",
            """
            {
              "type": "object",
              "properties": {
                "isbn": { "type": "string", "description": "The book's ISBN, when the user gave one. Leave it out when you do not know it." },
                "asin": { "type": "string", "description": "The book's ASIN, when the user gave one. Leave it out when you do not know it." },
                "title": { "type": "string", "description": "The book's title as the user said it. Use it to resolve the book by title." },
                "author": { "type": "string", "description": "The book's author as the user said it. Combine it with a title to narrow the match." },
                "includeExternalMetadata": { "type": "boolean", "description": "Set false to resolve only against the local library and skip external metadata lookups." }
              },
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var request = new LibraryResolveBookRequest(
                    Isbn: Str(args, "isbn"),
                    Asin: Str(args, "asin"),
                    Title: Str(args, "title"),
                    Author: Str(args, "author"),
                    IncludeExternalMetadata: Bool(args, "includeExternalMetadata") ?? true);

                var result = await library.ResolveBookAsync(request, ct);
                return AssistantToolResult.Ok(Element(result));
            }),

        new AssistantCapability(
            "library_list_books",
            AssistantTrustClass.Suggest,
            "Lists books with optional filter, sort, search, and collection restriction.",
            """
            {
              "type": "object",
              "properties": {
                "search": { "type": "string", "description": "Words to match against book titles and authors. Omit it to list everything." },
                "filter": { "type": "string", "enum": ["All", "Favorites", "Finished", "Reading", "Unsorted", "NotStarted"], "description": "Restrict the list to one shelf. Defaults to All." },
                "sort": { "type": "string", "enum": ["Recent", "Title", "Rating", "LastRead"], "description": "How to order the results. Defaults to Recent." },
                "page": { "type": "integer", "description": "The 1-based page of results to return. Defaults to 1." },
                "pageSize": { "type": "integer", "description": "How many books to return per page. Defaults to 20; the service clamps it to 100." },
                "collectionId": { "type": "string", "format": "uuid", "description": "Limit the list to one collection by its id. Omit it for the whole library." },
                "format": { "type": "string", "enum": ["audiobook", "ebook", "pdf"], "description": "Use the Library's built-in format filter. Omit it for all formats." }
              },
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var result = await library.ListBooksAsync(
                    filter: ValueEnum(args, "filter", BookFilter.All),
                    sort: ValueEnum(args, "sort", BookSort.Recent),
                    search: Str(args, "search"),
                    page: Num(args, "page") ?? 1,
                    pageSize: Num(args, "pageSize") ?? 20,
                    collectionId: Id(args, "collectionId"),
                    format: Str(args, "format"),
                    ct: ct);

                return LibraryResult(result);
            }),

        new AssistantCapability(
            "library_overview",
            AssistantTrustClass.Suggest,
            "Returns a compact, complete overview of the user's books and collections for whole-library organization, recommendation, or structure questions. Prefer this over generic advice when the user asks about their library as a whole.",
            """
            {
              "type": "object",
              "properties": {},
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                const int pageSize = 100;
                var page = 1;
                var totalCount = 0;
                var books = new List<object>();

                while (true)
                {
                    var result = await library.ListBooksAsync(
                        filter: BookFilter.All,
                        sort: BookSort.Title,
                        search: null,
                        page: page,
                        pageSize: pageSize,
                        collectionId: null,
                        ct: ct);

                    if (result.Data is not PaginatedResponse<BookDto> batch)
                    {
                        return AssistantToolResult.Fail(
                            AssistantErrorCodes.NotFound,
                            "The library overview could not read the book list.");
                    }

                    var items = batch.Items.ToList();
                    totalCount = batch.TotalCount;
                    books.AddRange(items.Select(book => (object)new
                    {
                        book.Id,
                        book.Title,
                        book.Author,
                        book.Type,
                        book.CollectionIds,
                    }));

                    if (books.Count >= totalCount || items.Count == 0)
                    {
                        break;
                    }

                    page++;
                }

                var collections = await library.ListCollectionsAsync(ct);
                var counts = await library.GetStatusCountsAsync(ct);

                return AssistantToolResult.Ok(Element(new
                {
                    totalBooks = totalCount,
                    books,
                    collections = collections.Data,
                    statusAndFormatCounts = counts.Data,
                }));
            }),

        new AssistantCapability(
            "notes_list_for_book",
            AssistantTrustClass.Suggest,
            "Lists the notes captured against one book.",
            """
            {
              "type": "object",
              "properties": {
                "bookId": { "type": "string", "format": "uuid", "description": "The id of the book whose notes you want. Required." }
              },
              "required": ["bookId"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "bookId") is not { } bookId)
                {
                    return Invalid("'bookId' is required.");
                }

                var result = await notes.GetByBookAsync(bookId, ct);
                return AssistantToolResult.Ok(Element(result));
            }),

        new AssistantCapability(
            "notes_search",
            AssistantTrustClass.Suggest,
            "Searches note text and book titles.",
            """
            {
              "type": "object",
              "properties": {
                "query": { "type": "string", "description": "The search words to match against note text and book titles. This is a search phrase, not a question for you to answer. Required." },
                "limit": { "type": "integer", "description": "The maximum number of matching notes to return. Defaults to 20." }
              },
              "required": ["query"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var query = Str(args, "query");
                if (string.IsNullOrWhiteSpace(query))
                {
                    return Invalid("'query' is required.");
                }

                var result = await notes.SearchAsync(query, Num(args, "limit") ?? 20, ct);
                return AssistantToolResult.Ok(Element(result));
            }),

        new AssistantCapability(
            "notes_list_unlinked",
            AssistantTrustClass.Suggest,
            "Lists notes that belong to no concept, for the review queue.",
            """
            {
              "type": "object",
              "properties": {
                "limit": { "type": "integer", "description": "The maximum number of unlinked notes to return. Defaults to 20." },
                "offset": { "type": "integer", "description": "How many unlinked notes to skip before returning results. Defaults to 0." }
              },
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var result = await notes.GetUnlinkedAsync(
                    Num(args, "limit") ?? 20,
                    Num(args, "offset") ?? 0,
                    ct);

                return AssistantToolResult.Ok(Element(result));
            }),

        new AssistantCapability(
            "notes_read_for_review",
            AssistantTrustClass.Suggest,
            "Reads one note (text, book, linked concepts) for the review flow.",
            """
            {
              "type": "object",
              "properties": {
                "noteId": { "type": "string", "format": "uuid", "description": "The id of the single note to read for review. Required." }
              },
              "required": ["noteId"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "noteId") is not { } noteId)
                {
                    return Invalid("'noteId' is required.");
                }

                var review = await notes.GetForReviewAsync(noteId, ct);
                return review is null
                    ? AssistantToolResult.Fail(
                        AssistantErrorCodes.NotFound,
                        $"Note {noteId} not found.")
                    : AssistantToolResult.Ok(Element(review));
            }),

        new AssistantCapability(
            "concepts_list",
            AssistantTrustClass.Suggest,
            "Lists concepts ordered by usage.",
            """
            {
              "type": "object",
              "properties": {},
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var result = await concepts.GetAllWithUsageCountAsync();
                return AssistantToolResult.Ok(Element(result));
            }),

        new AssistantCapability(
            "concepts_search",
            AssistantTrustClass.Suggest,
            "Searches concepts by the text of their linked notes.",
            """
            {
              "type": "object",
              "properties": {
                "term": { "type": "string", "description": "The search term to match against the text of notes linked to concepts. This is a search term, not a question for you to answer. Required." }
              },
              "required": ["term"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var term = Str(args, "term");
                if (string.IsNullOrWhiteSpace(term))
                {
                    return Invalid("'term' is required.");
                }

                var result = await concepts.SearchByNoteTextAsync(term);
                return AssistantToolResult.Ok(Element(result));
            }),

        new AssistantCapability(
            "library_list_collections",
            AssistantTrustClass.Suggest,
            "Lists all collections as a flat (id, name, parentId) list.",
            """
            {
              "type": "object",
              "properties": {},
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var result = await library.ListCollectionsAsync(ct);
                return LibraryResult(result);
            }),

        new AssistantCapability(
            "library_get_collection",
            AssistantTrustClass.Suggest,
            "Gets one collection and its membership.",
            """
            {
              "type": "object",
              "properties": {
                "collectionId": { "type": "string", "format": "uuid", "description": "The id of the collection to read. Required." }
              },
              "required": ["collectionId"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "collectionId") is not { } collectionId)
                {
                    return Invalid("'collectionId' is required.");
                }

                var result = await library.GetCollectionAsync(collectionId, ct);
                return LibraryResult(result);
            }),

        // ------------------------------------------------------------------
        // Capture: low risk, runs immediately. The context's client/key pair
        // flows straight into CanonicalCapture, so a retry is exactly-once.
        // ------------------------------------------------------------------

        new AssistantCapability(
            "notes_capture",
            AssistantTrustClass.Capture,
            "Saves one of the user's own thoughts, observations or quotes as a note against the book that is open. Use it whenever the user gives you something of their own to keep — they do not have to say 'save' or 'note', and a thought of theirs must be saved rather than answered. The book is supplied by the app; never pass one.",
            """
            {
              "type": "object",
              "properties": {
                "content": { "type": "string", "description": "The user's own words for the note, exactly as they said or wrote them, with only any instruction removed. Never paraphrase, shorten, translate, correct or add to them. A separate setting decides how the words are rendered." },
                "selectedText": { "type": "string", "description": "A passage quoted from the book itself. When the reader has a passage selected it is already in the current context — capture it here rather than asking for it. It is stored as the quotation and is never rewritten by any processing setting." },
                "captureSource": { "type": "string", "description": "Where the words came from. Defaults to 'text'." }
              },
              "required": [],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "bookId") is not { } bookId)
                {
                    return Invalid("'bookId' is required.");
                }

                var content = Str(args, "content");
                var selectedText = Str(args, "selectedText");
                if (string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(selectedText))
                {
                    return Invalid("'content' or 'selectedText' is required.");
                }

                var request = new CaptureNoteRequest(
                    BookId: bookId,
                    Content: content ?? string.Empty,
                    CfiRange: Str(args, "cfiRange"),
                    SelectedText: selectedText,
                    RawContent: Str(args, "rawContent"),
                    CaptureSource: Str(args, "captureSource") ?? "text",
                    ProcessingMode: Str(args, "processingMode") ?? "verbatim",
                    SourceAnchorKind: Str(args, "sourceAnchorKind") ?? "unknown",
                    SourceAnchorValue: Str(args, "sourceAnchorValue"),
                    AnchorVerified: Bool(args, "anchorVerified") ?? false,
                    ClientId: context.ClientId,
                    IdempotencyKey: context.IdempotencyKey);

                var result = await notes.CaptureAsync(request, ct);
                return NoteResult(result);
            }),

        // ------------------------------------------------------------------
        // PlanAndAct: state-changing; the registry refuses without a matching
        // approval. All three delegate to the canonical service.
        // ------------------------------------------------------------------

        new AssistantCapability(
            "notes_link_existing_concept",
            AssistantTrustClass.PlanAndAct,
            "Links a note to an existing concept. Never creates a concept.",
            """
            {
              "type": "object",
              "properties": {
                "noteId": { "type": "string", "format": "uuid", "description": "The id of the note to link. Required." },
                "conceptId": { "type": "string", "format": "uuid", "description": "The id of an existing concept to link the note to. Never invent one; find it with concepts_list or concepts_search. Required." }
              },
              "required": ["noteId", "conceptId"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "noteId") is not { } noteId || Id(args, "conceptId") is not { } conceptId)
                {
                    return Invalid("'noteId' and 'conceptId' are required.");
                }

                var result = await notes.LinkToExistingConceptAsync(noteId, conceptId, ct);
                return NoteResult(result);
            }),

        new AssistantCapability(
            "library_create_collection",
            AssistantTrustClass.PlanAndAct,
            "Creates a collection (or returns the existing sibling with the same name).",
            """
            {
              "type": "object",
              "properties": {
                "name": { "type": "string", "description": "The new collection's name. Required." },
                "parentId": { "type": "string", "format": "uuid", "description": "The id of the parent collection. Omit it to create the collection at the top level." }
              },
              "required": ["name"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                var name = Str(args, "name");
                if (string.IsNullOrWhiteSpace(name))
                {
                    return Invalid("'name' is required.");
                }

                var result = await library.CreateCollectionAsync(
                    new LibraryCreateCollectionRequest(
                        context.ClientId ?? string.Empty,
                        context.IdempotencyKey ?? string.Empty,
                        name,
                        Id(args, "parentId")),
                    ct);

                return LibraryResult(result);
            }),

        new AssistantCapability(
            "library_rename_collection",
            AssistantTrustClass.PlanAndAct,
            "Renames an existing collection.",
            """
            {
              "type": "object",
              "properties": {
                "collectionId": { "type": "string", "format": "uuid", "description": "The id of the collection to rename. Required." },
                "name": { "type": "string", "description": "The collection's new name. Required." }
              },
              "required": ["collectionId", "name"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "collectionId") is not { } collectionId || string.IsNullOrWhiteSpace(Str(args, "name")))
                {
                    return Invalid("'collectionId' and 'name' are required.");
                }

                var result = await library.RenameCollectionAsync(
                    new LibraryRenameCollectionRequest(
                        context.ClientId ?? string.Empty,
                        context.IdempotencyKey ?? string.Empty,
                        collectionId,
                        Str(args, "name")!),
                    ct);

                return LibraryResult(result);
            }),

        new AssistantCapability(
            "library_move_collection",
            AssistantTrustClass.PlanAndAct,
            "Moves a collection under a new parent (null moves it to the top level).",
            """
            {
              "type": "object",
              "properties": {
                "collectionId": { "type": "string", "format": "uuid", "description": "The id of the collection to move. Required." },
                "newParentId": { "type": "string", "format": "uuid", "description": "The id of the new parent collection. Omit it to move the collection to the top level." }
              },
              "required": ["collectionId"],
              "additionalProperties": true
            }
            """,
            async (context, args, ct) =>
            {
                if (Id(args, "collectionId") is not { } collectionId)
                {
                    return Invalid("'collectionId' is required.");
                }

                var result = await library.MoveCollectionAsync(
                    new LibraryMoveCollectionRequest(
                        context.ClientId ?? string.Empty,
                        context.IdempotencyKey ?? string.Empty,
                        collectionId,
                        Id(args, "newParentId")),
                    ct);

                return LibraryResult(result);
            }),
    ];

    // ------------------------------------------------------------------
    // Argument readers. The tool args are JSON objects keyed by the canonical
    // camelCase request field names; a missing or mistyped field reads null and
    // the capability turns that into a typed invalid-arguments failure.
    // ------------------------------------------------------------------

    private static JsonElement Property(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        if (args.TryGetProperty(name, out var value))
        {
            return value;
        }

        // Accept PascalCase too: the orchestrator is not the only possible
        // caller, and a wrong-cased key should not silently read as absent.
        var pascal = char.ToUpperInvariant(name[0]) + name[1..];
        return args.TryGetProperty(pascal, out value) ? value : default;
    }

    private static string? Str(JsonElement args, string name)
    {
        var value = Property(args, name);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static Guid? Id(JsonElement args, string name)
    {
        var value = Property(args, name);
        return value.ValueKind == JsonValueKind.String
            && Guid.TryParse(value.GetString(), out var id)
                ? id
                : null;
    }

    private static int? Num(JsonElement args, string name)
    {
        var value = Property(args, name);
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : null;
    }

    private static bool? Bool(JsonElement args, string name) =>
        Property(args, name).ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };

    private static TEnum ValueEnum<TEnum>(JsonElement args, string name, TEnum fallback)
        where TEnum : struct, Enum
    {
        var value = Str(args, name);
        return !string.IsNullOrWhiteSpace(value)
            && Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed)
                ? parsed
                : fallback;
    }

    // ------------------------------------------------------------------
    // Result shaping.
    // ------------------------------------------------------------------

    private static AssistantToolResult Invalid(string message) =>
        AssistantToolResult.Fail(AssistantErrorCodes.InvalidArguments, message);

    /// <summary>
    /// Serializes a value using its own runtime type: several canonical results
    /// carry their payload as <c>object</c>, and the declared type would drop
    /// it.
    /// </summary>
    private static JsonElement Element(object value) =>
        JsonSerializer.SerializeToElement(value, value.GetType(), Json);

    private static AssistantToolResult NoteResult<T>(NoteCommandResult<T> result) =>
        result.Success
            ? AssistantToolResult.Ok(Element(result))
            : AssistantToolResult.Fail(
                result.ErrorCode ?? AssistantErrorCodes.NotFound,
                result.ErrorMessage ?? "Note command failed.");

    /// <summary>
    /// Library mutations return an envelope whose failures are data, exactly as
    /// the REST/MCP callers receive them; the assistant does not re-map those
    /// codes.
    /// </summary>
    private static AssistantToolResult LibraryResult(LibraryCommandResultDto result) =>
        AssistantToolResult.Ok(Element(new
        {
            result.Reply,
            result.Data,
            result.StateVersion,
            result.Duplicate,
        }));
}
