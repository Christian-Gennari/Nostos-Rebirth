# Issue #29 — Change a queued book's mode + remove redundant queue entries

Plan produced by expert (GPT-5.6 Sol, max). Source: /tmp/expert_mode_change_result.txt.
This file is the implementation contract. Read it fully before coding.

## Semantics (binding)

1. **ChangeBookModeAsync**: only Active assignments. New mode must differ (`mode_unchanged` otherwise). If the assignment (source) has ANY session (planned/completed/cancelled/any status) → reject `assignment_has_sessions`. If an Active collider exists (same BookId, target mode, different id): if collider has any session → reject `mode_collision_has_sessions`; else ABSORB (delete collider, move source into target mode).
2. **Default-slot rules**: a default belongs to a mode. Source moving modes clears its old default. The source does NOT carry a sentinel into the target mode unless it inherits one: if the absorbed collider was the target mode's default, the moved source becomes the target default; otherwise source ends `DefaultSlot = null`. Unrelated defaults untouched.
3. **Two-phase persist for absorb** (unique index on DefaultSlot): inside the same MutateAsync transaction — phase 1: set source.DefaultSlot = null (and collider.DefaultSlot = null if collider); SaveChanges. Phase 2: source.Mode = target; source.DefaultSlot = inherited ? sentinel : null; db.Remove(collider); SaveChanges. A failure rolls everything back.
4. Do NOT change source QueueOrder/CreatedAt/StartedAt/CompletedAt. Do NOT renumber anything.
5. **RemoveBookAssignmentAsync**: only Active with zero sessions (any session → `assignment_has_sessions`). Completed/Archived → reject. Missing → `assignment_not_found`. Deleting the row naturally clears its default.
6. Both mutations go through `MutateAsync(clientId, idempotencyKey, commandName, handler)` — exact-once receipts, StateVersion bumps exactly once on success, unchanged on rejection, replays return original envelope with Duplicate=true.
7. Error codes (lowercase snake, via Failure(code, reply) → Data = ReadingErrorDto): `assignment_not_found`, `assignment_completed`, `assignment_archived`, `assignment_not_active`, `mode_unchanged`, `assignment_has_sessions`, `mode_collision_has_sessions`.

## Conventions (from repo, binding)

- Service methods take request records, matching SetDefaultBookAsync (NOT flat params):
  - `ReadingChangeBookModeCommandRequest(string ClientId, string IdempotencyKey, Guid AssignmentId, ReadingMode Mode)`
  - `ReadingRemoveBookAssignmentCommandRequest(string ClientId, string IdempotencyKey, Guid AssignmentId)`
