# Nostos — API Reference

All endpoints return JSON. Base path: `/api` (except OPDS at `/opds` and MCP
at `/mcp`).

> **Coverage note (2026-08-12):** this reference predates several shipped
> surfaces — Reading Training, Backup, MCP, and the issue #34 canonical
> library service. The Books / Notes / Collections / Concepts / Writings /
> OPDS sections below remain accurate (inline corrections noted where the
> library service changed behavior); the sections at the end cover Reading
> Training, Backup, MCP, and Library. The authoritative route tables live in
> [`Nostos.Backend/_docs/endpoints.md`](Nostos.Backend/_docs/endpoints.md).

---

## Books — `/api/books`

### `GET /api/books`

List books with filtering, sorting, search, and pagination.

| Query Param | Type   | Default  | Description                                    |
| ----------- | ------ | -------- | ---------------------------------------------- |
| `search`    | string | —        | Search by title or author (LIKE)               |
| `filter`    | string | —        | `Favorites`, `Finished`, `Reading`, `Unsorted` |
| `sort`      | string | `Recent` | `Recent`, `Title`, `Rating`, `LastRead`        |
| `page`      | int    | 1        | Page number                                    |
| `pageSize`  | int    | 20       | Items per page                                 |
| `collectionId` | guid | —      | Restrict the listing to one collection         |

**Response:** `PaginatedResponse<BookDto>` — `{ items, totalCount, page, pageSize }`

### `GET /api/books/{id}`

Get a single book by ID.

**Response:** `BookDto`

### `POST /api/books`

Create a new book.

**Body:** `CreateBookDto`

```json
{
  "type": "physical|ebook|audiobook",
  "title": "string (required)",
  "author": "string?",
  "subtitle": "string?",
  "isbn": "string?",
  "publisher": "string?",
  "collectionId": "guid?"
  // ... all metadata fields
}
```

**Response:** `201 Created` with `BookDto` when a book was created
(`outcome: created`), or `200 OK` with the existing `BookDto` when an exact
normalized-identity match was found (`outcome: matched`). Legacy permissive
mode: ambiguity creates rather than asking — the strict confirmation flow is
available through the MCP tool `library_create_or_match_book`.

### `PUT /api/books/{id}`

Update book metadata. All fields are optional — only provided fields are updated.

**Body:** `UpdateBookDto`

**Response:** `BookDto`

### `PUT /api/books/{id}/progress`

Update reading progress.

**Body:**

```json
{
  "location": "string (epub CFI or page number)",
  "percentage": 0-100
}
```

`percentage` is validated 0–100 (invalid values → 400). Auto-sets
`lastReadAt` to now and aligns `finishedAt` with the finished state.

### `GET /api/books/{id}/locations`

Get cached epub locations JSON (used for fast progress percentage calculation).

**Response:** `{ locations: "string" }` or `404`

### `POST /api/books/{id}/locations`

Save epub locations JSON.

**Body:** `{ "locations": "string" }`

### `DELETE /api/books/{id}`

Delete a book, its files, and cover. Files are removed only after the
database row is gone.

**Response:** `204 No Content`, or `409 book_in_use` when the book is
referenced by a Reading Training assignment or a note.

### `POST /api/books/{id}/file`

Upload a book file (epub, pdf, mobi, azw3, m4b, m4a, mp3, txt).

**Body:** `multipart/form-data` with file. Max size: 4 GB.

For audio files, metadata (chapters, duration) is extracted automatically via ATL.NET.

### `GET /api/books/{id}/file`

Download/stream the book file. Supports HTTP range requests for streaming.

### `POST /api/books/{id}/cover`

Upload a cover image (PNG or JPEG).

**Body:** `multipart/form-data` with image file.

### `GET /api/books/{id}/cover`

Download the cover image.

### `DELETE /api/books/{id}/cover`

Delete the cover image.

**Response:** `204 No Content`

### `GET /api/books/lookup/{isbn}`

Lookup book metadata by ISBN. Queries both **Google Books API** and **Open Library API** in parallel and merges results (Open Library preferred, Google fills gaps).

**Response:** `400` for an invalid ISBN; `CreateBookDto` (pre-filled) or
`404` when no metadata is found. The external lookup has a 15-second timeout.

---

