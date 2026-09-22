# Portable Nostos archive v1

Issue #399 defines portability as a product boundary: a Nostos library can move
between SelfHosted and Nostos Cloud without exposing or depending on SQLite,
PostgreSQL, local filesystem layout, S3 object keys, or a cloud provider's
backup format.

The portable archive is intentionally separate from the existing SelfHosted
operational backup implementation. Operational backups remain SQLite snapshots
with local restore semantics. Portable exports serialize the Nostos domain and
stream book assets through `IBookAssetStorage`.

## Archive layout

Portable archive v1 is a ZIP container:

```text
library.nostos
├── manifest.json
├── data/
│   └── library.json
└── media/
    └── books/
        └── <book-guid-without-dashes>/
            ├── book.<supported-extension>
            └── cover.<supported-extension>
```

No archive path is used directly as a destination filesystem or object-storage
key. Import derives the destination from the stable book ID and passes the
staged stream through `IBookAssetStorage`.

### `manifest.json`

The manifest contains:

- `format: "nostos-portable"`
- `formatVersion: 1`
- `dataVersion: 1`
- export timestamp and Nostos assembly version
- entity counts
- `data/library.json` length and SHA-256
- one descriptor per media entry:
  - book ID
  - logical kind (`book` or `cover`)
  - canonical archive path
  - canonical filename
  - content type
  - uncompressed length
  - SHA-256

The manifest is written after media is streamed, so even multi-GB book/audio
assets receive integrity metadata without buffering the whole file in memory.

### `data/library.json`

This is an explicit provider-independent representation. It is not an EF Core
entity graph and contains no EF tracking state.

It preserves stable IDs and relationships for:

- Works
- concrete book types: physical, ebook, audiobook
- book metadata
- reading progress, rating, favorite state, review, last/finished timestamps
- collections and nested collection parents
- BookCollections membership and membership timestamps
- notes, selected text, source anchors, raw capture, and processing provenance
- concepts and NoteConcept links
- Writing Studio folders/documents, hierarchy, timestamps, and content
- generic book acquisition provenance
- the user's assistant capture-processing preference

## Portability classification

### A. Portable user-owned/product data

Exported:

- Works and books, including concrete format-specific fields
- bibliographic metadata
- reading state
- collections and memberships
- notes and concept links
- Writing Studio content and hierarchy
- generic acquisition provenance
- primary book/audio/PDF/EPUB files
- covers
- assistant capture-processing preference

### B. Reconstructable/generated state

Not exported:

- normalized ISBN/ASIN/title/author identity fields; rebuilt from portable data
- EPUB `LocationsJson`
- generated/extracted `ChaptersJson`
- generated cover thumbnails
- library mutation/version bookkeeping

These values are caches or deterministic derivatives, not user-owned content.

### C. Deployment-specific/operational state

Not exported:

- `BackupRecord` rows and local backup paths
- local absolute media paths
- command/idempotency receipt tables
- backup scheduling/provider state
- Cloud database names
- Cloud storage namespaces
- control-plane resource IDs
- AI provider endpoints/models and other server/provider configuration

### D. Secrets and credentials

Never exported:

- encrypted AI provider API keys
- Clerk/OIDC credentials or tokens
- database credentials
- object-storage credentials
- runtime secrets

The v1 serializer has no DTO fields for these values, so excluding them does
not depend on remembering to redact a generic EF serialization later.

## Export guarantees

Export:

1. reads relational state through the active tenant-scoped `NostosDbContext`
2. writes explicit portable data to `data/library.json`
3. reads referenced media only through `IBookAssetStorage`
4. streams media into the ZIP with SHA-256 and length accounting
5. writes the manifest after all referenced media succeeds

Export never writes, removes, or rewrites the source library.

In Cloud, both the scoped DbContext and S3 storage resolve their resources from
the trusted authenticated account context. The API accepts no account ID,
customer database name, or storage namespace.

## Import v1 contract

Version 1 deliberately supports **empty/new-library import only**.

A destination with user library content or a stored assistant preference is
rejected with `destination_not_empty`. V1 does not attempt an implicit merge
or replace operation.

Import proceeds in this order:

