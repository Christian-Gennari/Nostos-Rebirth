# Nostos Cloud object storage

Issue: #397

Nostos keeps one product-level media model but uses deployment-appropriate
durable storage:

```text
SelfHosted
  IBookAssetStorage
        |
        v
  FileStorageService
        |
        v
  local filesystem

Cloud
  IBookAssetStorage
        |
        v
  S3BookAssetStorage
        |
        v
  S3-compatible object storage
```

The Cloud application never treats its container filesystem as durable customer
media storage.

## What lives in object storage

The Cloud provider stores:

- EPUB/PDF/text/Kindle-format book files;
- MP3/M4A/M4B audiobook files;
- uploaded cover images;
- generated WebP cover thumbnails.

Database rows continue to hold bibliographic/product metadata, not media blobs.

## Tenant isolation and object keys

The caller never supplies an account prefix or object key.

For every operation the Cloud provider resolves:

```text
validated request identity
  -> NostosAccountId
  -> Ready control-plane resource
  -> StorageNamespace
  -> server-derived book key
```

Object shape:

```text
<StorageNamespace>/books/<book-guid>/book.<ext>
<StorageNamespace>/books/<book-guid>/cover.<ext>
<StorageNamespace>/books/<book-guid>/cover-thumb-<width>.webp
```

`StorageNamespace` is the opaque resource namespace allocated by #396. It
contains no email address, OIDC subject, display name or client-controlled
value.

The S3 implementation is request-scoped because it consumes the authenticated
Cloud tenant context. The S3 client itself is singleton/server-owned.

## Configuration and secrets

Cloud configuration names the bucket/provider endpoint:

```text
CloudObjectStorage:Bucket
CloudObjectStorage:Region
CloudObjectStorage:ServiceUrl
CloudObjectStorage:ForcePathStyle
CloudObjectStorage:AccessKeyEnvironmentVariable
CloudObjectStorage:SecretKeyEnvironmentVariable
```

Default secret environment-variable names:

```text
NOSTOS_CLOUD_OBJECT_STORAGE_ACCESS_KEY
NOSTOS_CLOUD_OBJECT_STORAGE_SECRET_KEY
```

Credentials are never persisted in the control plane or customer database.

A custom `ServiceUrl` plus path-style requests makes the implementation usable
with S3-compatible providers as well as AWS S3.

Cloud startup performs a read/list probe against the configured bucket and
fails closed when the bucket or application credential is unavailable. The app
does not silently fall back to local disk and does not create production
buckets itself.

## HTTP delivery and ranges

Book endpoints no longer depend on absolute paths or `FileStream`.

`StoredAssetHttpResult` owns HTTP delivery semantics over an abstract stored
asset:

- `Accept-Ranges: bytes`;
- single byte ranges;
- open-ended and suffix ranges;
- `206 Partial Content`;
- `416 Range Not Satisfiable`;
- `Content-Range`;
- ETag / `If-None-Match`;
- content length;
- attachment vs inline delivery.

The storage provider receives the resolved byte range, so Cloud can issue an S3
range request instead of downloading the entire audiobook before serving a
small seek.

Covers retain the existing long revalidating cache behavior using provider
metadata rather than local `FileInfo`.

## Uploads and replacement

The current browser/API upload path streams the uploaded file into
`IBookAssetStorage`; Cloud writes that stream directly to object storage.

Replacing a primary file leaves one `book.*` object. Replacing a cover removes
the prior cover and invalidates generated thumbnails. Deleting a book deletes
only that tenant/book prefix.

The durable provider does not require a persistent container volume.

### Direct/signed uploads

#397 deliberately leaves room for a later direct-upload optimization without
changing object ownership or key derivation. A future signed-upload flow must
still have the server choose the tenant/book key and verify/finalize the object;
the client must never be allowed to choose an arbitrary bucket key.

That optimization is useful for multi-gigabyte audiobooks, but correctness does
not depend on it.

## Acquisition scratch disk

Provider acquisition/transcoding is different from durable storage: ffmpeg and
multi-part assembly require a local working directory.

Cloud therefore uses **ephemeral bounded scratch disk** for acquisition work,
then streams the finished artifact into object storage. The staged source is
deleted only after durable upload succeeds, and the acquisition directory is
cleaned when the job ends.

SelfHosted can still place acquisition scratch beside its configured books
directory to preserve same-volume rename behavior.

`Acquisition:WorkingRoot` remains the operator override when a deployment
provides a dedicated ephemeral volume.

## Backups

The existing `BackupService` is intentionally filesystem/SQLite specific. It
uses `StorageRoot`, absolute archive paths and local restore semantics.

Cloud therefore does **not** register the local backup service/worker/endpoints.
#400 implements Cloud backup/restore separately. Object storage in #397 is not
itself a backup policy.

## Test proof

The Cloud storage integration suite runs against a real S3-compatible MinIO
server and proves:

- two accounts using the same book GUID read different objects;
- one tenant cannot delete the other tenant's objects;
- primary-file replacement changes format without leaving the prior object;
- byte-range reads return the requested bytes only;
- covers and generated thumbnails work in object storage;
- cover replacement invalidates derivatives;
- book-prefix deletion removes the correct tenant's media.

Separate HTTP result tests prove range, cache-validator and attachment response
semantics independently of provider implementation.
