# Private book-text ingestion and grounded retrieval architecture

Parent epic: #468  
Phase 1 issue: #469  
Status: Phase 1 contract and implementation guide

## Purpose

Ask Nostos should answer questions about the exact PDF or EPUB a user imported without reparsing the publication on every turn and without presenting model background knowledge as if it came from the user's copy.

The original publication is authoritative. Everything introduced by this design is derived, private, versioned, bounded, and regeneratable.

## Current-system audit

### PDF reader

The Angular PDF reader already has the required navigation primitive:

- it tracks a 1-based current PDF page;
- its go-to operation accepts a page target;
- page changes update explicit assistant reader context;
- PDF highlights already carry page number plus source rectangles/text.

The canonical backend locator stores a **zero-based physical page index**. A UI adapter adds one before calling the existing reader. An optional PDF page label is stored separately.

Physical index and page label are not interchangeable. Front matter may be labelled i, ii, xii and later restart at 1, and a file may contain blank or unlabelled physical pages.

### EPUB reader

The EPUB reader already exposes stronger structural location data than a fake page number:

- epub.js relocated events expose location.start.cfi;
- the same event exposes spine href and spine index;
- the reader publishes CFI in explicit assistant context;
- its go-to operation delegates directly to rendition.display(target);
- epub.js locations JSON is cached only for progress calculation.

Grounded EPUB locators therefore use:

1. epub.js CFI when it can be produced reliably;
2. spine resource href and spine index as mandatory structural fallback;
3. deterministic offsets in normalized visible text for that spine resource.

The existing epub.js locations cache remains a progress cache, not the text index. EPUB locators never invent fixed pages.

### Import and acquisition seams

There are two durable-file commit paths today:

- manual upload -> IBookAssetStorage.SaveBookFileAsync;
- provider acquisition -> IBookAssetStorage.AdoptBookFileAsync.

Both store the authoritative publication through the provider-neutral asset boundary. Provider acquisition already uses isolated scratch space and removes staged bytes only after durable storage succeeds.

Book deletion calls IBookAssetStorage.DeleteBookFilesAsync(bookId). SelfHosted deletes the complete per-book directory; the private Cloud implementation deletes the authenticated tenant's complete per-book object prefix.

Later ingestion should be triggered only **after** a source file has durably committed. A successful basic import must not wait for parsing/indexing.

### Public product / private host boundary

The public repository now contains the reusable product assembly and SelfHosted host. Hosted implementations live in the private Nostos-Cloud composition repository.

~~~text
public product
  shared entities / NostosDbContext
  domain + assistant behavior
  storage interfaces

SelfHosted host
  SQLite
  local filesystem

private Cloud host
  PostgreSQL
  authenticated tenant context
  S3-compatible object storage
  entitlement / account policy
~~~

The book-text feature must preserve this boundary. Hosted credentials, bucket names, account routing, and PostgreSQL provisioning do not belong in the public product.

### Cloud tenant boundary

The private Cloud host resolves identity server-side:

~~~text
validated OIDC issuer + subject
        -> NostosAccountId
        -> trusted tenant context
        -> customer DB / StorageNamespace
~~~

The current S3 provider derives this prefix from trusted context:

~~~text
<StorageNamespace>/books/<book-guid>/
~~~

Book-text retrieval and artifact storage must follow the same rule. **No assistant capability or public product retrieval method accepts an account ID, tenant ID, storage namespace, or bucket key.**

### SQLite / PostgreSQL boundary

Nostos already runs one shared NostosDbContext model on SQLite and PostgreSQL. Migration histories and operational lifecycles are provider-specific.

Book-text relational entities therefore belong in the shared product model. Search mechanics are provider-specific infrastructure:

- SelfHosted: SQLite FTS5;
- Cloud: PostgreSQL full-text search.

Do not create a second Cloud book-text domain model.

### Ask Nostos execution boundary

The assistant has a deliberately small capability registry. Read-only tools are Suggest capabilities inside the existing bounded model/tool loop.

Current controls already include bounded rounds, cumulative token ceiling, wall-clock ceiling, and host AI access/usage policy.

Book-text retrieval must be one bounded read-only capability using the canonical retrieval service. It must not create an internal LLM call or a second unmetered agent loop.

## Source revision identity

A derived index belongs to one exact source revision:

