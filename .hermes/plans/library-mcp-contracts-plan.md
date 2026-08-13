# A. GAP ANALYSIS

Repository verified read-only against `main` at commit `2dbaeaf`. No changes made.

## 1. No authenticated MCP library surface

Severity: HIGH

Evidence:
- `Nostos.Backend/Integrations/Mcp/ReadingTrainingMcpTools.cs`
- Exactly 23 tools, all named `reading_*`.
- No MCP tools for books, collections, notes, concepts, writings, files, OPDS, or backup.
- Library operations exist only in:
  - `Nostos.Backend/Endpoints/BooksEndpoints.cs`
  - `Nostos.Backend/Endpoints/CollectionsEndpoints.cs`
  - `Nostos.Backend/Endpoints/NotesEndpoints.cs`

Consequence:
- “Add this book” requires unauthenticated REST followed by authenticated MCP queue assignment.
- Trust and error contracts change midway through one user intent.
- Hermes must understand legacy REST DTOs and MCP envelopes simultaneously.

Verdict: Candidate finding 1 is correct. This is the primary integration gap.

## 2. Library mutations have no exact-once contract

Severity: HIGH

Evidence:
- `POST /api/books` has no `idempotencyKey`.
- No library equivalent of `ReadingCommandReceipt`.
- Reading exact-once implementation:
  - `Nostos.Backend/Services/ReadingTraining/ReadingTrainingService.cs:697-798`
  - `Nostos.Backend/Data/NostosDbContext.cs:214-216`
- Reading receipts enforce unique `(ClientId, IdempotencyKey)`.
- No equivalent entity/index exists for books or collections.

Consequence:
- Transport retry, agent retry, or repeated natural-language request can create duplicate books or collections.
- A timeout after a successful create is indistinguishable from a failed create.
- Agent-side “remembering what I created” would be required unless fixed server-side.

Verdict: Candidate finding 2 is correct. Exact-once must be added before MCP mutations ship.

## 3. Book identity is under-specified and unenforced

Severity: HIGH

Evidence:
- `POST /api/books` validates only title.
- No unique constraints on ISBN, ASIN, title/author, or another stable identity.
- `BookLookupService` enriches metadata but does not establish library identity.
- `GET /api/books/lookup/{isbn}` can return `id: null`.

Consequence:
- The same edition can be created multiple times.
- Title spelling, subtitles, translators, and edition metadata can produce near-duplicates.
- Concurrent REST/UI/MCP creation cannot be made race-safe through application checks alone.

Required correction:
- Add normalized ISBN and ASIN fields with filtered unique indexes.
- Do not put a unique constraint on normalized title/author; legitimate editions and duplicate physical copies can share them.
- Run a duplicate preflight before adding the migration. The migration must not silently discard or merge existing rows.

## 4. ISBN lookup conflates metadata discovery with library membership

Severity: HIGH

Evidence:
- `GET /api/books/lookup/{isbn}` merges Google Books and OpenLibrary metadata.
- An absent book is returned as a prefilled create DTO with `id: null`.
- Membership requires a separate list/search operation.

Consequence:
- An LLM can mistake “metadata found” for “book exists in Nostos.”
- A lookup-create-queue sequence contains unnecessary interpretation and race windows.

Verdict: Candidate finding 4 is correct. Membership resolution belongs in a Nostos domain service, not in Hermes prompting.

## 5. Legacy library endpoints contain unsafe behavior that MCP must not reproduce

Severity: BLOCKER for exposing library mutations

Evidence:
- Book deletion removes files before deleting the database row:
  - `BooksEndpoints.cs:156-158`
- Reading assignments and sessions use restrictive foreign keys:
  - `NostosDbContext.cs:135-138`
  - `NostosDbContext.cs:161-164`
- Upload validation differs between:
  - `FileStorageService.IsAllowedUpload`: `FileStorageService.cs:48-58`
  - Actual save extension set: `FileStorageService.cs:86-88`
- Re-upload clears `LocationsJson`, but chapters can remain stale.
- Progress accepts unbounded percentages and does not clear `FinishedAt` when progress falls below 100.

Consequence:
- A failed delete can remove the file while leaving the database row.
- Some uploads pass initial validation and then produce a 500.
- Re-upload can leave metadata from the previous file.
- A thin MCP wrapper over endpoints or repositories would certify existing defects as the new generic contract.

