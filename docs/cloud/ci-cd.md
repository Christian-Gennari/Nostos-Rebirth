# Dual-mode CI, staging and one-release delivery

Issue: #402  
Parent: #258

Nostos ships SelfHosted and Cloud from one source tree and one release line. The
pipeline must therefore prove both deployment modes before an application image
is eligible for staging.

## PR graph

```text
Pull request
  |
  +-- Common backend regression
  +-- SelfHosted / SQLite
  |     +-- SQLite bootstrap/migrations
  |     +-- Library CRUD
  |     +-- local file storage
  |     +-- local backup/restore
  |     +-- no Cloud credentials
  +-- Cloud / PostgreSQL
  |     +-- shared EF model compatibility
  |     +-- provisioning + tenant isolation
  |     +-- explicit PostgreSQL migration lifecycle
  |     +-- runtime/Data Protection/worker leases
  |     +-- auth + managed-AI composition with deterministic fakes
  +-- S3-compatible object storage
  +-- SelfHosted <-> Cloud portability
  +-- tenant-scoped recovery
  +-- Angular design/unit/build
  +-- production container build + health smoke
```

`.github/workflows/ci.yml` is the only automatic PR/main orchestrator.
The focused workflows remain reusable and manually dispatchable, but no longer
each start their own overlapping PR run.

Ordinary PR validation uses disposable PostgreSQL and MinIO and deterministic
HTTP/provider fakes. It does not require Neon, B2, Clerk, Paddle, Gemini, Groq
or DigitalOcean credentials.

## One immutable release artifact

A successful `Dual-mode CI` run on `main` triggers
`.github/workflows/cloud-release.yml`.

The release workflow:

1. checks out the exact successful main commit;
2. builds the repository-root production Dockerfile once;
3. pushes exactly that image to GHCR with `sha-<40-char-commit>`;
4. records the registry digest;
5. writes `nostos-cloud-release.json` containing source SHA, tag and digest;
6. pulls the image back by digest and smoke-tests the published artifact;
7. hands that immutable digest to the `staging` environment.

The canonical deployable value is:

```text
ghcr.io/christian-gennari/nostos@sha256:<digest>
```

A future production deployment must consume that same `imageRef`. It must
not run another `docker build` from source.

## Current staging boundary

The repository defines a GitHub Environment named conceptually `staging`.
External staging resources are intentionally isolated from production:

- staging PostgreSQL/control-plane databases;
- staging B2 bucket/key (or a dedicated staging bucket);
- Clerk development/staging instance/application;
- Paddle sandbox configuration only;
- staging managed Gemini/Groq credentials;
- staging Data Protection key;
- dedicated staging/test identity;
- staging-only application URL and secrets.

No staging value may reference a production customer database, production B2
namespace/bucket, production Clerk application, production Paddle environment,
or production managed-AI credential.

The current alpha may keep staging PostgreSQL on Neon Free/Launch. Do not
provision a permanent DigitalOcean Managed PostgreSQL staging cluster for this
issue. For a future risky provider/schema change, a temporary DigitalOcean
managed PostgreSQL cluster may be created, migration-tested, and destroyed.

## GitHub `staging` environment contract

Configure these non-secret variables when an externally reachable staging app
exists:

| Variable | Purpose |
| --- | --- |
| `NOSTOS_STAGING_BASE_URL` | HTTPS origin used by the release smoke script |
| `NOSTOS_STAGING_MANAGED_AI_SMOKE` | `true` only when a bounded live Ask Nostos smoke should run |

The staging runtime itself needs environment-specific Nostos configuration such
as:

```text
Nostos__DeploymentMode=Cloud

CloudAuth__Authority=<staging Clerk OIDC issuer>
CloudAuth__ClientId=<staging OIDC client id>
CloudAuth__Audience=<staging JWT audience>

CloudObjectStorage__Bucket=<staging bucket>
CloudObjectStorage__ServiceUrl=<staging B2 S3 endpoint>
CloudObjectStorage__Region=<staging region>

CloudBilling__Paddle__Environment=Sandbox
```

Runtime secrets remain outside source control:

```text
NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION
NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION
NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION
NOSTOS_CLOUD_OBJECT_STORAGE_ACCESS_KEY
NOSTOS_CLOUD_OBJECT_STORAGE_SECRET_KEY
NOSTOS_CLOUD_AUTH_CLIENT_SECRET
NOSTOS_CLOUD_BILLING_PADDLE_API_KEY
NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET
NOSTOS_CLOUD_DATA_PROTECTION_KEY
NOSTOS_CLOUD_GEMINI_API_KEY
NOSTOS_CLOUD_GROQ_API_KEY
```