~~~text
BookId
+ SHA-256(exact imported source bytes)
+ extractor version
+ source format
~~~

The public contract is BookTextSourceRevision.

Derived text is **not** identified by title, author, ISBN/ASIN, filename, provider item id, or a library-wide/global content cache.

Two users importing byte-identical files still receive isolated derived state in their own storage/database scope.

SHA-256 is normalized to lowercase hexadecimal. Extractor version is logical identity, not a user-controlled path component.

## Source locator contract

Locator types live in Nostos.Product.BookText.

### PDF

~~~text
PdfBookTextSourceLocator
  PageIndex          zero-based physical page
  PageLabel?         optional displayed/printed PDF label
  StartTextOffset?   normalized page-text offset
  EndTextOffset?     normalized page-text offset
~~~

PageIndex is authoritative for navigation. PageLabel is presentation/context.

A chunk crossing two physical pages carries two BookTextSourceSegment values; it must never collapse provenance to only its first page.

### EPUB

~~~text
EpubBookTextSourceLocator
  SpineIndex
  ResourceHref
  Cfi?               preferred reader target
  StartTextOffset?
  EndTextOffset?
~~~

ResourceHref plus SpineIndex is retained even when CFI exists. Offsets are against normalized visible text for that resource, not raw XML bytes.

Phase 5 should prefer CFI and fall back to structural location only when CFI cannot resolve.

### Audio reservation

AudioBookTextSourceLocator reserves a timestamp shape for a future supplied/on-demand transcript. It does not enable full audiobook transcription in #468 v1.

## Derived artifact schema

The full extracted representation is not a database blob.

Use gzip-compressed JSON Lines. The first record is a manifest; remaining records are ordered text blocks.

~~~json
{"recordType":"manifest","schemaVersion":1,"source":{...}}
{"recordType":"block","order":0,"text":"...","headingPath":["Part I","Chapter 1"],"sourceSegments":[...]}
{"recordType":"block","order":1,"text":"...","headingPath":["Part I","Chapter 1"],"sourceSegments":[...]}
~~~

Phase 1 defines:

- BookTextArtifactSchema;
- BookTextSourceRevision;
- BookTextArtifactManifest;
- BookTextArtifactBlock;
- BookTextSourceSegment;
- typed PDF/EPUB/audio source locators.

A source segment maps an explicit range in a derived block back to one source locator. Multiple segments preserve cross-page or cross-resource provenance.

The artifact is rebuildable and supports re-indexing, extractor debugging, and future hybrid retrieval without changing source-locator semantics.

## Phase 2 storage contract

Phase 2 should add a provider-neutral derived-artifact storage abstraction rather than exposing filesystem paths or S3 keys.

Required logical operations:

- atomically save a completed artifact for a source revision;
- open/read the artifact;
- delete one revision's derived artifacts;
- delete all derived artifacts for a book.

This operation set is distinct from primary media: replacing a source must be able to remove derived state without deleting the authoritative source or cover.

Recommended physical shape:

~~~text
SelfHosted
Storage/books/<bookId>/derived/<sourceSha256>/<extractorVersion>/extraction-v1.jsonl.gz

Cloud
<StorageNamespace>/books/<bookId>/derived/<sourceSha256>/<extractorVersion>/extraction-v1.jsonl.gz
~~~

The physical key remains provider-private. Cloud must derive StorageNamespace from authenticated tenant context exactly as its existing S3 implementation does.

## Durable ingestion lifecycle

Use persistent database state, not an in-memory-only queue.

Suggested states:

~~~text
pending
processing
ready
failed
unsupported
~~~

The state row carries at minimum BookId, source SHA-256, extractor version, format, status, bounded error information, and retry/restart timestamps.

### Initial import

1. Commit the original publication to durable book storage.
2. Complete the existing core import path.
3. Upsert book-text state to pending.
4. A background worker claims pending work.
5. Open the authoritative source through storage.
6. Compute/verify exact source SHA-256.
7. Extract into a temporary artifact.
8. Atomically publish the complete artifact.
9. Replace chunks/index rows for that exact revision transactionally.
10. Mark the revision ready.

Extraction/index failure changes book-text state, not the core book import result.

### Retry and restart

A stale processing lease must become retryable after process death. Reprocessing the same BookId + hash + extractor version is idempotent. Partial artifacts are never published.

### Source replacement

Replacing a file creates a new revision even when metadata is unchanged.