Required correction:
- Introduce a canonical library service and have both REST and MCP use it.
- Do not implement MCP as a parallel copy of endpoint logic.

## 6. Zero automated coverage for books and collections

Severity: HIGH

Evidence:
- Current backend suite contains 382 tests.
- Coverage is concentrated in Reading Training, MCP authentication/tools, backup, and database bootstrap.
- No test references `/api/books` or `/api/collections`.

Consequence:
- Core library behavior is less tested than the integration being proposed.
- REST/MCP semantic equivalence cannot currently be demonstrated.
- Refactoring endpoints into a service has no regression safety.

Required correction:
- Library service and REST characterization tests precede or ship with MCP tools.
- “MCP tool returns 200” is insufficient; state, files, duplicate replay, and cross-surface results must be asserted.

## 7. Binary attachment has no suitable MCP path

Severity: HIGH for the requested experience

Evidence:
- Existing upload is multipart: `POST /api/books/{id}/file`.
- MCP Streamable HTTP tool arguments are JSON-oriented.
- Supported files can be up to 4 GB.
- No MCP file tool exists.

Consequence:
- Agent-created books may have metadata but no readable file.
- Base64 through an MCP tool would create excessive memory, payload, and receipt costs.

Verdict: Candidate finding 3 is correct, but the correct solution is not binary-over-MCP.

Recommendation:
- Keep bulk upload on REST multipart.
- Use MCP for book identity and creation, then upload to the returned book ID through `POST /api/books/{id}/file`.
- Harden and test the REST upload endpoint.
- Do not add an MCP tool accepting arbitrary server filesystem paths. That violates the generic-surface rule, leaks deployment assumptions, and only works for co-located clients.

The localhost-only REST exception is acceptable here because it is a bulk data plane, not the authoritative command plane.

## 8. Library error contracts are fragmented

Severity: MEDIUM

Evidence:
- Empty 404 responses in `BooksEndpoints.cs` and `CollectionsEndpoints.cs`.
- Anonymous `{ error }` objects.
- Bare-string `BadRequest` responses.
- RFC 7807 handling in `Program.cs:190-226`.
- Reading MCP uses `{ reply, data, stateVersion, duplicate }` with stable `data.code`.

Consequence:
- Hermes must interpret transport status, strings, anonymous errors, and MCP envelopes differently.
- New tools could accidentally expose exception text or unstable error messages.

Required contract:
- Every library MCP tool returns the existing four-field wire shape.
- Stable codes, not prose, drive client behavior.
- Suggested codes:
  - `invalid_idempotency`
  - `book_not_found`
  - `collection_not_found`
  - `invalid_book_identity`
  - `identity_conflict`
  - `confirmation_required`
  - `duplicate_identifier`
  - `invalid_collection_parent`
  - `collection_cycle`
  - `collection_name_conflict`
  - `book_in_use`
  - `lookup_timeout`

## 9. Cancellation and timeout handling is missing in the legacy library path

Severity: MEDIUM

Evidence:
- Books, collections, notes, concepts, writings, OPDS, and repositories generally do not accept `CancellationToken`.
- `ReadFormAsync` and file-copy operations do not propagate cancellation.
- `BookLookupService` uses a default `HttpClient` and effectively inherits the default 100-second timeout.
- No ISBN validation occurs before external requests.

Consequence:
- Disconnected MCP/REST clients can leave long queries, external lookups, or 4 GB file copies running.
- External metadata failures can occupy most of Hermes’s 120-second MCP call timeout.
- Cancellation accepted by an MCP tool would be cosmetic if the service drops it.

Required correction:
- Carry `CancellationToken` through tool → service → repository/external client/file storage.
- Use a named `HttpClient` with an explicit shorter timeout and typed timeout result.
- Validate ISBN before contacting external services.

## 10. Receipt design cannot be shared across domains

Severity: HIGH design constraint

Evidence:
- MCP mutations use fixed `ClientId = "nostos-mcp"`.
- Existing receipt identity is `(ClientId, IdempotencyKey)`.

Consequence:
- A shared receipt table could replay a `reading_*` response when a `library_*` command accidentally reused the same key.

