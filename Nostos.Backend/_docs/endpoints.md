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

| Method   | Route             | Description                                        | Dependencies                                                     |
| -------- | ----------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `GET`    | `/`               | List books (paginated, filtered, sorted, searched) | `IBookRepository`                                                |
| `GET`    | `/{id}`           | Get single book                                    | `IBookRepository`                                                |
| `POST`   | `/`               | Create book                                        | `IBookRepository`                                                |
| `PUT`    | `/{id}`           | Update book metadata                               | `IBookRepository`                                                |
| `PUT`    | `/{id}/progress`  | Update reading progress                            | `IBookRepository`                                                |
| `GET`    | `/{id}/locations` | Get cached epub locations                          | `IBookRepository`                                                |
| `POST`   | `/{id}/locations` | Save epub locations                                | `IBookRepository`                                                |
| `DELETE` | `/{id}`           | Delete book + files                                | `IBookRepository`, `IFileStorageService`                         |
| `POST`   | `/{id}/file`      | Upload book file                                   | `IBookRepository`, `IFileStorageService`, `MediaMetadataService` |
| `GET`    | `/{id}/file`      | Download/stream book file                          | `IFileStorageService`                                            |
| `POST`   | `/{id}/cover`     | Upload cover image                                 | `IBookRepository`, `IFileStorageService`                         |
| `GET`    | `/{id}/cover`     | Download cover image                               | `IFileStorageService`                                            |
| `DELETE` | `/{id}/cover`     | Delete cover                                       | `IBookRepository`, `IFileStorageService`                         |
| `GET`    | `/lookup/{isbn}`  | Lookup metadata by ISBN                            | `BookLookupService`                                              |

### NotesEndpoints (`/api`)

| Method   | Route                   | Description                           | Dependencies                                                 |
| -------- | ----------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `GET`    | `/books/{bookId}/notes` | List notes for a book                 | `INoteRepository`                                            |
| `POST`   | `/books/{bookId}/notes` | Create note (+ concept processing)    | `IBookRepository`, `INoteRepository`, `NoteProcessorService` |
| `PUT`    | `/notes/{id}`           | Update note (+ concept re-processing) | `INoteRepository`, `NoteProcessorService`                    |
| `DELETE` | `/notes/{id}`           | Delete note + concept links           | `INoteRepository`                                            |

### CollectionsEndpoints (`/api/collections`)

| Method   | Route   | Description                   | Dependencies            |
| -------- | ------- | ----------------------------- | ----------------------- |
| `GET`    | `/`     | List all collections          | `ICollectionRepository` |
| `GET`    | `/{id}` | Get single collection         | `ICollectionRepository` |
| `POST`   | `/`     | Create collection             | `ICollectionRepository` |
| `PUT`    | `/{id}` | Update (with cycle detection) | `ICollectionRepository` |
| `DELETE` | `/{id}` | Delete (unlinks books first)  | `ICollectionRepository` |

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

## Maintenance Mode Middleware

The application includes middleware that intercepts requests to `/api` when `BackupSettingsProvider.IsInMaintenanceMode` is true.

- **Status Code:** 503 Service Unavailable
- **Response:** `{"error": "Application is in maintenance mode during restore."}`
- **Purpose:** Prevents concurrent database access and file modifications during sensitive restore operations.

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

| Direction   | Methods                                     |
| ----------- | ------------------------------------------- |
| Model → DTO | `ToDto()`, `ToContentDto()`                 |
| DTO → Model | `ToModel()`, `ToModel(bookId)`              |
| Update      | `Apply(dto)` — patches only non-null fields |

The `Apply` pattern supports partial updates: only fields present in the DTO are applied, preserving existing values for omitted fields.