## Notes — `/api`

Notes are always scoped to a book.

### `GET /api/books/{bookId}/notes`

List all notes for a book.

**Response:** `NoteDto[]`

```json
{
  "id": "guid",
  "bookId": "guid",
  "content": "string",
  "cfiRange": "string? (epub location)",
  "selectedText": "string? (highlighted text)",
  "createdAt": "datetime",
  "bookTitle": "string?"
}
```

### `POST /api/books/{bookId}/notes`

Create a note. Concepts wrapped in `[[double brackets]]` are auto-extracted and linked.

**Body:**

```json
{
  "content": "This is about [[Philosophy]] and [[Ethics]]",
  "cfiRange": "string? (epub CFI range)",
  "selectedText": "string? (highlighted text)"
}
```

**Response:** `201 Created` with `NoteDto`

### `PUT /api/notes/{id}`

Update a note. Re-processes `[[concept]]` links.

**Body:**

```json
{
  "content": "Updated content with [[NewConcept]]",
  "selectedText": "string?"
}
```

### `DELETE /api/notes/{id}`

Delete a note and its concept links.

**Response:** `204 No Content`

---

## Collections — `/api/collections`

Hierarchical folders for organizing books.

### `GET /api/collections`

List all collections (flat list with `parentId` for hierarchy).

**Response:** `CollectionDto[]` — `{ id, name, parentId? }`

### `GET /api/collections/{id}`

Get a single collection.

### `POST /api/collections`

Create a collection. Always returns `201 Created`; a sibling with the same
normalized name under the same parent returns the existing collection instead
of creating a duplicate.

**Body:** `{ "name": "string", "parentId": "guid?" }`

### `PUT /api/collections/{id}`

Update name and/or parent through the canonical library service. Includes
**cycle detection** — `409 collection_cycle` if the move would create a
circular reference; a sibling name collision at the destination returns
`409 collection_name_conflict`.

**Body:** `{ "name": "string", "parentId": "guid?" }`

### `DELETE /api/collections/{id}`

Delete a collection. Books in the collection are **unlinked** (set to
`collectionId: null`), never deleted.

**Response:** `204 No Content`, or `409 collection_has_children` while the
collection still has child collections.

---

## Concepts — `/api/concepts`

Read-only. Concepts are created automatically when notes with `[[brackets]]` are saved.

### `GET /api/concepts`

List all concepts with usage count, sorted by most-used first.

**Response:** `ConceptDto[]` — `{ id, name, usageCount }`

### `GET /api/concepts/{id}`

Get concept detail with all related notes across books.

**Response:**

```json
{
  "id": "guid",
  "name": "string",
  "notes": [
    {
      "noteId": "guid",
      "content": "string",
      "selectedText": "string?",
      "cfiRange": "string?",
      "bookId": "guid",
      "bookTitle": "string"
    }
  ]
}
```

---

## Writings — `/api/writings`

Hierarchical file system for the writing studio.

### `GET /api/writings`

List all writings (flat list with `parentId` for tree structure).

**Response:** `WritingDto[]` — `{ id, name, type: "Folder"|"Document", parentId?, updatedAt }`

### `GET /api/writings/{id}`

Get document content.

**Response:** `{ id, name, content, updatedAt }`

### `POST /api/writings`

Create a folder or document.

**Body:** `{ "name": "string", "type": "Folder|Document", "parentId": "guid?" }`

### `PUT /api/writings/{id}`

Update name and/or content (used by auto-save).

**Body:** `{ "name": "string", "content": "string?" }`

### `PUT /api/writings/{id}/move`

Move a writing to a new parent folder. Includes **cycle detection**.

**Body:** `{ "newParentId": "guid?" }` (`null` = move to root)

### `DELETE /api/writings/{id}`

Delete a writing. Cascading delete removes all children.

**Response:** `204 No Content`

---

## OPDS Catalog — `/opds`

### `GET /opds`

OPDS 1.2 Atom feed of all books with files. Compatible with OPDS reader apps (Moon Reader, KOReader, etc.).

**Response:** `application/atom+xml`

Each entry includes:

- Title, author, description, language
- Cover image link (`http://opds-spec.org/image`)
- Acquisition link (`http://opds-spec.org/acquisition`)

---

