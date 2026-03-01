# Backend — Endpoints

## Overview

The backend uses ASP.NET Core **Minimal API** pattern. Endpoints are organized as static extension methods that register route groups. All endpoint groups are mapped in `Program.cs`:

```csharp
app.MapBooksEndpoints();
app.MapNotesEndpoints();
app.MapCollectionsEndpoints();
app.MapConceptsEndpoints();
app.MapWritingsEndpoints();
app.MapOpdsEndpoints();
```

## Endpoint Groups

### BooksEndpoints (`/api/books`)

| Method | Route | Description | Dependencies |
|---|---|---|---|
| `GET` | `/` | List books (paginated, filtered, sorted, searched) | `IBookRepository` |
| `GET` | `/{id}` | Get single book | `IBookRepository` |
| `POST` | `/` | Create book | `IBookRepository` |
| `PUT` | `/{id}` | Update book metadata | `IBookRepository` |
| `PUT` | `/{id}/progress` | Update reading progress | `IBookRepository` |
| `GET` | `/{id}/locations` | Get cached epub locations | `IBookRepository` |
| `POST` | `/{id}/locations` | Save epub locations | `IBookRepository` |
| `DELETE` | `/{id}` | Delete book + files | `IBookRepository`, `IFileStorageService` |
| `POST` | `/{id}/file` | Upload book file | `IBookRepository`, `IFileStorageService`, `MediaMetadataService` |
| `GET` | `/{id}/file` | Download/stream book file | `IFileStorageService` |
| `POST` | `/{id}/cover` | Upload cover image | `IBookRepository`, `IFileStorageService` |
| `GET` | `/{id}/cover` | Download cover image | `IFileStorageService` |
| `DELETE` | `/{id}/cover` | Delete cover | `IBookRepository`, `IFileStorageService` |
| `GET` | `/lookup/{isbn}` | Lookup metadata by ISBN | `BookLookupService` |

### NotesEndpoints (`/api`)

| Method | Route | Description | Dependencies |
|---|---|---|---|
| `GET` | `/books/{bookId}/notes` | List notes for a book | `INoteRepository` |
| `POST` | `/books/{bookId}/notes` | Create note (+ concept processing) | `IBookRepository`, `INoteRepository`, `NoteProcessorService` |
| `PUT` | `/notes/{id}` | Update note (+ concept re-processing) | `INoteRepository`, `NoteProcessorService` |
| `DELETE` | `/notes/{id}` | Delete note + concept links | `INoteRepository` |

### CollectionsEndpoints (`/api/collections`)

| Method | Route | Description | Dependencies |
|---|---|---|---|
| `GET` | `/` | List all collections | `ICollectionRepository` |
| `GET` | `/{id}` | Get single collection | `ICollectionRepository` |
| `POST` | `/` | Create collection | `ICollectionRepository` |
| `PUT` | `/{id}` | Update (with cycle detection) | `ICollectionRepository` |
| `DELETE` | `/{id}` | Delete (unlinks books first) | `ICollectionRepository` |

### ConceptsEndpoints (`/api/concepts`)

| Method | Route | Description | Dependencies |
|---|---|---|---|
| `GET` | `/` | List all concepts (with usage counts) | `IConceptRepository` |
| `GET` | `/{id}` | Get concept detail (with all linked notes) | `IConceptRepository` |

### WritingsEndpoints (`/api/writings`)

| Method | Route | Description | Dependencies |
|---|---|---|---|
| `GET` | `/` | List all writings (flat) | `IWritingRepository` |
| `GET` | `/{id}` | Get document content | `IWritingRepository` |
| `POST` | `/` | Create folder or document | `IWritingRepository` |
| `PUT` | `/{id}` | Update name/content | `IWritingRepository` |
| `PUT` | `/{id}/move` | Move to new parent (with cycle detection) | `IWritingRepository` |
| `DELETE` | `/{id}` | Delete (cascade children) | `IWritingRepository` |

### OpdsEndpoints (`/opds`)

| Method | Route | Description | Dependencies |
|---|---|---|---|
| `GET` | `/` | OPDS 1.2 Atom catalog feed | `IBookRepository` |

## Cycle Detection

Both `CollectionsEndpoints` and `WritingsEndpoints` implement cycle detection when moving items:

```
1. Check: target parent != self
2. Walk ancestors: starting from target parent, follow ParentId chain
3. If any ancestor == moving item's ID → reject with 400
```

This prevents a folder from being moved into its own descendant (which would create an infinite loop).

## Mapping

DTO ↔ Model conversion is handled by `MappingExtensions` (extension methods):

| Direction | Methods |
|---|---|
| Model → DTO | `ToDto()`, `ToContentDto()` |
| DTO → Model | `ToModel()`, `ToModel(bookId)` |
| Update | `Apply(dto)` — patches only non-null fields |

The `Apply` pattern supports partial updates: only fields present in the DTO are applied, preserving existing values for omitted fields.
