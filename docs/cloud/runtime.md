# Nostos Cloud runtime contract

This document is the application/runtime contract for issue #401. It prepares
the existing single ASP.NET + Angular application image for the current alpha
stack and the later DigitalOcean App Platform target defined by
`docs/adr/cloud-production-hosting.md`.

It does **not** provision DigitalOcean App Platform, DigitalOcean Managed
PostgreSQL, DNS, or any other paid production resource. Those actions remain
deferred to #435.

## One application image

The production container is built by the repository-root `Dockerfile`:

1. Node 22 runs `npm ci` and the Angular production build.
2. .NET 10 restores and publishes the ASP.NET backend.
3. the Angular `browser` output is copied into the backend `wwwroot`;
4. the final .NET 10 ASP.NET runtime image installs `ffmpeg` (including
   `ffprobe`);
5. the process runs as the image's non-root `APP_UID`.

The image still represents one application:

```text
Angular SPA
    ↓
ASP.NET backend
    ↓
PostgreSQL + object storage + external providers
```

No Cloud-only frontend/backend split or microservice boundary is introduced.

The production startup command is:

```text
dotnet Nostos.Backend.dll
```

The image defaults to `ASPNETCORE_URLS=http://0.0.0.0:8080` and exposes port
8080. An ordinary container runtime or DigitalOcean App Platform may override
`ASPNETCORE_URLS`; otherwise App Platform should route its HTTP service to
internal port 8080.

SIGTERM reaches the `dotnet` process directly through the exec-form
entrypoint. ASP.NET host cancellation therefore flows into the existing
`BackgroundService` cancellation tokens, including acquisition/media work.

## Durable-state audit

Filesystem use is classified as follows.

### A. SelfHosted durable state

SelfHosted deliberately remains filesystem-backed:

- `nostos.db` SQLite library database;
- `Storage/books` book/media files;
- local covers and generated cover thumbnails;
- local `.nostos` operational backups under the configured backup root;
- the default local ASP.NET Data Protection key ring;
- explicit SelfHosted storage overrides.

These paths remain first-class and are not redirected to Cloud services.

### B. Cloud durable state — external only

A Cloud container must not be the only owner of customer data. Durable Cloud
state is:

- control plane: PostgreSQL;
- customer libraries: per-customer PostgreSQL databases;
- books/media/covers/thumbnails: B2 through the S3-compatible
  `IBookAssetStorage`;
- Nostos-managed operational recovery archives/manifests: B2;
- ASP.NET Data Protection key ring: shared control-plane PostgreSQL,
  encrypted before persistence by an injected 256-bit wrapping key.

The Cloud runtime never substitutes SQLite or local media storage when those
dependencies are unavailable.

### C. Cloud temporary/scratch state

Local Cloud filesystem use is allowed only for replaceable work:

- acquisition downloads and audiobook assembly/transcoding;
- ffmpeg/ffprobe intermediate files;
- portable import/export temporary archives;
- Cloud backup/restore temporary archives;
- framework multipart/upload buffering;
- other `Path.GetTempPath()` work.

Acquisition jobs use generated GUID directories, enforce provider byte limits
and free-space checks, and delete their working directory in `finally`.
Cloud startup also removes orphaned acquisition scratch belonging to that
container without attempting tenant-database mutation.

The final image sets `TMPDIR=/tmp/nostos`. Operators should size ephemeral
disk for the largest allowed upload/acquisition plus working overhead. A
container restart may discard this directory at any point; no completed
customer asset is considered durable until its PostgreSQL/B2 commit succeeds.

### D. Cloud-local persistence removed or disabled

#401 removes these accidental assumptions:

- ASP.NET Data Protection no longer relies on the container's local key
  directory in Cloud;
- production appsettings no longer contain the private `omenhub` AI/STT
  gateway default; that convenience remains development-only;
- SelfHosted concept cleanup and receipt-retention timers do not run in Cloud
  without an explicit tenant;
- Cloud acquisition startup reconciliation does not mutate a customer database
  without trusted tenant context;
- scheduled Cloud backup and Paddle reconciliation passes cannot execute once
  per replica concurrently: they take a PostgreSQL advisory lease.

Application logging remains stdout/stderr through ASP.NET logging; no durable
local log file is part of the Cloud contract.

## Cloud secrets and environment contract

Committed configuration may contain non-secret provider coordinates, feature
settings, bucket names, environment-variable **names**, and safe operational
limits. Production credentials are injected at runtime.

Current Cloud secret variables include:

| Environment variable | Purpose |
| --- | --- |
| `NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION` | control-plane PostgreSQL |
| `NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION` | customer-database provisioning/admin connection |
| `NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION` | customer DB connection template/base |
| `NOSTOS_CLOUD_OBJECT_STORAGE_ACCESS_KEY` | B2/S3 access key |
| `NOSTOS_CLOUD_OBJECT_STORAGE_SECRET_KEY` | B2/S3 secret key |
| `NOSTOS_CLOUD_AUTH_CLIENT_SECRET` | Clerk/OIDC client secret |
| `NOSTOS_CLOUD_BILLING_PADDLE_API_KEY` | Paddle server API key |
| `NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET` | Paddle webhook verification secret |
| `NOSTOS_CLOUD_DATA_PROTECTION_KEY` | Data Protection key-ring wrapping key |