## Reading Training — `/api/reading`

`/api/reading` is the canonical surface; the complete canonical group is also
mapped under `/api/reading-training` for backward compatibility (previously
shipped body-only command shapes remain available there while clients
migrate). All responses use the stable `ReadingCommandResultDto` envelope.
Mutations are exact-once on `(clientId, idempotencyKey)` and delegate to
`IReadingTrainingService` — the endpoint layer holds no training rules.

| Method   | Route                                             | Description |
| -------- | ------------------------------------------------- | ----------- |
| `POST`   | `/initialize`                                     | Initialize the programme idempotently |
| `GET`    | `/dashboard`                                      | Programme, books, open session and current review |
| `GET`    | `/status`                                         | Current open-session status |
| `GET`    | `/week?week=YYYY-Www`                             | ISO-week summary/review |
| `GET`    | `/sessions?from=&to=&bookId=&mode=`               | Filtered session history |
| `POST`   | `/sessions/plan`                                  | Plan a session |
| `POST`   | `/sessions/start`                                 | Start a planned session |
| `POST`   | `/sessions/start-new`                             | Create and start a session |
| `POST`   | `/sessions/{id}/pause`                            | Pause the named open session |
| `POST`   | `/sessions/{id}/resume`                           | Resume the named open session |
| `POST`   | `/sessions/{id}/complete`                         | Stop timing and record actual minutes |
| `POST`   | `/sessions/{id}/rate`                             | Submit effort, focus and optional rating |
| `POST`   | `/sessions/{id}/skip-ratings`                     | Close without ratings |
| `DELETE` | `/sessions/{id}/open`                             | Cancel the named open session |
| `GET`    | `/books`                                          | List training assignments |
| `POST`   | `/books`                                          | Add a library book assignment |
| `PATCH`  | `/books/{assignmentId}`                           | Make the assignment default for its mode |
| `POST`   | `/books/{assignmentId}/finish`                    | Finish a training assignment |
| `POST`   | `/books/reorder`                                  | Reorder active assignments (UI extension) |
| `GET`    | `/inbox`                                          | Unresolved captures |
| `POST`   | `/captures`                                       | Capture text verbatim |
| `PATCH`  | `/captures/{id}`                                  | Dismiss or keep a capture |
| `POST`   | `/captures/{id}/promote-to-note`                  | Append a capture to an existing note |
| `POST`   | `/reviews/preview`                                | Preview an ISO-week decision |
| `POST`   | `/reviews/commit`                                 | Persist an immutable ISO-week review |
| `POST`   | `/gateway/dispatch`                               | Dispatch optional connector text |
| `GET`    | `/notifications/lease?maxCount&leaseSeconds`      | Claim due target-reached notifications under a lease |
| `POST`   | `/notifications/{id}/ack`                         | Acknowledge a delivered notification idempotently |

`POST /gateway/dispatch` accepts raw free text from optional gateway
connectors (Telegram Reading topic, Discord channel scope) with a
caller-supplied `(clientId, idempotencyKey)`; it performs at most one
underlying mutation per dispatch and duplicate dispatches converge through
the receipts. The accepted grammar (status, start/start new, pause, resume,
done/stop, skip, cancel, rate pairs, and verbatim captures while a session is
active) is documented in `Nostos.Backend/_docs/endpoints.md`.

`GET /notifications/lease` validates `maxCount` (1..100) and `leaseSeconds`
(1..3600); invalid values return 400 ProblemDetails. `POST
/notifications/{id}/ack` returns 200 `{ notificationId, acknowledged: true }`
for any existing notification (including duplicate acks) and 404 for an
unknown id.

---

## Backup — `/api/backup`

| Method     | Route            | Description |
| ---------- | ---------------- | ----------- |
| `GET`      | `/status`        | Last backup time and scheduled status |
| `GET`      | `/settings`      | Current retention and interval settings |
| `PUT`      | `/settings`      | Update backup configuration |
| `POST`     | `/trigger`       | Manually start a backup immediately |
| `POST`     | `/restore/{id}`  | Restore library from a specific archive |
| `GET`      | `/history`       | List all backup records |
| `DELETE`   | `/history/{id}`  | Delete a backup record and its archive file |
| `GET`      | `/download/{id}` | Stream `.nostos` archive to browser |
| `POST`     | `/import`        | Scan `/backups` folder for untracked files |
| `GET`      | `/progress`      | Real-time step-by-step progress tracking |