Immediately after durable replacement:

- current book-text state points to the new revision and becomes pending;
- retrieval refuses chunks from the old revision;
- old artifacts/chunks are cleaned through the replacement lifecycle;
- no answer may mix locators from old and new bytes.

Temporary unavailability while the new source indexes is acceptable. Returning stale passages from the replaced file is not.

### Deletion

Deletion removes derived artifacts, chunk rows, provider-specific FTS rows, and ingestion state. Cleanup must be idempotent and safe when extraction is being cancelled.

The existing per-book storage deletion is the final physical backstop; relational cleanup still needs an explicit cascade/transaction policy.

### Extractor upgrade

Changing BookTextArtifactSchema.CurrentExtractorVersion makes old derived state stale. Rebuild may be lazy/background, but retrieval uses only a compatible current revision.

## Extraction rules

### PDF

For text-based PDFs:

- preserve physical page order;
- record zero-based physical page index on every source segment;
- capture PDF page label separately when available;
- retain cross-page provenance explicitly;
- keep text normalization deterministic.

Do not pretend a scanned/image-only page was extracted. With no approved OCR implementation, surface unsupported/limited state honestly.

### EPUB

For EPUB:

- parse package/spine order, not ZIP entry order;
- extract normalized visible text from each spine resource;
- exclude script/style and navigation-only noise from body text;
- retain heading hierarchy;
- retain href/spine index;
- generate epub.js-compatible CFI where reliable;
- retain deterministic resource text offsets regardless of CFI availability.

Reflow, viewport, and font size never change source identity.

### Conservative normalization

V1 prioritizes fidelity:

- normalize newline conventions;
- collapse obvious intra-paragraph markup whitespace;
- preserve paragraph/heading boundaries;
- repair a line-break hyphen only under a deterministic same-paragraph rule.

Do not aggressively remove repeated headers/footers from the artifact. Ranking can later down-rank obvious furniture without destroying source provenance.

## Chunking strategy

Chunks are retrieval units, not source truth.

Initial Phase 3 targets:

- about 1,500 normalized characters;
- soft maximum about 2,500 characters;
- structure-first boundaries: chapter/section/paragraph before character count;
- at most about 200 characters of overlap when a long block must split;
- preserve all source segments at boundaries;
- preserve heading path on every chunk.

These are starting bounds for benchmarking, not a permanent API.

## Relational and lexical index model

Keep searchable units and state in SQL, not a giant full-book text column.

Shared product concepts:

~~~text
BookTextIngestionState
  BookId
  SourceSha256
  ExtractorVersion
  Format
  Status
  ...

BookTextChunk
  Id
  BookId
  SourceSha256
  ExtractorVersion
  Ordinal
  Text
  HeadingPath
  SourceProvenance
~~~

Revision fields are intentionally repeated so every retrieval can prove chunks match current source state.

Provider-specific search:

~~~text
SQLite      -> FTS5 over chunks
PostgreSQL  -> PostgreSQL full-text index over chunks
~~~

The product retrieval result/provenance shape remains the same even if ranking scores differ by provider. No vector database is required for v1.

## Retrieval service and bounds

Phase 3 should expose one canonical service conceptually like:

~~~text
SearchAsync(query, explicitBookScope, limits, ct)
    -> ranked passages + book + source revision + source segments
~~~

It must:

- verify requested books inside canonical/current library scope;
- filter to current ready revision;
- use lexical search first;
- bound candidates and returned text;
- allow bounded neighbor expansion by ordinal;
- return provenance with every passage;
- return ingestion state when evidence is unavailable.

Suggested initial assistant-facing ceiling:

- at most 8 passages;
- at most about 1,800 characters per passage;
- at most about 12,000 passage characters total;
- at most one adjacent chunk on either side of the strongest few seeds.

Phase 3 should measure/tune these constants. The invariant is that one tool call cannot dump an entire book into a model turn.

## Tenant and authorization rules

### SelfHosted

SelfHosted has one local library. Retrieval is scoped by its local NostosDbContext and local media root.

### Cloud

Cloud scoping comes from trusted host composition:

- authentication establishes account;
- account state/CloudAccess policy gates normal product APIs;
- tenant context chooses customer PostgreSQL resources;
- storage derives the customer's object prefix.

The public retrieval service never accepts caller-supplied tenant routing.