- REST body DTOs (shared): `ReadingChangeBookModeRequest(string ClientId, string IdempotencyKey, ReadingMode Mode)`; `ReadingRemoveBookAssignmentRequest(string ClientId, string IdempotencyKey)`.
- Response data records: `ReadingChangeBookModeDataDto(Guid AssignmentId, Guid BookId, ReadingMode PreviousMode, ReadingMode Mode, int QueueOrder, string? DefaultSlot, bool CollisionAbsorbed, Guid? AbsorbedAssignmentId)`; `ReadingRemoveBookAssignmentDataDto(Guid AssignmentId, Guid BookId, ReadingMode Mode, int QueueOrder)`.
- MCP tools follow the existing ReadingTrainingMcpTools pattern: fixed ClientId "nostos-mcp", individual [Description]-annotated parameters (idempotencyKey, assignmentId, mode), build the command request, delegate. Names: `reading_change_book_mode`, `reading_remove_book`. Descriptions must state session-guard + absorb behavior.
- REST routes: `PATCH /api/reading-training/books/{assignmentId:guid}/mode` (body ReadingChangeBookModeRequest) and `DELETE /api/reading-training/books/{assignmentId:guid}` (body ReadingRemoveBookAssignmentRequest). Do NOT touch the existing PATCH /books/{id} set-default route.
- ToHttp: extend the 409 switch group with the new conflict codes: `mode_unchanged`, `assignment_has_sessions`, `mode_collision_has_sessions`, `assignment_completed`, `assignment_archived`, `assignment_not_active` (currently they'd fall through to 422). `assignment_not_found` already maps to 404 via the `_not_found` suffix rule.
- Formatter strings (ReadingReplyFormatter, terse coach voice, ModeWord() for mode labels):
  - ModeChanged(title, mode) → "{title} moved to {ModeWord}."
  - CollisionAbsorbed(title, mode) → "{title} moved to {ModeWord}. Duplicate queue entry removed."
  - CollisionRejected(title, mode) → "{title} already has a {ModeWord} assignment with sessions."
  - RemovedFromQueue(title) → "{title} removed from the queue."
  - ModeUnchanged(title, mode) → "{title} is already in {ModeWord}."
  - AssignmentHasSessions(title) → "{title} has sessions and cannot be changed."
  - AssignmentHasSessionsAndCannotBeRemoved(title) → "{title} has sessions and cannot be removed."
  - CompletedAssignmentCannotChange(title) → "{title} is completed and cannot be changed."
  - ArchivedAssignmentCannotChange(title) → "{title} is archived and cannot be changed."
  - AssignmentNotFound() → "Reading assignment not found."

## Backend tests (new file Nostos.Backend.Tests/ReadingTraining/ReadingBookAssignmentMutationTests.cs)

Fixture: ReadingTrainingSqliteFixture, EnsureCreated, FluentAssertions. Cover the full matrix from the expert plan: plain move (mode, order preserved, other assignments untouched, old default cleared, no target default without collider), absorb (collider deleted, source id + order preserved, gap left, target default inherited, default released before claimed, unrelated target default untouched), rejections (source with planned/completed/cancelled session; collider with any session; same mode; completed source; archived source; not found; collision rejection leaves both unchanged), versioning (success bumps once; rejection doesn't), exact-once (replay duplicate true, no double apply, original state version preserved, same key different client independent). At least one test reproduces the exact live topology: source Endurance/default-null/order 2, collider Deep/default-Deep/order 3.

Remove tests: active no-sessions removed; mode default removed; other defaults untouched; remaining orders preserved; gap left; rejects planned/completed/cancelled session; completed/archived/not-found rejects; versioning; exact-once; replay does not delete another assignment; same key different client independent.

## REST tests (new file Nostos.Backend.Tests/ReadingTraining/ReadingTrainingBookAssignmentEndpointTests.cs)

WebApplicationFactory<Program> full-host, mirroring existing ReadingTrainingHttpTests patterns. Cover: PATCH route maps + envelope shape + absorb data + replay duplicate + 404 missing + 409 same-mode/sessions/completed + 400 invalid mode + does not shadow set-default PATCH + 405s (POST/PUT/DELETE on /mode; GET/POST/PUT on /{id}); DELETE route maps + body accepted + envelope + replay + 404 + 409 sessions/completed + 405s. Assert reply, data, stateVersion, duplicate fields and exact lowercase error codes on conflicts.

## Frontend

- `Nostos.Frontend/src/app/core/services/reading-training.service.ts`: add TS interfaces (ReadingChangeBookModeRequest, ReadingRemoveBookAssignmentRequest, ReadingChangeBookModeData, ReadingRemoveBookAssignmentData) + `changeBookMode(assignmentId, request)` (PATCH `${baseUrl}/books/${assignmentId}/mode`) and `removeBookAssignment(assignmentId, request)` (DELETE `${baseUrl}/books/${assignmentId}`, body in request). Follow the file's existing command-result generics and clientId/idempotency-key conventions.
- `reading-training.store.ts`: `changingModeAssignmentId` / `removingAssignmentId` pending signals; `changeBookMode(assignmentId, mode)` optimistic (snapshot full assignments array; set source mode + clear source defaultSlot optimistically; keep queueOrder; on success reconcile from server data, remove absorbedAssignmentId row if present, apply final defaultSlot, update stateVersion; on error restore FULL snapshot + feed envelope into existing semantic-error handling; clear pending in finalize); `removeBookAssignment(assignmentId)` optimistic (remove row; restore snapshot on error; update stateVersion on success). Same-mode selection must not call REST. Respect the store's existing serialization guard (mutation_in_progress).
- `active-books.component.ts/html/css`: per Active row — compact mode <select> (3 modes) + trash button with inline confirm state (confirmingRemovalId signal; requestRemoval/confirmRemoval/cancelRemoval), disabled when that assignment has an open session or a pending mutation; aria-labels + visually-hidden label for select; emits typed outputs (e.g. changeMode/remove) for the page component to forward to the store, matching the existing output pattern. Follow the template's existing control flow style. Destructive styling token for trash; keyboard focus visible; mobile wraps.
- Wire the new outputs in `reading-training.component.ts` (onChangeMode/onRemove handlers → store), following onSetDefault pattern.

## Frontend tests

- store.spec.ts: optimistic change (mode, order preserved, old default cleared, final defaultSlot reconciled, absorbed row removed, full snapshot restore on HTTP + semantic error, envelope forwarded, clientId/idempotencyKey created, same-mode ignored, pending id exposed, finalize clears), optimistic remove (row removed, no renumber, restore on HTTP + semantic error, pending cleared, stateVersion updated, duplicate envelope reconciled).
- service spec (core/services/reading-training.service.spec.ts): PATCH path/body, DELETE path/body.
- active-books.component.spec.ts: renders 3 options, current mode selected, dispatches change with id+mode, no dispatch on same mode, accessible remove button, confirm flow (request/confirm/cancel), disable logic (open session, pending, unrelated rows unaffected), re-enable after rollback, semantic error notice, labels + aria.

## Verification (must all pass before commit)

```
dotnet build Nostos.Backend/Nostos.Backend.csproj
dotnet test Nostos.sln
dotnet ef migrations has-pending-model-changes --project Nostos.Backend --configuration Debug   # expect: no changes
cd Nostos.Frontend && npx ng build --configuration development && npx ng test --watch=false
git diff --check
```

Known pre-existing frontend failures: 7 unrelated spec files (missing ActivatedRoute provider, e.g. book-detail, app.component, add-book-modal, library, second-brain, home, workspace-layout). DO NOT fix them; report pass/fail counts separately. Backend suite should be green (pre-existing ~128 tests + new ones).

## Commit criteria

Single commit (or minimal logical commits), conventional message ("feat(reading-training): change a queued book's mode and remove unused assignments"). No migration files. Nothing Hermes-coupled. Do not touch unrelated files. Do not fix unrelated warnings (CS0420 is pre-existing).
