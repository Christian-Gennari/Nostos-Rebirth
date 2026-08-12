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
app.MapBackupEndpoints();
app.MapReadingTrainingEndpoints();
```

## Endpoint Groups

### BooksEndpoints (`/api/books`)

All book routes forward to the canonical `ILibraryService` (issue #34): the
endpoint layer performs no repository writes and no title-matching logic.
Metadata routes use the service; the `locations`, `file`, and `cover` routes
keep their repository-backed implementations.

| Method   | Route             | Description                                        | Dependencies                                                     |
| -------- | ----------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `GET`    | `/`               | List books (paginated, filtered, sorted, searched) | `ILibraryService`                                                |
| `GET`    | `/{id}`           | Get single book                                    | `ILibraryService`                                                |
| `POST`   | `/`               | Create-or-match book (legacy permissive)           | `ILibraryService`                                                |
| `PUT`    | `/{id}`           | Update book metadata                               | `ILibraryService`                                                |
| `PUT`    | `/{id}/progress`  | Update reading progress (validated 0–100)          | `ILibraryService`                                                |
| `GET`    | `/{id}/locations` | Get cached epub locations                          | `IBookRepository`                                                |
| `POST`   | `/{id}/locations` | Save epub locations                                | `IBookRepository`                                                |
| `DELETE` | `/{id}`           | Delete book + files (row first, then storage)      | `ILibraryService`, `IFileStorageService`                         |
| `POST`   | `/{id}/file`      | Upload book file                                   | `IBookRepository`, `IFileStorageService`, `MediaMetadataService` |
| `GET`    | `/{id}/file`      | Download/stream book file                          | `IFileStorageService`                                            |
| `POST`   | `/{id}/cover`     | Upload cover image                                 | `IBookRepository`, `IFileStorageService`                         |
| `GET`    | `/{id}/cover`     | Download cover image                               | `IFileStorageService`                                            |
| `DELETE` | `/{id}/cover`     | Delete cover                                       | `IBookRepository`, `IFileStorageService`                         |
| `GET`    | `/lookup/{isbn}`  | Lookup metadata by ISBN (15s timeout)              | `BookLookupService`                                              |

`POST /` is the legacy-permissive create-or-match: an exact normalized
identity match returns the existing book (`200 OK`, `outcome: matched`),
otherwise a book is created (`201 Created` with `Location: /api/books/{id}`,
`outcome: created`). Ambiguity creates rather than asks — the strict
confirmation flow exists only on the MCP surface
(`library_create_or_match_book`). `PUT /{id}/progress` validates the
percentage 0–100 and aligns `FinishedAt` with the finished state. `DELETE
/{id}` returns `409 book_in_use` when the book is referenced by a training
assignment or a note, and storage files are removed only after the database
row is gone.

Errors are mapped by `LibraryHttpMapper` to Problem Details: `invalid_*` →
400, `*_not_found` → 404, the conflict family (`identity_conflict`,
`duplicate_identifier`, `confirmation_required`, `collection_name_conflict`,
`collection_cycle`, `collection_has_children`, `book_in_use`) → 409,
everything else → 422. `GET /lookup/{isbn}` rejects an invalid ISBN with 400
and returns 404 when no metadata is found.

### NotesEndpoints (`/api`)

| Method   | Route                   | Description                           | Dependencies                                                 |
| -------- | ----------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `GET`    | `/books/{bookId}/notes` | List notes for a book                 | `INoteRepository`                                            |
| `POST`   | `/books/{bookId}/notes` | Create note (+ concept processing)    | `IBookRepository`, `INoteRepository`, `NoteProcessorService` |
| `PUT`    | `/notes/{id}`           | Update note (+ concept re-processing) | `INoteRepository`, `NoteProcessorService`                    |
| `DELETE` | `/notes/{id}`           | Delete note + concept links           | `INoteRepository`                                            |

### CollectionsEndpoints (`/api/collections`)

Routed through the canonical `ILibraryService` (issue #34).

| Method   | Route   | Description                   | Dependencies            |
| -------- | ------- | ----------------------------- | ----------------------- |
| `GET`    | `/`     | List all collections (flat)   | `ILibraryService`       |
| `GET`    | `/{id}` | Get single collection         | `ILibraryService`       |
| `POST`   | `/`     | Create collection             | `ILibraryService`       |
| `PUT`    | `/{id}` | Rename and/or move            | `ILibraryService`       |
| `DELETE` | `/{id}` | Delete (unlinks books)        | `ILibraryService`       |

`POST /` always returns `201 Created`; a sibling with the same normalized name
under the same parent returns the existing collection instead of a duplicate.
`PUT /{id}` performs the move and rename through the canonical service: a
move into its own descendant returns `409 collection_cycle` and a sibling
name collision at the destination returns `409 collection_name_conflict`.
`DELETE /{id}` unlinks the books in the collection (never deletes them) and
returns `409 collection_has_children` while the collection still has child
collections.

### ConceptsEndpoints (`/api/concepts`)

| Method | Route   | Description                                | Dependencies         |
| ------ | ------- | ------------------------------------------ | -------------------- |
| `GET`  | `/`     | List all concepts (with usage counts)      | `IConceptRepository` |
| `GET`  | `/{id}` | Get concept detail (with all linked notes) | `IConceptRepository` |

### WritingsEndpoints (`/api/writings`)

| Method   | Route        | Description                               | Dependencies         |
| -------- | ------------ | ----------------------------------------- | -------------------- |
| `GET`    | `/`          | List all writings (flat)                  | `IWritingRepository` |
| `GET`    | `/{id}`      | Get document content                      | `IWritingRepository` |
| `POST`   | `/`          | Create folder or document                 | `IWritingRepository` |
| `PUT`    | `/{id}`      | Update name/content                       | `IWritingRepository` |
| `PUT`    | `/{id}/move` | Move to new parent (with cycle detection) | `IWritingRepository` |
| `DELETE` | `/{id}`      | Delete (cascade children)                 | `IWritingRepository` |

### OpdsEndpoints (`/opds`)

| Method | Route | Description                | Dependencies      |
| ------ | ----- | -------------------------- | ----------------- |
| `GET`  | `/`   | OPDS 1.2 Atom catalog feed | `IBookRepository` |

### BackupEndpoints (`/api/backup`)

| Method     | Route            | Description                                | Dependencies                   |
| ---------- | ---------------- | ------------------------------------------ | ------------------------------ |
| `GET`      | `/status`        | Get last backup time and scheduled status   | `IBackupService`               |
| `GET`      | `/settings`      | Get current retention and interval settings | `IBackupService`               |
| `PUT`      | `/settings`      | Update backup configuration                | `IBackupService`               |
| `POST`     | `/trigger`       | Manually start a backup immediately        | `IBackupService`               |
| `POST`     | `/restore/{id}`  | Restore library from a specific archive     | `IBackupService`               |
| `GET`      | `/history`       | List all backup records                    | `IBackupService`               |
| `DELETE`   | `/history/{id}`  | Delete a backup record and its archive file | `IBackupService`               |
| `GET`      | `/download/{id}` | Stream `.nostos` archive to browser        | `IBackupService`               |
| `POST`     | `/import`        | Scan `/backups` folder for untracked files | `IBackupService`               |
| `GET`      | `/progress`      | Real-time step-by-step progress tracking   | `BackupSettingsProvider`       |

### ReadingTrainingEndpoints (`/api/reading`)

`/api/reading` is the canonical surface. The complete canonical group is also
mapped under `/api/reading-training` for backward compatibility; previously
shipped body-only command shapes remain available there while clients migrate.
All variants call the same service and share command receipts/state versions.

All responses use the stable `ReadingCommandResultDto` envelope. Mutations are
exact-once by `(clientId, idempotencyKey)` and delegate to
`IReadingTrainingService`; the endpoint layer contains no training rules.

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

`GET /notifications/lease` validates `maxCount` (1..100) and `leaseSeconds`
(1..3600); invalid values return 400 ProblemDetails. The response is the typed
claimed list (`notificationId`, `payload`, `leaseUntil`) in claim order.
`POST /notifications/{notificationId}/ack` returns 200
`{ notificationId, acknowledged: true }` for any existing notification —
including duplicate acks — and 404 ProblemDetails for an unknown id. The
scanner worker (`ReadingNotificationWorker`) enqueues target-reached rows on a
calm poll interval (`ReadingTraining.NotificationPollSeconds`, default 15s,
clamped 1..300) and never claims or acknowledges. The weekly-review catch-up
worker (`ReadingWeeklyReviewWorker`) owns the commit schedule: a completed ISO
week becomes eligible at 07:00 local time (programme timezone) on the Monday
that starts the following week, and the worker commits every eligible
uncommitted week through the same exact-once service command (deterministic
client `reading-weekly-review-worker`, idempotency key `weekly-review:{yyyy}-W{ww}`),
so restarts and duplicate workers converge. It polls every
`ReadingTraining.WeeklyReviewPollSeconds` (default 300s, clamped 1..3600) and
drains a downtime backlog across scans, capped at
`ReadingTraining.WeeklyReviewMaxCatchUpWeeks` (default 4) per scan.

### Reading gateway dispatch (`POST /api/reading/gateway/dispatch`)

The exact route used by optional gateway connectors (Telegram/agent
messaging). It accepts raw free text and returns the same stable
`ReadingCommandResultDto` envelope and status mapping as every other reading
command. The connector forwards the raw message verbatim with a caller-supplied
`(clientId, idempotencyKey)`; Nostos performs at most one underlying service
mutation per dispatch, and duplicate dispatches converge through the existing
exact-once receipts.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `clientId` | string | Caller identity (receipts are keyed by client + key) |
| `idempotencyKey` | string | Caller-supplied; reuse to replay the same message |
| `text` | string | Raw message text, forwarded byte-for-byte |

Accepted grammar (case-insensitive, outer whitespace ignored; the captured
text is never altered):

- **status** — `status`, `what am i reading`, `what am i currently reading`,
  or text containing `how long`, `elapsed`, `time left`, `minutes left`,
  `time remaining`, `how much time`, or `time so far`
- **start** — `start`, `start now`; **start new** — `start a new reading
  session`, `start new`, `start new session`, `new session`
- **pause** — `pause`, `pause reading`; `answer now` / `answer now please`
  also pause authoritatively (the saved question stays in the inbox for the
  connector to inject into model discussion)
- **resume** — `resume`, `resume reading`
- **done** — `done`, `stop`, `stop reading`, `end`, `end reading`,
  `end session`, `end reading session`, or compact `done <minutes>` forms
  (`done 42m`, `done 42`, `done 42 effort 4 focus 8` — compact effort/focus
  are parsed for recognition only; ratings stay in the two-turn flow)
- **skip** — `skip ratings`, `skip rating`, `skip`
- **cancel** — `cancel`, `cancel session`, `abandon`, `discard`, `discard it`,
  `abandon session`
- **rate pair** — `4, 8`, `4; 8`, `rate 4 8` (effort, focus 1–10)

Anything else is a raw capture while a session is Active (or while Paused only
with an explicit `thought:` / `question:` / `bookmark:` prefix), classified
question/thought/bookmark like the legacy coach and stored verbatim,
byte-for-byte. Slash commands, model-driven queries (`review`, `weekly
review`, `inbox`, queue adds, `finish <book>`, and the legacy `read`
prescription), and ordinary text with no active session return the stable
`gateway_ignored` no-op (422) and create no state.

## MCP (Model Context Protocol)

The MCP surface is opt-in (`Mcp:Enabled`, default disabled) and served as a
bearer-authenticated **Streamable HTTP** endpoint at `/mcp` (`Mcp:Path`). The
token is resolved exclusively from the `Mcp:ApiKeyEnvironmentVariable`
environment variable (default `NOSTOS_MCP_TOKEN`) at startup; enabling MCP
without the token fails startup closed. Tools are discovered from the
assembly (`WithToolsFromAssembly`) and registered under the `mcp__nostos__`
prefix. Maintenance mode guards the MCP route as well as `/api`.

The full surface is 34 tools: 23 Reading Training tools (contract in
[`docs/reading-training/contracts.md`](../../docs/reading-training/contracts.md))
plus the 11 Library tools below (manifest asserted in tests). All library
tools forward to the canonical `ILibraryService` and return its envelope
unchanged.

### Library tools (issue #34)

Every mutation requires a caller-supplied `idempotencyKey` (no default) and
is exact-once on `(ClientId, IdempotencyKey)` with the fixed MCP client id
`nostos-mcp`; retries replay the stored receipt instead of re-executing.
Responses use the envelope `{ reply, data, stateVersion, duplicate }`, where
`duplicate=true` only on receipt replay and `stateVersion` is the library
state version string. Read-only tools never mutate.

| Tool | Mutates | Behavior |
| ---- | ------- | -------- |
| `library_list_books` | no | Books with filter/sort/search/page/pageSize/collectionId |
| `library_get_book` | no | One book by id |
| `library_resolve_book` | no | Identity resolution: `exact_match` \| `candidates` \| `not_found` \| `identity_conflict`; external-metadata prefill when `includeExternalMetadata`; `lookupError: lookup_timeout` on lookup failure |
| `library_create_or_match_book` | yes | Strict create-or-match (see below) |
| `library_update_book` | yes | Patch metadata; empty string clears text fields; an identifier already held elsewhere → `duplicate_identifier` |
| `library_list_collections` | no | Flat collection list (order is presentation-only) |
| `library_get_collection` | no | One collection by id |
| `library_create_collection` | yes | Duplicate sibling returns the existing collection |
| `library_rename_collection` | yes | Sibling name collision → `collection_name_conflict` |
| `library_move_collection` | yes | `newParentId` null = root; cycle → `collection_cycle`; name collision at destination → `collection_name_conflict` |
| `library_delete_collection` | yes | `confirm=true` required; unlinks books; `collection_has_children` while children exist |

`library_create_or_match_book` resolves in order: `confirmedBookId`, exact
ISBN/ASIN, exactly one exact title+author match (returns `outcome: matched`
without creating). Multiple title+author matches or an ambiguous bare title
return `confirmation_required` with candidates — the caller must ask the
user, then call again with a **new** idempotency key and either
`confirmedBookId` or `forceCreate=true`; the original key is never reused.
Type rules: audiobooks use ASIN only, physical/ebook books use ISBN only; a
mismatch returns `invalid_book_identity`. Matching uses checksum-validated
normalized ISBN/ASIN (filtered unique indexes) and normalized title+author —
both title and author are required for an exact match (title-only yields
candidates).

## Maintenance Mode Middleware

The application includes middleware that intercepts requests to `/api` (and the MCP route, when enabled) when `BackupSettingsProvider.IsInMaintenanceMode` is true.

- **Status Code:** 503 Service Unavailable
- **Response:** `{"error": "Application is in maintenance mode during restore."}`
- **Purpose:** Prevents concurrent database access and file modifications during sensitive restore operations.

## Cycle Detection

`WritingsEndpoints` implements cycle detection when moving items, and the
canonical library service does the same for collection moves:

```
1. Check: target parent != self
2. Walk ancestors: starting from target parent, follow ParentId chain
3. If any ancestor == moving item's ID → reject
```

`WritingsEndpoints` rejects with 400; collection moves return
`409 collection_cycle` (Problem Details via `LibraryHttpMapper`). This
prevents a folder or collection from being moved into its own descendant
(which would create an infinite loop).

## Mapping

DTO ↔ Model conversion is handled by `MappingExtensions` (extension methods):

| Direction   | Methods                                     |
| ----------- | ------------------------------------------- |
| Model → DTO | `ToDto()`, `ToContentDto()`                 |
| DTO → Model | `ToModel()`, `ToModel(bookId)`              |
| Update      | `Apply(dto)` — patches only non-null fields |

The `Apply` pattern supports partial updates: only fields present in the DTO are applied, preserving existing values for omitted fields.