During a restore the application enters maintenance mode: `/api` (and the MCP
route, when enabled) return `503`
`{ "error": "Application is in maintenance mode during restore." }`.

---

## MCP — Model Context Protocol

Opt-in (`Mcp:Enabled`, default disabled) bearer-authenticated **Streamable
HTTP** endpoint at `/mcp` (configurable via `Mcp:Path`). The bearer token is
resolved exclusively from the `Mcp:ApiKeyEnvironmentVariable` environment
variable (default `NOSTOS_MCP_TOKEN`) at startup; enabling MCP without the
token fails startup closed. Tools are discovered from the assembly and
registered as `mcp__nostos__*` (double underscore).

The shipped surface is **34 tools: 23 Reading Training + 11 Library**. Library
tools: `library_list_books`, `library_get_book`, `library_resolve_book`,
`library_create_or_match_book`, `library_update_book`,
`library_list_collections`, `library_get_collection`,
`library_create_collection`, `library_rename_collection`,
`library_move_collection`, `library_delete_collection`. Responses use the
`{ reply, data, stateVersion, duplicate }` envelope; `duplicate=true` only on
receipt replay. Every library mutation requires a caller-supplied
`idempotencyKey` and is exact-once on `(clientId, idempotencyKey)` with the
fixed client `nostos-mcp`. Full contracts:
[`docs/library-mcp-contracts.md`](library-mcp-contracts.md) and
`Nostos.Backend/_docs/endpoints.md`.

---

## Library — `/api/books`, `/api/collections` (issue #34)

All book and collection routes forward to the canonical `ILibraryService`;
the endpoint layer holds no domain rules. Errors map through
`LibraryHttpMapper` to Problem Details (error code in `title`, reply in
`detail`): `invalid_*` → 400, `*_not_found` → 404, the conflict family
(`identity_conflict`, `duplicate_identifier`, `confirmation_required`,
`collection_name_conflict`, `collection_cycle`, `collection_has_children`,
`book_in_use`) → 409, everything else → 422.

### Books

| Method   | Route             | Status codes |
| -------- | ----------------- | ------------ |
| `GET`    | `/`               | 200 `PaginatedResponse<BookDto>` (filter/sort/search/page/pageSize/collectionId) |
| `GET`    | `/{id}`           | 200 `BookDto` / 404 |
| `POST`   | `/`               | 201 created / 200 matched (`CreateBookDto`, legacy permissive) |
| `PUT`    | `/{id}`           | 200 `BookDto` / 400 / 404 / 409 |
| `PUT`    | `/{id}/progress`  | 200; percentage validated 0–100 (400), `FinishedAt` aligned |
| `DELETE` | `/{id}`           | 204 / 404 / 409 `book_in_use` (queued or noted) |
| `GET`    | `/lookup/{isbn}`  | 200 `CreateBookDto` prefill / 400 invalid ISBN / 404 |

Create-or-match precedence: exact normalized ISBN/ASIN → single exact
title+author → create. Type rules require audiobooks to carry an ASIN and
physical/ebook books an ISBN (`invalid_book_identity` otherwise). Identifier
changes that collide with another book return `duplicate_identifier`.

### Collections

| Method   | Route   | Status codes |
| -------- | ------- | ------------ |
| `GET`    | `/`     | 200 flat `CollectionDto[]` |
| `GET`    | `/{id}` | 200 `CollectionDto` / 404 |
| `POST`   | `/`     | 201 (duplicate sibling returns the existing collection) |
| `PUT`    | `/{id}` | 200; 409 `collection_cycle` / `collection_name_conflict` |
| `DELETE` | `/{id}` | 204; 409 `collection_has_children`; books are unlinked, never deleted |

---

## Error Handling

All errors follow the Problem Details standard:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.6.1",
  "title": "An unexpected error occurred.",
  "status": 500
}
```

Validation errors return `400 Bad Request` with `{ "error": "message" }`.

Reading Training and Library errors use the same Problem Details shape with
the domain error code in `title` and the human-readable reply in `detail`;
the Library section above lists the status mapping.