Required correction:
- Add a separate `LibraryCommandReceipt` table.
- Do not generalize immediately into one universal command-receipt table.
- Preserve the current single-process exact-once model unless multi-instance deployment becomes real.

## 11. Receipt semantics need explicit limits

Severity: MEDIUM

Evidence:
- Reading receipts are retained indefinitely.
- Full response JSON is stored.
- Failed commands consume their key.
- The static command gate serializes mutations process-wide.
- Client ID, idempotency key, and response size are not comprehensively bounded.

Consequence:
- Library metadata and candidate payloads can make receipts grow faster.
- Reusing the same key after correcting an ambiguous request can replay the old failure.
- Large responses would bloat SQLite.

Required correction:
- Set maximum lengths for client ID and idempotency key.
- Store only bounded command responses.
- Document that confirmation or corrected arguments require a new key.
- Defer pruning unless receipt growth becomes measurable; do not invent TTL semantics casually.

## 12. MCP schema and tool-count drift is already present

Severity: MEDIUM

Evidence:
- Actual reading tool count is 23.
- `McpHttpTests.cs:301-308` still says “exactly the twenty-one tools.”
- The skill uses stale `mcp_nostos_` naming; actual Hermes names are `mcp__nostos__<tool>`.
- Adding the recommended 11 library/collection tools increases the total to 34.

Consequence:
- Documentation and tests can claim the wrong surface.
- Auto-injection of every tool into every chat becomes increasingly expensive and confusing.
- Broadly exposing notes, writings, concepts, backup, covers, and OPDS now would worsen schema noise without satisfying the current need.

Required correction:
- Maintain one explicit expected-tool manifest in tests/docs.
- Snapshot required parameters, read-only annotations, enum serialization, and descriptions.
- Keep v1 deliberately narrow.

## 13. Connector source of truth has drifted

Severity: HIGH operational

Evidence:
- Runtime:
  - `~/.hermes/plugins/reading-training/`
- Repository:
  - `integrations/hermes/reading-training/`
- Runtime contains Discord multi-scope routing absent from the repository copy.
- Live configuration uses `scopes`; the repository version cannot represent the deployed setup.

Consequence:
- A clean deployment from the repository would regress Discord support.
- Runtime code is currently the only surviving source of part of the integration.

Verdict: Candidate finding 6 is correct and should be fixed independently before or alongside the MCP work.

## 14. Skill policy is correct historically but blocks the intended sanctioned path

Severity: MEDIUM

Evidence:
- Reading Training skill forbids silent creation through an unrelated path.
- The current creation path is raw REST rather than a library-domain MCP command.

Consequence:
- The skill correctly prevents title-matching hacks today.
- After a safe MCP library service ships, leaving the rule unchanged would block the intended workflow.

Required correction:
- Replace the prohibition with:
  - Never create a library book through unrelated reading tools.
  - Use `library_create_or_match_book`.
  - Never fuzzy-match without confirmation.
  - Queue only the returned canonical `bookId`.

## 15. Nostos and `book-sources` are intentionally separate catalogs

Severity: MEDIUM

Evidence:
- Nostos stores one book file under `Storage/books/{bookId}/`.
- Quote verification uses `~/.hermes/book-sources/`.
- No shared identifier or synchronization exists.

Consequence:
- File discovery remains filename/path heuristic unless metadata is added to `book-sources`.
- Automatically treating a similarly titled PDF as the Nostos edition could attach the wrong translation or edition.

Decision:
- Do not build catalog synchronization now.
- Hermes may search `book-sources` after canonical book creation, but file attachment must remain optional and must use a confident author/title/edition match.
- Ambiguous files require confirmation.

## 16. Collection ordering is unsupported

Severity: LOW

Evidence:
- `Collection` has hierarchical `ParentId` but no order/sort-position field.

Consequence:
- MCP can mirror hierarchy CRUD but cannot provide persistent manual shelf ordering.

Decision:
- Do not add ordering as part of this integration.
- Treat it as a separate product feature requiring model, migration, REST, UI, and MCP changes.

## 17. Concepts are read-only by design

Severity: LOW

Evidence:
- Concepts are generated from `[[wiki-link]]` syntax by `NoteProcessorService`.
- No concept mutation surface exists in REST or UI.

Consequence:
- No integration deficiency unless Christian wants manually managed concepts.