1. copy the request stream to server-owned temporary storage with a size limit
2. validate the ZIP structure and canonical paths
3. validate format/data versions
4. validate manifest/data checksums and declared sizes
5. validate IDs, uniqueness, parent graphs, foreign-key relationships, book
   types, normalized bibliographic uniqueness, and media references
6. stage and SHA-256-verify every media entry to server-owned temporary files
7. open a serializable relational transaction and re-check that the destination
   is empty
8. write relational state and let the database enforce its constraints
9. stream staged media into the destination through `IBookAssetStorage`
10. re-query relational counts/IDs/relationships/reading state/book formats
11. reopen stored media and verify its SHA-256 and length
12. commit the relational transaction
13. remove temporary staging

Media and relational storage cannot share one transaction. If any step before
the relational commit fails, the relational transaction is rolled back and
the importer performs compensating deletion of every imported book storage
prefix. Because v1 requires an empty destination, that cleanup cannot delete
pre-existing user media.

The import result reports the format version, entity counts, media count,
media bytes, and whether integrity verification completed.

## Archive hardening

The v1 reader rejects, before destination mutation:

- missing or malformed manifests
- unsupported format/data versions
- duplicate archive paths
- absolute paths, backslashes, `.` / `..` segments, drive-like paths, or
  oversized path segments
- unexpected entries
- excessive entry counts
- oversized compressed/uncompressed archives and entries
- suspicious compression ratios
- invalid or duplicate IDs
- malformed relationships and hierarchy cycles
- duplicate normalized ISBN/ASIN identities
- duplicate media references
- missing referenced media
- length or SHA-256 mismatches

Media filenames are restricted to the existing `BookAssetFormats` policy.
Archive paths are never trusted as filesystem destinations.

Current service-level v1 safety limits are:

- 20,000 ZIP entries
- 512 GiB compressed archive staging limit
- 1 TiB aggregate declared uncompressed limit
- 16 GiB per entry
- 64 MiB relational JSON
- 4 MiB manifest
- compression ratio ceiling for entries larger than 1 MiB

HTTP deployments may impose a lower request-body limit; that transport limit is
separate from the archive format.

## API boundary

The backend exposes a product-level API in both deployment modes:

- `GET /api/portability/export`
  - response content type: `application/vnd.nostos.portable+zip`
  - streams a portable `.nostos` archive
- `POST /api/portability/import`
  - raw request body is the portable archive
  - returns a structured import result
  - invalid archives return a typed error
  - a non-empty destination returns HTTP 409

No SQLite, PostgreSQL, S3, account-resource, or provider concepts appear in this
contract.

In Nostos Cloud the existing fallback authorization policy protects these
endpoints and the trusted tenant factories select the authenticated customer's
database and storage namespace.

## Directional use

### SelfHosted -> Cloud

1. export from SelfHosted
2. create/provision an empty Cloud library
3. POST the archive to the Cloud portability import endpoint
4. verify the structured import result

SQLite and local paths never cross the boundary.

### Cloud -> SelfHosted

1. export from the authenticated Cloud account
2. start a fresh/empty SelfHosted library
3. POST the archive to the SelfHosted portability import endpoint
4. verify the structured import result

PostgreSQL dumps, object keys, storage namespaces, and Cloud credentials never
cross the boundary.

## Compatibility policy

Format and data versions are explicit and independent.

V1 readers fail closed on unknown versions. A future v2 implementation should:

1. parse and validate the outer manifest without mutating the destination
2. dispatch the relational payload through a version-specific reader/migrator
3. migrate v1 data into the current in-memory portable model
4. run current integrity validation
5. only then enter the normal staged import path

Do not make a future v2 reader deserialize arbitrary historic EF entity graphs.
The explicit portable DTO is the compatibility contract.

## Relationship to local operational backup

The existing SelfHosted backup remains useful for fast same-installation
recovery because it can snapshot and restore SQLite directly. It is not a
migration/interchange format.

A portable archive is the supported product boundary for moving between
SelfHosted and Cloud. Code that needs portability must use
`IPortableArchiveService`, never `VACUUM INTO`, PostgreSQL dumps, raw bucket
copies, or a provider backup API.