#404 owns managed AI/voice credentials and provider behavior; #401 does not
define or migrate them.

Never bake values for these variables into Docker layers or committed
appsettings. The `.dockerignore` excludes local databases, storage,
`.nostos` archives, dotenv files, private keys/certificates, and similarly
named local secret files.

### Data Protection wrapping key

Generate `NOSTOS_CLOUD_DATA_PROTECTION_KEY` as exactly 32 random bytes encoded
as base64, for example with an operator secret generator. The same value must be
injected into every replacement Cloud instance.

The control-plane table stores only AES-GCM-encrypted Data Protection XML.
Changing the wrapping key without re-encrypting the stored key ring will make
the application fail startup intentionally. Do not casually rotate this value;
a future rotation procedure must rewrap the existing key ring before the old
secret is retired.

SelfHosted does not require this variable and keeps its existing local Data
Protection behavior.

## Startup and readiness

Cloud startup fails closed when mandatory authentication, PostgreSQL,
object-storage, billing, or Data Protection configuration is missing. It then
verifies:

1. the control-plane PostgreSQL connection/schema;
2. that the persisted Data Protection key ring can be decrypted;
3. access to the configured object-storage bucket.

Startup does not iterate through or migrate every customer database.

Health endpoints are anonymous and intentionally disclose only a coarse status:

- `GET /health/live` — process/app liveness only; no dependency calls;
- `GET /health/ready` — SelfHosted SQLite connectivity, or in Cloud the
  control-plane PostgreSQL and object-storage dependency probes.

A failed readiness response contains no connection string, customer identifier,
credential, bucket/provider exception, or detailed internal error. DigitalOcean
App Platform should use `/health/ready` as the traffic health check; liveness
is suitable for process supervision.

## Background-work topology

There are three different categories.

### Request-owned acquisition jobs

Acquisition remains an in-process bounded queue. In Cloud the queue captures
the already validated Nostos account context when the authenticated request
starts the job, then restores that trusted context in the worker scope before
touching the per-customer database/object namespace.

Its job-status store is still in memory. A replacement can therefore forget the
status ID for unfinished work, while scratch can disappear safely and no
completed durable asset is lost. Until job status/dispatch is distributed, the
initial Cloud topology should keep the web application at **one replica** for
predictable acquisition polling. This is a runtime limitation, not a reason to
add a queue system in #401.

### Fleet-wide Cloud timers

Nightly operational backup sweeps and Paddle reconciliation use named
PostgreSQL advisory locks on the control-plane database. If multiple identical
containers are present, only the instance that owns that session lock executes
the pass; the others skip it. The lock is released explicitly after the pass
and automatically if the PostgreSQL session/process disappears.

This preserves #400 backup scheduling semantics without introducing a
distributed queue or a second deployable service.

### SelfHosted-only timers

Concept cleanup, local backup, and library receipt-retention workers are
registered only in SelfHosted. Their existing implementation assumes the one
local library and has no trusted Cloud tenant during a timer tick. A future
tenant-aware Cloud fleet maintenance implementation should be explicit rather
than running these once per web replica.

## DigitalOcean App Platform compatibility

For the paid target in #435, the application-side contract is already:

- deploy this Docker image;
- HTTP port 8080 unless `ASPNETCORE_URLS` is overridden;
- health check `/health/ready`;
- inject all Cloud credentials/settings as App Platform secrets/environment;
- use one shared managed PostgreSQL cluster while preserving
  database-per-customer;
- keep B2 as durable object storage;
- assume the container filesystem is ephemeral;
- preserve the Data Protection wrapping secret across deploys/replacements;
- initially run one web replica while acquisition status remains process-local.

No DigitalOcean database, App Platform app, DNS record, paid B2 change, or
migration from Neon is created by #401.

## Explicitly deferred to #435

The following remain production-migration work, not runtime preparation:

- provisioning DigitalOcean App Platform;
- provisioning DigitalOcean Managed PostgreSQL;
- migrating the alpha Neon control/customer databases;
- DNS/cutover/rollback execution;
- production sizing and paid resource creation;
- paid-scale direct/presigned media delivery.

The alpha architecture remains Neon Free + Backblaze B2 + Clerk + Paddle until
that later migration is deliberately triggered.


## Validation

The repository workflow `.github/workflows/cloud-runtime.yml` mirrors the
#401 pre-PR gate. It builds `Nostos.sln`, runs the backend regression suite,
PostgreSQL Cloud/runtime coverage, object-storage, portability and recovery
integration tests, then runs the frontend design check, unit tests and
production build.

It also builds the repository-root production Docker image and smoke-tests the
running container by exercising `/health/live`, `/health/ready`, the SPA
root, `ffmpeg`, `ffprobe`, and non-root execution.