Decision:
- Keep concepts read-only.
- Do not add concept CRUD to MCP.

## 18. REST authentication posture is acceptable only under the deployment invariant

Severity: MEDIUM risk, no immediate change

Evidence:
- No authentication or authorization middleware.
- Production binds to `127.0.0.1:5214`.
- No CORS configuration.
- MCP separately requires bearer authentication and fails closed.

Consequence:
- Current risk is bounded by loopback deployment.
- Reverse proxying, container port publication, or binding to `0.0.0.0` would expose full library and backup mutation access.

Decision:
- Do not add REST authentication in this project.
- Document and test the invariant: REST must remain loopback-only unless an explicit security project changes it.

---

# B. TARGET DESIGN

## 1. Scope: 11 new tools

This is the correct v1. Do not expose notes, concepts, writings, backup, covers, OPDS, or binary upload yet.

### Read-only

1. `library_list_books`
   - Arguments:
     - `filter`
     - `sort`
     - `search`
     - `page = 1`
     - `pageSize = 20`
     - `collectionId = null`
   - Validation:
     - `page >= 1`
     - `pageSize` clamped to `1..100`
   - Returns canonical `BookDto` page.

2. `library_get_book`
   - Arguments:
     - `bookId`
   - Returns canonical `BookDto`.

3. `library_resolve_book`
   - Arguments:
     - `isbn = null`
     - `asin = null`
     - `title = null`
     - `author = null`
     - `includeExternalMetadata = true`
   - Returns:
     - `resolution`: `exact_match | candidates | not_found | identity_conflict`
     - `matchedBook`
     - `candidates[]`
     - `prefill`
     - match reason for each candidate
   - Performs no mutation.

4. `library_list_collections`
   - No arguments.
   - Returns flat canonical collection list with `id`, `name`, `parentId`.

5. `library_get_collection`
   - Arguments:
     - `collectionId`

### Mutations

All mutation tools require `idempotencyKey` as the first argument.

6. `library_create_or_match_book`
   - Arguments:
     - `idempotencyKey`
     - `type`
     - `title`
     - optional standard metadata fields from `CreateBookDto`
     - `collectionId = null`
     - `confirmedBookId = null`
     - `forceCreate = false`
   - Returns canonical `bookId` and outcome:
     - `created`
     - `matched`
     - `confirmation_required`
   - `duplicate` remains reserved for idempotency-receipt replay.

7. `library_update_book`
   - Arguments:
     - `idempotencyKey`
     - `bookId`
     - optional mutable metadata fields
   - Needed for collection placement and metadata correction without raw REST.
   - Use explicit nullable-field semantics so `collectionId` and other fields can be cleared.

8. `library_create_collection`
   - Arguments:
     - `idempotencyKey`
     - `name`
     - `parentId = null`

9. `library_rename_collection`
   - Arguments:
     - `idempotencyKey`
     - `collectionId`
     - `name`

10. `library_move_collection`
    - Arguments:
      - `idempotencyKey`
      - `collectionId`
      - `newParentId = null`
    - Server performs cycle detection.

11. `library_delete_collection`
    - Arguments:
      - `idempotencyKey`
      - `collectionId`
      - `confirm`
    - Preserve current REST semantics: books survive and are unlinked.
    - Response must report affected book/child counts and final parent behavior.

Do not add `library_delete_book` in v1. It is not required for natural-language addition and inherits dangerous file/FK semantics. Add it only after the canonical service fixes delete ordering and explicit product semantics are settled.

## 2. Create-or-match semantics

### Identity normalization

ISBN:
- Remove spaces and hyphens.
- Uppercase terminal `X`.
- Accept only valid ISBN-10 or ISBN-13 checksums.
- Store `NormalizedIsbn`.
- Filtered unique index where non-null.

ASIN:
- Trim and uppercase.
- Store `NormalizedAsin`.
- Filtered unique index where non-null.

Title:
- Unicode normalize.
- Trim.
- Collapse internal whitespace.
- Case-fold.
- Normalize punctuation spacing.
- Do not remove subtitles automatically.

Author:
- Unicode normalize.
- Trim.
- Collapse whitespace.
- Case-fold.
- Do not remove accents or reorder names automatically.

### Resolution precedence

1. Conflicting identifiers:
   - ISBN resolves to book A and ASIN resolves to book B.
   - Return `identity_conflict`.
   - Never mutate.

