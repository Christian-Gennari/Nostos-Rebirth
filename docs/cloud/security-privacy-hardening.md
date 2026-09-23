# Nostos Cloud security, privacy and operability hardening

Issue: #408  
Parent: #258

This document records the security/privacy hardening contract for the current
Nostos Cloud alpha. It does not change the #435 hosting decision or the #438
public/private repository split.

## Tenant authority chain

Every customer resource lookup in Cloud follows this chain:

```text
validated OIDC/JWT or Nostos Cloud session
  -> validated issuer + subject
  -> canonical NostosAccountId
  -> trusted control-plane mapping
  -> customer PostgreSQL database / B2 namespace / commercial state
```

Browser-supplied account IDs, database names, storage namespaces, email
addresses and Clerk metadata are not tenant authority.

The existing programme tests this boundary across the major subsystems:

- `CloudProvisioningIntegrationTests`: two tenants, stable independent
  database/storage mappings, deliberately overlapping relational IDs, and
  background tenant context.
- `CloudObjectStorageIntegrationTests`: two tenants can use the same book ID
  without reading/deleting each other's B2/S3-compatible objects.
- `CloudBillingIntegrationTests`: billing/subscription state is account-bound;
  a provider subscription cannot be attached to two Nostos accounts, and
  cancellation does not delete resources.
- `CloudAiUsageIntegrationTests`: reservations/settlement are attributed to
  the trusted tenant and cannot be settled by another tenant.
- `CloudRecoveryIntegrationTests`: operational backups, restore selection,
  staging, rebind and portable export remain tenant-scoped.
- `CloudBackupSweepTests`: background backup work pushes the trusted
  control-plane account context per tenant rather than accepting request IDs.

## Authentication/session boundary

Cloud continues to use the #395/#409 provider-neutral auth path:

- authorization code + PKCE;
- HTTPS metadata;
- no provider tokens saved into the application cookie;
- `__Host-nostos-cloud`, Secure, HttpOnly, SameSite=Lax session cookie;
- bearer audience configured by `CloudAuth:Audience`;
- canonical account derived only from the validated issuer stamp + `sub`;
- Active account status and effective CloudAccess are rechecked server-side;
- Disabled/Deleted fail closed for ordinary product APIs;
- return URLs must be local absolute-path references and may not contain
  backslashes, CR or LF.

The low-level provisioning endpoint returns only product-safe state
(`state`, `accountState`, `ready`, `retryable`). Database names, storage
namespaces, schema versions and internal failure codes are not part of its HTTP
contract.

## OPDS

SelfHosted keeps the historical private-LAN/Tailscale OPDS behavior.

In Cloud, OPDS routes do not opt out of the global authorization fallback, so
both the catalogue and the acquisition URLs require the same authenticated
Active-account + CloudAccess boundary as the rest of the product. If a deployed
Cloud environment does not want OPDS reachable until e-reader-specific auth UX
exists, `Opds:Enabled=false` removes the catalogue route.

## Upload and archive hardening

The application keeps the existing 4 GiB request ceiling because legitimate
audiobooks can be large. #408 does not replace that with a small global upload
limit.

Additional protections:

- Cloud book/cover upload mutations are account-rate-limited.
- Book uploads require a supported extension and MIME/extension agreement
  (with explicit M4A/M4B and MOBI/AZW3 families; octet-stream remains allowed
  only when the extension itself is supported).
- Covers require matching PNG/JPEG MIME + extension and are capped at 25 MiB.
- Stored filenames remain server-derived (`book.<ext>`, `cover.<ext>`).
- Portable imports retain #399's canonical-path validation, entry-count limit,
  per-entry/aggregate expanded-size limits, compression-ratio protection,
  checksum verification, empty-destination rule, cancellation-safe temp
  cleanup and compensating media cleanup.
- Before media extraction, portable import checks the temporary volume and
  refuses extraction that would consume more than 80% of its remaining free
  space; this is capacity-relative rather than a small audiobook-hostile cap.
- Portable import/export uses the same #399 format; #408 creates no second
  archive format.

## Non-AI abuse and cost controls

#405 remains the owner of managed-AI quotas and spend controls.

