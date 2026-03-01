# Backend — Repositories

## Overview

All data access is abstracted behind repository interfaces, injected as **scoped** services. Repositories encapsulate EF Core queries and mutations.

## Registration

All repositories are registered in `Program.cs`:

```csharp
builder.Services.AddScoped<IBookRepository, BookRepository>();
builder.Services.AddScoped<ICollectionRepository, CollectionRepository>();
builder.Services.AddScoped<INoteRepository, NoteRepository>();
builder.Services.AddScoped<IConceptRepository, ConceptRepository>();
builder.Services.AddScoped<IWritingRepository, WritingRepository>();
```

---

## IBookRepository / BookRepository

Manages `BookModel` entities (all subtypes via TPH).

| Method | Description |
|---|---|
| `GetBooksAsync(search, filter, sort, page, pageSize)` | Paginated query with full filtering/sorting. Returns `PaginatedResponse<BookModel>` |
| `GetByIdAsync(id)` | Find by primary key |
| `GetBooksWithFilesAsync()` | All books that have uploaded files (for OPDS feed) |
| `AddAsync(book)` | Insert + save |
| `UpdateAsync(book)` | Update + save |
| `DeleteAsync(book)` | Remove + save |

### Query Filters (`BookFilter` enum)

| Filter | Condition |
|---|---|
| `Favorites` | `Progress.IsFavorite == true` |
| `Finished` | `Progress.FinishedAt != null` |
| `Reading` | `FinishedAt == null && ProgressPercent > 0` |
| `Unsorted` | `CollectionId == null` |

### Sort Options (`BookSort` enum)

| Sort | Order |
|---|---|
| `Recent` | `CreatedAt DESC` (default) |
| `Title` | `Title ASC` |
| `Rating` | `Progress.Rating DESC` |
| `LastRead` | `LastReadAt DESC` (nulls last) |

---

## ICollectionRepository / CollectionRepository

Manages hierarchical `CollectionModel` entities.

| Method | Description |
|---|---|
| `GetAllAsync()` | Flat list of all collections |
| `GetByIdAsync(id)` | Find by primary key |
| `AddAsync(collection)` | Insert + save |
| `UpdateAsync(collection)` | Update + save |
| `DeleteAsync(collection)` | Remove + save |
| `GetParentIdAsync(id)` | Returns parent ID (for cycle detection during move) |
| `UnlinkBooksAsync(collectionId)` | Sets `CollectionId = null` on all books in the collection (called before delete) |

---

## INoteRepository / NoteRepository

Manages `NoteModel` entities with eager loading support.

| Method | Description |
|---|---|
| `GetByBookIdAsync(bookId)` | All notes for a book (includes `Book` nav property) |
| `GetByIdAsync(id)` | Simple find by PK |
| `GetByIdWithConceptsAsync(id)` | Includes `NoteConcepts` + `Book` (for update with concept re-processing) |
| `GetByIdWithBookAsync(id)` | No-tracking query with `Book` (for read-only DTO mapping) |
| `AddAsync(note)` | Add to context (no immediate save — allows batch with concept processing) |
| `SaveChangesAsync()` | Explicit save (called after `NoteProcessorService` finishes) |
| `DeleteAsync(note)` | Remove + save |
| `DeleteConceptLinksAsync(noteId)` | Bulk delete from `NoteConcepts` join table |

**Note:** `AddAsync` does NOT call `SaveChangesAsync()` — this is intentional. The note and its concept links are saved together in one transaction after `NoteProcessorService.ProcessNoteAsync()` completes.

---

## IConceptRepository / ConceptRepository

Manages `ConceptModel` entities and the `NoteConcepts` join table.

| Method | Description |
|---|---|
| `GetAllWithUsageCountAsync()` | Returns `List<ConceptDto>` directly (projection query) — sorted by usage count DESC |
| `GetByIdWithNotesAsync(id)` | Deep include: `NoteConcepts → Note → Book` |
| `GetByNamesAsync(names)` | Find concepts by name list (for matching `[[brackets]]`) |
| `AddRange(concepts)` | Batch add new concepts to context |
| `ClearNoteLinksAsync(noteId)` | Remove all `NoteConcepts` rows for a note |
| `AddNoteLink(link)` | Add single `NoteConceptModel` to context |
| `DeleteOrphanedAsync(ct)` | `ExecuteDeleteAsync` — concepts with zero note links. Returns count deleted |

---

## IWritingRepository / WritingRepository

Manages hierarchical `WritingModel` entities (folders & documents).

| Method | Description |
|---|---|
| `GetAllAsync()` | Flat list of all writings |
| `GetByIdAsync(id)` | Find by primary key |
| `AddAsync(writing)` | Insert + save |
| `UpdateAsync(writing)` | Update + save |
| `DeleteAsync(writing)` | Remove + save (cascade deletes children) |
| `GetParentIdAsync(id)` | Returns parent ID (for cycle detection during move) |