2. Exact ISBN or ASIN match:
   - Return the existing book automatically.
   - `outcome = matched`.
   - `duplicate = false`.

3. One exact normalized title+author match:
   - Return the existing book automatically only when supplied identifiers do not conflict.
   - `outcome = matched`.

4. Multiple exact title/author matches:
   - Return `confirmation_required` with candidates.
   - Never choose by rating, date, type, or collection.

5. Title-only, fuzzy title, author mismatch, edition mismatch, translator mismatch:
   - Return candidates.
   - Never auto-match.

6. No plausible candidates:
   - Auto-create if there is sufficient identity:
     - valid ISBN/ASIN; or
     - title plus author; or
     - caller explicitly uses `forceCreate = true`.
   - A bare title with ambiguous external metadata returns confirmation rather than guessing.

### Confirmation flow

- First call may return `confirmation_required`.
- To use an existing row:
  - Call again with a new idempotency key and `confirmedBookId`.
- To create despite candidates:
  - Call again with a new key and `forceCreate = true`.
- Corrected or confirmed commands must not reuse the first key because failed/ambiguous receipt results may be replayed.

### Post-creation duplicates

Do not build automatic merge.

Required behavior:
- Unique ISBN/ASIN indexes prevent strong-identity duplicates.
- Title/author duplicates remain possible and sometimes legitimate.
- If duplicates are discovered later, report them.
- Do not silently move notes, files, reading sessions, assignments, or progress.
- A future merge operation would need an explicit survivor ID and a domain-by-domain transfer policy. That is separate work.

## 3. Idempotency contract

Add:
- `LibraryCommandReceipt`
- Unique `(ClientId, IdempotencyKey)`
- Separate from `ReadingCommandReceipt`
- Fixed MCP client ID: `nostos-mcp`

Envelope:

```text
{
  reply,
  data,
  stateVersion,
  duplicate
}
```

Semantics:
- `duplicate = true` only when replaying a stored receipt.
- Matching an existing book is not an idempotency duplicate:
  - `outcome = matched`
  - `duplicate = false`
- Commit state change and receipt in one transaction.
- Race on receipt insert converges on the stored winner.
- Bound idempotency key and response sizes.
- Use a separate `LibraryState` version. Do not pretend library and reading state versions are globally atomic.

The canonical service must be used by both REST and MCP; otherwise UI/REST creates can bypass normalized identity and race protection.

## 4. File attachment

Recommendation: multipart REST after MCP creation.

Sequence:
1. `library_create_or_match_book`
2. Receive canonical `bookId`
3. Locate a confident matching file under `~/.hermes/book-sources/`
4. `POST /api/books/{bookId}/file`
5. Read back `library_get_book` and verify file metadata

Do not:
- Base64 a 4 GB file into MCP JSON.
- Store binary in command receipts.
- Add `library_attach_book_file(path)` with an arbitrary server-local path.
- Make Nostos depend on `~/.hermes/book-sources/`.

Required REST upload hardening:
- One extension/content-type validation source.
- Cancellation support.
- Clear both location and chapter caches on replacement.
- Return stable file metadata.
- Re-upload of the same content should be safe.
- Add hash/size to the result if practical; this gives Hermes a verification target.

## 5. Collections

Rules:
- Identity: normalized `(name, parentId)`.
- Duplicate sibling name:
  - Create returns existing match or `collection_name_conflict`; choose one documented behavior and use it in REST and MCP.
  - Recommendation: return existing match on create; reject rename/move collisions.
- Move:
  - Null parent means root.
  - Reject self-parenting and descendant cycles.
- Delete:
  - Require `confirm = true`.
  - Books survive and are unlinked.
  - Child-collection behavior must be explicit and tested.
- Ordering:
  - Unsupported; do not imply list order is persistent.

## 6. Notes

Decision: skip notes in v1.

Reasons:
- Current requirement is library ingestion and collection management.
- Reading captures already provide the sanctioned reading-note path.
- Note mutations trigger concept extraction and add another concurrency/error domain.
- Extra tools increase the auto-injected surface from 34 upward.

Possible later pair:
- `library_list_book_notes(bookId)`
- `library_create_book_note(idempotencyKey, bookId, content, selectedText?, cfiRange?)`

