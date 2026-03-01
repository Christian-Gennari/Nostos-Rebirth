# Nostos — API Reference

All endpoints return JSON. Base path: `/api` (except OPDS at `/opds`).

---

## Books — `/api/books`

### `GET /api/books`

List books with filtering, sorting, search, and pagination.

| Query Param | Type | Default | Description |
|---|---|---|---|
| `search` | string | — | Search by title or author (LIKE) |
| `filter` | string | — | `Favorites`, `Finished`, `Reading`, `Unsorted` |
| `sort` | string | `Recent` | `Recent`, `Title`, `Rating`, `LastRead` |
| `page` | int | 1 | Page number |
| `pageSize` | int | 20 | Items per page |

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

**Response:** `201 Created` with `BookDto`

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

Auto-sets `lastReadAt` to now. Auto-sets `finishedAt` if percentage reaches 100.

### `GET /api/books/{id}/locations`

Get cached epub locations JSON (used for fast progress percentage calculation).

**Response:** `{ locations: "string" }` or `404`

### `POST /api/books/{id}/locations`

Save epub locations JSON.

**Body:** `{ "locations": "string" }`

### `DELETE /api/books/{id}`

Delete a book, its files, and cover.

**Response:** `204 No Content`

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

**Response:** `CreateBookDto` (pre-filled) or `404`

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

Create a collection.

**Body:** `{ "name": "string", "parentId": "guid?" }`

### `PUT /api/collections/{id}`

Update name and/or parent. Includes **cycle detection** — returns `400` if move would create circular reference.

**Body:** `{ "name": "string", "parentId": "guid?" }`

### `DELETE /api/collections/{id}`

Delete a collection. Books in the collection are **unlinked** (set to `collectionId: null`), not deleted.

**Response:** `204 No Content`

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