Tests must prove identical book GUIDs, identical hashes, and identical query text in two Cloud accounts cannot cross-read chunks or artifacts.

## Ask Nostos integration

Phase 4 adds one read-only retrieval capability.

Arguments may contain query text, one or more accessible book IDs or bounded library scope, and bounded result controls. They never contain tenant/account/storage identifiers.

Tool results include passage text, book identity/display metadata, exact source revision, exact source segments, and retrieval/index state.

The model must distinguish:

1. claims supported by retrieved imported-source passages;
2. independent background knowledge.

When retrieval has insufficient evidence, indexing is pending, or the source is unsupported, the assistant says so. It never synthesizes a page/CFI and presents it as retrieved evidence.

The capability stays inside existing turn accounting. Retrieved text enters the next metered model request, and the retrieval service adds its own passage/character caps.

## Reader navigation contract

### PDF

~~~text
canonical PageIndex (0-based)
    -> UI page number = PageIndex + 1
    -> existing PDF reader navigation
~~~

PageLabel can be displayed but is never substituted for physical navigation.

### EPUB

~~~text
CFI resolves
    -> existing rendition.display(CFI)

CFI absent/unresolvable
    -> ResourceHref / SpineIndex
    -> deterministic resource text offset
~~~

The fallback cannot depend on current viewport/font settings.

## Portability

Portable archives continue to contain authoritative library data and original media.

Derived artifacts, lexical indexes, and ingestion job state are not portability dependencies. After import/restore:

1. restore original publications;
2. restore ordinary metadata/notes/writing;
3. mark book-text state pending/stale;
4. rebuild artifacts and indexes locally.

This keeps SelfHosted <-> Cloud portability independent of FTS provider and artifact layout.

## Observability and privacy

Useful metrics/log fields include format, source byte count, extraction duration, block/chunk counts, status/error code, index duration, retrieval latency, candidate/result counts, and cleanup/retry counts.

Do not log raw extracted passages, complete customer search queries by default, EPUB/PDF text, model prompts containing retrieved text, or storage credentials/namespaces.

## Generated fixture harness

Phase 1 adds deterministic generated fixtures under Nostos.Backend.Tests/BookText. All prose is synthetic.

### PDF currently covers

- multiple physical pages;
- page labels different from physical page index;
- a blank physical page;
- repeated page furniture/text;
- a line-break hyphen case;
- text across a physical page boundary.

The minimal PDF 1.4 is assembled in memory with a correct xref table and transparent uncompressed text streams.

### EPUB currently covers

- explicit package/spine order;
- one logical chapter across multiple spine resources;
- nested inline markup;
- Unicode text;
- duplicate phrases in distinct resources;
- a footnote;
- internal resource/fragment link;
- explicit navigation document.

The EPUB uses a fixed ZIP timestamp so its exact source hash is deterministic.

### Later fixture expansion

Phases 2 and 5 extend this same generated harness.

PDF cases should add multi-column/reordered text, more page-label forms, textless scanned-like pages, malformed-but-recoverable metadata, repeated furniture across many pages, and chunks spanning three pages.

EPUB cases should add missing/incomplete nav, deeply split DOM text, repeated quotations across chapters, notes outside primary flow, href normalization edge cases, and explicit CFI-failure fallback.

No test needs a commercial book.

## Performance verification plan

Phase 5 benchmarks:

1. parse + index once;
2. repeated lexical query against the built index;
3. reference behavior that reparses the publication for an equivalent lookup.

Record source size/page-or-resource count, extraction/index time, index/artifact size, warm/cold retrieval latency, and returned passage bytes.

The architectural expectation is that repeated retrieval cost is bounded by index/query work rather than full source parse time. Do not invent a latency SLA before measurements exist.

## Phase map

- #469 Phase 1: contracts, architecture, generated fixture harness.
- #470 Phase 2: source hashing, PDF/EPUB extraction, private derived storage, durable ingestion lifecycle.
- #471 Phase 3: shared chunks/state, SQLite FTS5, private Cloud PostgreSQL full text, bounded tenant-safe retrieval.
- #472 Phase 4: Ask Nostos grounded retrieval capability, provenance/no-evidence behavior, deterministic integration tests.
- #473 Phase 5: source-reference UI navigation, adversarial hardening, lifecycle races, observability, benchmarks.

Parent #468 closes only after all required end-to-end behavior is verified.