Do not add note update/delete, concept CRUD, or writing CRUD until a concrete chat workflow requires them.

## 7. Composition with Reading Training

Correct sequence:

1. `library_resolve_book`
2. `library_create_or_match_book`
3. Optional REST file upload
4. Optional collection update during creation or through `library_update_book`
5. `reading_add_book(bookId, mode, makeDefault, idempotencyKey)`

Rules:
- `reading_add_book` continues accepting only an existing canonical `bookId`.
- Do not make `reading_add_book` silently create books.
- Do not add a combined `library_create_and_queue_book` tool.
- Library creation and queue assignment are two domain transactions.
- If creation succeeds and queue assignment fails, retry only `reading_add_book`.

---

# C. PHASED IMPLEMENTATION PLAN

## Phase 0 — Baseline and design freeze

Effort: S

Files:
- New design document:
  - `docs/library-mcp-contracts.md`
- Existing:
  - `docs/reading-training/contracts.md`
  - `Nostos.Backend.Tests/Integrations/Mcp/McpHttpTests.cs`

Work:
1. Freeze the 11-tool v1 manifest.
2. Freeze matching and confirmation semantics.
3. Define stable error codes.
4. Define collection delete/child behavior.
5. Audit existing ISBN/ASIN duplicates before migration.
6. Correct the stale 21-tool assertion/comment to 23.

Gates:
- Duplicate report produced with no data mutation.
- Every tool has exact arguments, read-only marker, response data type, and error codes.
- Explicit decision recorded for existing duplicate rows.
- No implementation begins while matching rules remain ambiguous.

## Phase 1 — Canonical library service and safety fixes

Effort: L

New files:
- `Nostos.Backend/Services/Library/ILibraryService.cs`
- `Nostos.Backend/Services/Library/LibraryService.cs`
- `Nostos.Backend/Services/Library/BookIdentityNormalizer.cs`
- `Nostos.Backend/Data/Models/LibraryCommandReceipt.cs`
- `Nostos.Backend/Data/Models/LibraryState.cs`
- `Nostos.Shared/Dtos/LibraryCommandDtos.cs`
- EF migration under:
  - `Nostos.Backend/Data/Migrations/`
- Tests:
  - `Nostos.Backend.Tests/Services/Library/LibraryServiceTests.cs`
  - `Nostos.Backend.Tests/Services/Library/BookIdentityNormalizerTests.cs`

Existing files:
- `Nostos.Backend/Data/NostosDbContext.cs`
- `Nostos.Backend/Program.cs`
- `Nostos.Backend/Endpoints/BooksEndpoints.cs`
- `Nostos.Backend/Endpoints/CollectionsEndpoints.cs`
- `Nostos.Backend/Data/Repositories/BookRepository.cs`
- Collection repository implementation
- `Nostos.Backend/Services/BookLookupService.cs`
- Shared book/collection DTO and mapping files

Work:
1. Add normalized ISBN and ASIN storage/indexes.
2. Add `LibraryCommandReceipt` and `LibraryState`.
3. Implement canonical create-or-match logic.
4. Move collection cycle/collision rules into the service.
5. Add cancellation end-to-end.
6. Fix pagination validation.
7. Fix progress validation and `FinishedAt` regression behavior.
8. Fix book deletion ordering internally even though delete is not exposed in MCP v1.
9. Route existing REST book/collection mutations through `ILibraryService`.

Gates:
- `dotnet build Nostos.sln`
- `dotnet test Nostos.sln`
- Normalization tests cover ISBN-10/13, punctuation, whitespace, casing, nulls, and identifier conflicts.
- Concurrent same-key create produces one row and one receipt.
- Different keys with the same ISBN produce one canonical row.
- Title/author ambiguity never auto-selects.
- Existing Angular UI behavior remains functional against the refactored REST path.

## Phase 2 — MCP book tools

Effort: M

New file:
- `Nostos.Backend/Integrations/Mcp/LibraryMcpTools.cs`

Tests:
- `Nostos.Backend.Tests/Integrations/Mcp/LibraryMcpHttpTests.cs`
- REST/MCP equivalence tests under:
  - `Nostos.Backend.Tests/Integration/LibraryCrossSurfaceTests.cs`