For authenticated release smoke, the GitHub `staging` environment may also
hold a **short-lived staging-only** `NOSTOS_STAGING_BEARER_TOKEN`. Do not use a
production customer token. Clerk session tokens are short-lived, so the normal
operational setup should mint/refresh this from the dedicated staging identity
immediately before a smoke run rather than storing a production-like long-lived
credential.

Until `NOSTOS_STAGING_BASE_URL` is configured, the release workflow stops at
an immutable, registry-verified staging candidate and emits a notice. This is
intentional: #402 must not invent a staging host, create paid DigitalOcean
resources, or point at production data merely to make a workflow green.

## Staging smoke contract

`scripts/cloud/staging-smoke.sh` is designed for the externally deployed
staging image. It checks:

1. `/health/live` and `/health/ready`;
2. the Angular root;
3. server-authoritative Cloud deployment capabilities;
4. anonymous session behavior;
5. when a staging bearer token is supplied:
   - authenticated session;
   - account provisioning reaches Ready/Active;
   - a temporary Library EBook is created;
   - the same book is read back;
   - the temporary book is deleted;
   - removing the bearer returns to an anonymous session;
6. when `NOSTOS_STAGING_MANAGED_AI_SMOKE=true`, one Ask Nostos turn.

The live managed-AI smoke is deliberately opt-in and release-scoped, never a PR
gate. #406 still enforces the hard per-turn ceiling (6 upstream calls, 50,000
reported tokens, 60 seconds, and $0.05 estimated cost). #405 owns monthly
metering/rate limits and is not reimplemented here.

Object-store semantics, portability and recovery remain deterministic PR gates
through MinIO. The external readiness probe additionally proves that the
configured staging object store is reachable.

## Migration gate

Cloud schema migration remains explicit.

The application does **not** migrate every customer database at web startup.
Before an image is promoted, CI must pass the disposable PostgreSQL
`CloudMigrations` lifecycle suite. A real staging rollout must then migrate
the dedicated staging/test tenant explicitly using #398's tenant migration
primitive and verify the staging application against that migrated tenant.

Do not teach startup to sweep the customer fleet.

When production rollout exists, migrate bounded batches, observe control-plane
schema/failure state, and stop promotion on migration failures or incompatible
schema versions.

## Promotion to DigitalOcean later

Issue #435 remains blocked. No App Platform service or paid DigitalOcean
database is provisioned by #402.

When #435 is unblocked, DigitalOcean App Platform should be configured to
consume the **existing immutable GHCR image reference/tag produced here**.
Promotion means changing the deployment target to the already-built artifact,
not rebuilding the application.

The eventual flow is:

```text
main commit
  -> Dual-mode CI
  -> build/push one image
  -> deploy exact digest to staging
  -> migrate/verify staging
  -> staging smoke
  -> approve
  -> deploy the same digest to production
```

## Rollback

### Application rollback

Keep release manifests/digests for known-good versions. Application rollback is
a deployment operation: point staging/production back to the previous known-good
image digest. Do not rebuild an older source commit and call that the same
artifact.

### Database rollback is not automatic

A container rollback is safe only when the previous application remains
compatible with the current database schema. EF `Down()` migrations are not a
general production rollback strategy and must not be run automatically.

For a migration that changed durable data or is not backward-compatible:

1. stop the rollout;
2. keep affected tenants out of an incompatible application/schema pairing;
3. decide explicitly between a forward fix and data recovery;
4. use provider PITR for infrastructure-level recovery where appropriate;
5. use #400 tenant-scoped staged recovery for one-customer logical recovery;
6. keep #399 portable exports available as the customer-owned recovery/exit
   format.

Never roll the entire database cluster backward to repair one customer if that
would rewind unrelated customers.

## Recovery infrastructure policy

Staging/production operations must also configure and periodically prove:

- PostgreSQL provider backups/PITR appropriate to the environment;
- control-plane PostgreSQL backup/recovery;
- B2 object versioning/lifecycle protection;
- recovery-object retention;
- restore drills.

Provider PITR is infrastructure recovery. It does not replace #400's
tenant-scoped staged restore or #399 portability.

## What #402 intentionally does not do

- provision DigitalOcean App Platform;
- provision DigitalOcean Managed PostgreSQL;
- migrate Neon production data;
- create or modify production Clerk/Paddle resources;
- run live provider calls on ordinary PRs;
- add #405 metering behavior;
- change #407 Settings/product UI.

Those remain separate work.
