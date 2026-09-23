# Nostos Cloud control plane and customer databases

Issue: #396

## Topology

Nostos Cloud keeps control-plane metadata separate from customer intellectual data.

```text
authenticated NostosAccountId
        |
        v
Cloud control plane
        |
        +-- opaque ResourceId
        +-- customer DatabaseName
        +-- object-storage namespace metadata
        +-- provisioning state
        +-- account status
        +-- schema version
        |
        v
isolated PostgreSQL customer database
        |
        +-- books
        +-- notes
        +-- concepts
        +-- writings
        +-- ordinary Nostos data
```

The control plane never stores books, note text, quotations, assistant prompts,
provider API keys or customer database passwords.

## Server-side connection configuration

Connection strings are read only from environment variables named by
`CloudControlPlane` configuration.

Defaults:

```text
NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION
NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION
NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION
```

Their roles are deliberately separate:

- **control plane** — normal application access to the metadata database;
- **admin** — operator credential allowed to create customer databases;
- **customer** — application role used by ordinary Nostos customer database connections.

The control-plane row stores only the resulting database name. Credentials
remain in server secret/environment configuration.

## Resource identity

A customer's database/storage identifiers are allocated once from a random,
opaque `ResourceId`.

Example shape:

```text
AccountId       2bf...
ResourceId      5ce...
DatabaseName    nostos_u_5ce...
StorageNamespace accounts/5ce...
```

Email, display name and OIDC subject are not embedded in resource names.

A unique `AccountId` row is the idempotency boundary. Concurrent/repeated
first requests race on that key and then reuse whichever stable mapping won.

## Provisioning lifecycle

States:

```text
NotStarted
    |
    v
Pending -> Provisioning -> Ready
                 |
                 v
               Failed
                 |
                 +---- retry ----> Provisioning
```

A retry never allocates a replacement resource mapping.

Provisioning:

1. resolve the authenticated `NostosAccountId`;
2. get/create one stable control-plane mapping;
3. mark it `Provisioning`;
4. create the PostgreSQL database if it does not already exist;
5. revoke database CONNECT from PostgreSQL `PUBLIC` and grant it to the configured application role;
6. initialize the current Nostos relational model;
7. seed/verify the LibraryState singleton;
8. verify the customer database is reachable;
9. record the schema version;
10. only then mark the account `Active` and resource `Ready`.

Failures persist only a bounded machine-readable failure code. Exception text
is logged by the server, not stored as customer metadata.

Disabled/deleted accounts can never be made Active by calling provisioning.

## Customer schema lifecycle

Issue #398 replaces #396's temporary `EnsureCreated` bridge with a dedicated
PostgreSQL migration history.

New customer databases are initialized through
`CloudTenantSchemaMigrator`, and the control plane records the exact latest
PostgreSQL EF migration id only after migration succeeds.

The short-lived #396 marker `current-model-v1` remains a recognized,
bounded compatibility state so already-created Cloud databases can be adopted
without recreating customer data. See `docs/cloud/schema-migrations.md` for
the baseline-adoption and fleet-rollout rules.

## Request-time tenant routing

Existing Nostos domain code already uses either a scoped `NostosDbContext` or
`IDbContextFactory<NostosDbContext>`.

Cloud preserves those seams.

`CloudTenantDbContextFactory` resolves:

```text
validated request principal
    -> NostosAccountId
    -> control-plane Ready resource
    -> database name
    -> server-owned customer connection settings
    -> NostosDbContext
```

No account/database selector is accepted from query strings, headers or request
bodies.

If a database is requested outside an authenticated request, or before the
resource is fully Ready/current, the factory fails closed.

Background jobs therefore need an explicit trusted account context before they
can operate on Cloud customer databases; #401 owns the long-term hosted worker
topology.

## Pre-provisioning API

An authenticated identity that has not been activated yet may use:

```http
GET  /api/cloud/provisioning/
POST /api/cloud/provisioning/
```

These endpoints require a valid Cloud identity but intentionally do not require
`AccountStatus=Active`, because their job is to create that ready account.

Responses contain only product-safe provisioning state
(`state`, `accountState`, `ready`, `retryable`). Database names, storage
namespaces, schema versions, internal failure codes and credentials are not
returned to the browser.

Normal application APIs continue to require an Active account.

## Operational inspection

`ICloudControlPlaneStore.ListAsync` exposes the metadata required for
operations/provisioning diagnostics without opening customer databases.

That surface is internal server code in #396; an operator/admin HTTP UI is not
introduced here.

## Object storage

#396 allocates the stable storage namespace metadata only.

Actual object storage and media isolation are implemented by #397.

## Billing and entitlements

The account-resource row remains focused on hosted resource/provisioning state.

#403 adds separate control-plane subscription/current-entitlement persistence
plus an immutable audit trail. Product code consumes the provider-neutral
`ICloudEntitlementService` rather than plan names or payment-provider ids.

See `docs/cloud/entitlements.md` for lifecycle semantics, SelfHosted behavior,
and the handoff to #405/#410.


## Privacy deletion lifecycle

#408 adds a separate content-free `CloudAccountDeletions` table rather than
overloading provisioning state. A confirmed deletion request changes
`AccountStatus` from `Active` to `DeletionRequested` immediately and records
a fixed 14-day grace deadline.

Normal tenant routing continues to require `Active`, so ordinary database and
object-storage access fails closed during deletion grace. A narrow internal
portable-export adapter can read the trusted existing mapping solely to produce
the #399 archive.

After the grace period, the deletion worker destructively removes the
resource-derived PostgreSQL/B2/recovery data before setting the account to
`Deleted`. Billing lifecycle transitions do not create deletion rows and can
never cause this destruction.