Tools:
- `library_list_books`
- `library_get_book`
- `library_resolve_book`
- `library_create_or_match_book`
- `library_update_book`

Work:
1. Tools delegate exactly once to `ILibraryService`.
2. Mutations require caller-supplied idempotency keys.
3. No EF, filesystem, title matching, or lookup logic in the tool class.
4. Return the standard envelope unchanged.
5. Add schema manifest tests.

Gates:
- Unauthenticated MCP requests return 401.
- Maintenance mode returns 503 before authentication.
- Missing mutation key is rejected by the MCP schema or stable service code.
- Same key replay returns the same response with `duplicate = true`.
- Existing-book match returns `outcome = matched`, `duplicate = false`.
- REST and MCP produce the same canonical book state.
- Tool count is exactly 28 after this phase: 23 existing + 5 book tools.

## Phase 3 — MCP collection tools

Effort: M

Files:
- `Nostos.Backend/Integrations/Mcp/LibraryMcpTools.cs`
- `Nostos.Backend/Services/Library/LibraryService.cs`
- `Nostos.Backend.Tests/Integrations/Mcp/LibraryMcpHttpTests.cs`
- `Nostos.Backend.Tests/Integration/LibraryCrossSurfaceTests.cs`

Tools:
- `library_list_collections`
- `library_get_collection`
- `library_create_collection`
- `library_rename_collection`
- `library_move_collection`
- `library_delete_collection`

Gates:
- Create replay is exact-once.
- Same sibling name behavior matches the frozen contract.
- Rename and move collisions are typed failures.
- Self-parent and descendant-parent moves return `collection_cycle`.
- Delete without confirmation changes nothing.
- Delete unlinks books without deleting them.
- REST, MCP, and Angular UI show the same hierarchy.
- Tool count is exactly 34.

## Phase 4 — File upload hardening and natural-language workflow

Effort: M

Files:
- `Nostos.Backend/Endpoints/BooksEndpoints.cs`
- `Nostos.Backend/Services/FileStorageService.cs`
- `Nostos.Backend/Services/MediaMetadataService.cs`
- New tests:
  - `Nostos.Backend.Tests/Endpoints/BookFileUploadTests.cs`
  - `Nostos.Backend.Tests/Services/FileStorageServiceTests.cs`
- Hermes skill:
  - `reading-training/SKILL.md`
  - Add or update a linked library workflow reference.

Work:
1. Consolidate extension and MIME validation.
2. Propagate cancellation through multipart reading and file copy.
3. Clear `LocationsJson` and `ChaptersJson` on replacement.
4. Return file size/type/hash metadata where practical.
5. Add the sanctioned Hermes sequence:
   - resolve
   - create/match
   - optional local REST upload
   - optional collection
   - optional reading assignment
6. Replace stale `mcp_nostos_` examples with `mcp__nostos__`.
7. Preserve the quote-verification rule; do not equate Nostos files with `book-sources`.

Gates:
- Every documented supported extension uploads successfully.
- Unsupported extension returns 400, never 500.
- Re-upload replaces the file and metadata cleanly.
- Interrupted upload does not leave a canonical partial file.
- End-to-end:
  - Natural-language request creates one book.
  - Matching `book-sources` file is uploaded when unambiguous.
  - Book is visible in UI and OPDS.
  - Optional reading assignment references the same `bookId`.

## Phase 5 — Hermes connector source reconciliation

Effort: S–M

Repository files:
- `integrations/hermes/reading-training/nostos_reading_connector/routing.py`
- `integrations/hermes/reading-training/nostos_reading_connector/hooks.py`
- Corresponding test files
- `integrations/hermes/reading-training/plugin.yaml`
- `integrations/hermes/README.md`
- Root `README.md`

Runtime reference:
- `~/.hermes/plugins/reading-training/`

Work:
1. Preserve the runtime Discord multi-scope implementation.
2. Back-port it into the repository.
3. Make the repository the deployable source of truth.
4. Add Telegram and Discord scope tests.
5. Do not extend the connector to intercept general library chat.
6. Library operations remain ordinary MCP tool use; the connector remains reading-lane-specific.

Gates:
- Repository connector tests pass.
- Repository and runtime functional source are identical after deployment.
- Telegram thread 17715 still dispatches.
- Discord channel 1536694335326650388 still dispatches.
- Off-scope messages remain untouched.
- Raw text and deterministic gateway idempotency keys remain unchanged.