The Cloud HTTP layer adds provider-neutral server-side fixed-window ceilings,
partitioned by the authenticated canonical Nostos account where applicable:

| Surface | Ceiling |
| --- | --- |
| low-level provisioning | 4/minute |
| book/cover upload mutations | 20/minute |
| portable import/export | 4/10 minutes |
| Cloud backup create/restore | 4/10 minutes |
| provider/acquisition surface | 120/minute |
| billing/onboarding mutations | 12/minute |
| Paddle webhook ingress | 120/minute (service-wide) |

The normal onboarding state GET is intentionally not rate-limited by the billing
mutation policy because the UI polls it while provisioning.

Paddle webhook request bodies are additionally capped at 1 MiB before provider
verification.

## Logging and privacy

Normal logs and outward-facing 5xx errors must not contain:

- Authorization headers, cookies, OIDC codes/tokens;
- Clerk/Paddle/AI Gateway/Groq/B2/PostgreSQL/Data Protection/MCP secrets;
- PostgreSQL connection strings;
- notes, writings, book/document content;
- prompts, assistant replies, tool arguments/results or transcriptions;
- imported archive document content.

The global exception handler emits only exception type + HTTP method/path for
unexpected 5xx failures. Cloud provisioning, migration, backup, recovery,
billing-webhook and portability cleanup paths likewise suppress raw exception
objects/messages while keeping bounded operational stage/error codes, account
IDs and resource IDs where needed.

Managed-AI metering remains content-free: usage dimensions, model/provider,
tokens/duration, result category and cost only.

## Provider-neutral observability

No new monitoring vendor is required. The current runtime exposes or records
the following content-free signals for a future #435 deployment:

| Failure | Signal |
| --- | --- |
| process liveness | `/health/live` |
| shared readiness | `/health/ready` |
| control-plane PostgreSQL | readiness failure + safe exception type |
| B2/S3-compatible storage | readiness failure |
| customer provisioning | control-plane provisioning state/failure code + safe log |
| customer schema migration | schema state/failure code + safe log |
| scheduled backup | sweep attempted/succeeded/failed + safe per-tenant result |
| billing reconciliation | account/provider event outcome/status |
| managed-AI provider/emergency ceiling | #405 usage/result categories and budget state |
| deletion lifecycle | pending until the retention/grace product policy is decided |

Health responses themselves remain only `ok` / `unavailable`; they do not
return provider exceptions, customer IDs or credentials.

## Staging/production separation

The #402 staging contract remains authoritative:

- staging PostgreSQL/control-plane resources are separate;
- staging B2 bucket/key or bucket is separate;
- staging Clerk application/identity is separate;
- Paddle uses Sandbox;
- staging AI Gateway/Groq credentials are separate;
- staging Data Protection key is separate;
- authenticated smoke uses a short-lived staging-only bearer token.

The managed LLM staging secret is now
`NOSTOS_CLOUD_AI_GATEWAY_API_KEY`, matching #449. Staging must never reuse a
production customer token or production provider secret merely to make smoke
tests pass.

## SelfHosted

SelfHosted does not register the Cloud rate limiter, Cloud auth, Paddle, Cloud
account lifecycle, managed Cloud telemetry/quota infrastructure or Cloud
provider credentials. Its ordinary SQLite/local-storage/OPDS/private-network
operation remains first-class.

## Account deletion policy boundary

Billing cancellation/payment state is not account deletion and never destroys
customer data.

The deletion lifecycle required by #408 remains intentionally unimplemented
until the product chooses a concrete grace/retention duration. Repository/docs/
issue search found no previously decided duration. Per #408, the implementation
must not invent one.

The eventual lifecycle will be deliberate and idempotent:

```text
Active
  -> deletion requested
  -> recoverable grace
  -> final destruction
  -> Deleted
```

Before final destruction, the existing `GET /api/portability/export` is the
customer-owned portable archive path. Final destruction must delete the current
customer database and B2 objects, safely reconcile retained recovery/superseded
resources, preserve only the minimum content-free audit needed to prove the
lifecycle, and remain retryable after partial failure without touching another
tenant.