## Phase 6 — Documentation and housekeeping

Effort: M

Files:
- `_docs/api-reference.md`
- `_docs/product-roadmap.md`
- `_docs/architecture.md`
- `Nostos.Backend/_docs/endpoints.md`
- `docs/reading-training/contracts.md`
- `docs/library-mcp-contracts.md`
- `README.md`
- `ecosystem.config.js`
- Relevant `.gitignore`
- Reading Training skill and MCP library design reference

Work:
1. Document all 34 MCP tools from one manifest.
2. Remove the claim that OPDS is future work.
3. Add reading, MCP, backup, and connector architecture.
4. State that MCP is disabled by default and enabled through production configuration.
5. Document the loopback-only REST security invariant.
6. Correct the PM2 `cwd`.
7. Remove stale duplicate docs or clearly nominate one canonical location.
8. State that collection ordering, merge, notes, writings, concepts CRUD, and backup MCP are not in v1.

Gates:
- Documentation tool list equals schema test manifest.
- No `mcp_nostos_` references remain.
- No “21 tools” reference remains.
- A clean repository deployment preserves the runtime connector behavior.
- Production smoke test confirms:
  - REST available only on loopback.
  - MCP rejects missing/incorrect bearer token.
  - Existing 23 reading tools remain unchanged.
  - New 11 library tools are present.

## Phase 7 — Final cross-surface acceptance

Effort: M

Acceptance scenarios:
1. Add a new ISBN-identified book through MCP.
2. Replay the same key.
3. Request the same ISBN with a different key.
4. Submit an ambiguous title.
5. Confirm an existing candidate.
6. Force creation with a new key.
7. Upload a local EPUB through REST.
8. Place the book in a new nested collection.
9. Rename and move that collection.
10. Assign the canonical book ID through `reading_add_book`.
11. Verify UI, REST, MCP, OPDS, and Reading Training show consistent state.
12. Verify Nostos remains fully usable with Hermes and MCP disabled.

Release order:
1. Database backup.
2. Deploy canonical service and REST refactor.
3. Run migration and duplicate checks.
4. Deploy book MCP tools.
5. Deploy collection MCP tools.
6. Harden upload.
7. Update Hermes skill.
8. Reconcile connector source.
9. Update docs.
10. Run final cross-surface acceptance.

---

# D. RISKS AND ANTI-PATTERNS

1. Do not store library identity, candidate choices, or completed command keys in Hermes.
2. Do not let `reading_add_book` create library books.
3. Do not fuzzy-match a title and mutate without confirmation.
4. Do not treat metadata lookup success as Nostos membership.
5. Do not share `ReadingCommandReceipt` with library commands.
6. Do not report a matched book as `duplicate = true`; that field means receipt replay only.
7. Do not add a combined create-upload-collect-queue transaction.
8. Do not base64 book files through MCP.
9. Do not expose arbitrary server-local paths as MCP arguments.
10. Do not make Nostos read `~/.hermes/book-sources/` as runtime state.
11. Do not attach a file based only on a fuzzy filename match.
12. Do not wrap existing endpoint code directly in MCP without a canonical service.
13. Do not add unique title/author constraints.
14. Do not auto-merge duplicates.
15. Do not expose book deletion before file/FK ordering is safe and semantics are explicit.
16. Do not expand v1 into writings, backup, cover management, OPDS administration, or concept CRUD.
17. Do not add collection ordering inside this integration.
18. Do not add REST authentication while REST remains loopback-only; instead protect the deployment invariant.
19. Do not let tool descriptions or skills encode stale exact tool counts independently of contract tests.
20. Do not edit the runtime connector without back-porting the same change to `integrations/hermes/reading-training/`.

Recommended priority: first build the canonical library service, normalized identifier handling, separate library receipts, and REST characterization tests; without that foundation, MCP would only expose legacy defects more conveniently. Then ship the five book tools, followed by six collection tools. Keep file transfer as hardened localhost multipart REST after MCP creation, and compose queue assignment through the existing `reading_add_book`. Fix the connector source drift and documentation in the same release cycle. Skip binary-over-MCP, automatic merge, notes, writings, concepts CRUD, backup tools, and collection ordering until a concrete workflow justifies them.
