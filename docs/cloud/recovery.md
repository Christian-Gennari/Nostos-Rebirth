# Nostos Cloud backup, restore and disaster recovery

Issue #400 defines recovery for **Nostos Cloud**. It does not replace or
generalize the existing SelfHosted backup service.

## Two deployment modes, two recovery semantics

| Concern | SelfHosted | Cloud |
| --- | --- | --- |
| Relational data | SQLite | Per-customer PostgreSQL database |
| Media | Local files | Tenant-scoped object storage |
| Operational backup | Existing local `.nostos` backup | Nostos-managed operational recovery archive |
| Customer-owned portability | Portable archive from #399 | Portable archive from #399 |
| Provider recovery | Not applicable | PostgreSQL/object-storage/control-plane provider facilities |

The existing `BackupService`, `BackupWorker`, local backup settings, archive
layout and SelfHosted restore behavior are intentionally unchanged. Cloud does
not pretend that a physical SQLite copy and a managed PostgreSQL service have
the same operational semantics.

## Four different things that must not be conflated

### A. Operational backup

A Cloud operational backup is a **Nostos-managed copy of the existing #399
portable archive** plus a small operator manifest. Nostos does not introduce a
second user-data interchange format.

The archive contains the customer library's portable relational content and
irreplaceable book/cover media. It does not contain database credentials,
object-storage credentials, authentication tokens, provider secrets, or raw
control-plane connection identifiers.

Operational backup objects live under a server-derived recovery namespace:

```text
__nostos_recovery/<resource-id>/backups/<backup-id>/
    library.nostos
    manifest.json
```

The manifest binds the backup to the trusted account/resource, records the
source schema version, portable format version, counts, media totals, archive
length and SHA-256 digest. The manifest is written only after the uploaded
archive has been read back and verified.

The application exposes account-scoped Cloud endpoints to create and list
these backups. Per-customer operational backups are created automatically every
night at 00:30 UTC (configurable via `CloudRecoverySchedule:HourUtc` and
`CloudRecoverySchedule:MinuteUtc`). The schedule can be disabled by setting
`CloudRecoverySchedule:Enabled` to `false`.

### B. Customer-owned portable export

`GET /api/portability/export` remains the provider-independent escape hatch
from #399.

It is independent of Nostos's operational recovery objects and can be stored by
the customer anywhere they choose. A customer can import the same format into
SelfHosted Nostos or a fresh Cloud library. Operational backup therefore does
not create provider lock-in and does not expose infrastructure secrets.

### C. Disaster recovery

Disaster recovery is the combination of:

1. Nostos operational recovery archives;
2. provider-native PostgreSQL backup/PITR where available;
3. object-storage versioning/soft-delete/replication where available;
4. provider backup of the Cloud control-plane database; and
5. customer-owned portable exports outside Nostos infrastructure.

Provider capabilities are deployment configuration, not application promises.
Nostos must not claim PITR, cross-region durability, or a numeric RPO/RTO until
the selected production providers and policies actually supply them.

### D. Account-level restore

An account restore reconstructs **one** customer. Tenant identity comes from
the authenticated server-side account context and control plane. The request
never supplies a database name, bucket prefix, storage namespace, or account
id as authority.

The restore flow is:

```text
select backup + explicit confirmation
        |
validate operator manifest + outer SHA-256
        |
validate #399 archive and per-file checksums
        |
create fresh PostgreSQL database
        |
apply current Cloud migrations
        |
restore into fresh object-storage namespace
        |
verify relational counts / IDs / relationships / media
        |
write prepared restore audit
        |
atomically rebind control-plane mapping
        |
retain previous resources for rollback / later cleanup
```

The active database and namespace are never destructively overwritten.

If validation, import, media restore, schema setup, or verification fails before
the switch, the staged resources are cleaned up best-effort and the existing
mapping remains untouched. A concurrent mapping change also aborts activation.
A failed restore therefore does not destroy the last known-good copy.

Successful restores deliberately retain the previous database and media
namespace. Deletion policy for superseded resources belongs to later
production lifecycle/hardening work; cleanup is not part of the critical
restore transaction.

### E. Full-service/provider outage recovery

A service outage and a provider outage are different events.

- **App container loss:** the container is stateless with respect to durable
  customer data. Redeploy/restart the application and reconnect to PostgreSQL,
  object storage and the control plane.
- **One customer database/media set is damaged:** use the account-level staged
  restore above, or provider-native point-in-time recovery if that is the more
  appropriate incident response.
- **Control-plane database is damaged:** restore the control plane from its
  provider backup first. Customer databases cannot be safely rebound without
  the trusted account-to-resource mapping.
- **Primary PostgreSQL service is unavailable:** follow the configured
  provider's backup/PITR/replica procedure, then restore or repoint service
  infrastructure. The Nostos web process does not attempt fleet-wide recovery
  at startup.
- **Primary object-storage provider/bucket is unavailable:** use configured
  provider versioning/replication/backup. Operational archives stored in that
  same unavailable bucket are not, by themselves, protection from total
  provider loss.
- **Provider backups and Nostos infrastructure are both unavailable:** a
  customer-owned #399 portable export held outside the provider remains the
  independent recovery path.

## PostgreSQL strategy

Nostos-owned account restore is **logical**, not a `pg_dump` file exposed to
customers. The #399 portable archive is imported into a fresh database at the
current Cloud schema version.

This has several useful properties:

- restore can recover from a corrupt or unavailable original customer database
  as long as the recovery archive is intact;
- restored data is checked against the current domain model and migration
  history;
- IDs and relationships are preserved by the portable format;
- the web server never scans or migrates the whole customer fleet at startup;
- a restore cannot replace the active database before verification succeeds.

Production deployment should additionally enable provider-native automatic
database backups and, where supported and economically justified, point-in-time
recovery. Those facilities are valuable for operator incidents and finer
recovery points, but they are not the only copy customers can rely on.

The **control-plane PostgreSQL database also requires provider-native backup**.
The control plane contains the trusted resource mapping needed to reconnect an
account to its customer database and storage namespace. Neon's 6-hour point-in-time
recovery history remains the short-window provider recovery layer for both
customer databases and the control plane. An independent operator-side
`pg_dump` (outside the application) archives the control-plane database nightly;
per-customer databases are not backed up via `pg_dump` because the application's
own operational backup mechanism already covers them.

## Object-storage strategy

Primary user media receives the strongest retention treatment:

- EPUB/PDF/other ebook files;
- audiobooks;
- uploaded/original covers.

Generated cover thumbnails are reconstructable derivatives. They are not
included in the portable archive and can be regenerated from their source
cover, so they do not require the same retention guarantee as original media.

The product boundary stays provider-neutral. A production object-store
deployment should configure, as appropriate for the selected provider:

- object versioning or an equivalent soft-delete/recovery facility;
- deletion protection/retention for recovery archives;
- lifecycle policy for superseded versions;
- replication or an independent backup if protection from total provider
  failure is required.

Those settings are deployment requirements. The application does not invent a
portable API for provider-specific version IDs or retention locks.

## Restore verification

A Cloud operational backup has two integrity layers:

1. the recovery store verifies the complete uploaded portable archive with
   SHA-256 and records its exact length;
2. the #399 portable format verifies its own manifest/data/media checksums and
   relationships before destination mutation.

After import, Nostos additionally verifies:

- the staged database is reachable;
- it is at the current Cloud migration;
- representative relational table counts match the portable manifest;
- exactly one `LibraryState` exists;
- every primary media/cover reference represented in restored data resolves in
  the staged object namespace; and
- the total verified media count matches the imported archive.

Only then may the control plane switch to the replacement resources.

## Tenant isolation

All operations begin with `ICloudTenantContextAccessor` and resolve the
current mapping through `ICloudControlPlaneStore`.

The Cloud recovery API accepts only a backup id and an explicit restore
confirmation. It never accepts a client-supplied:

- account id;
- PostgreSQL database name;
- storage namespace;
- bucket prefix; or
- infrastructure resource id.

Recovery storage is partitioned by the opaque control-plane `ResourceId`,
which remains stable across staged restores. The operational manifest also
binds the archive to the account id and resource id, and the service fails
closed on a mismatch.

## Retention, RPO and RTO

The nightly scheduled backup sweep processes all eligible Cloud customer accounts
sequentially with per-tenant failure isolation. A failure in one customer backup
does not affect other customers or prevent their backups from completing. The
operator-side B2 lifecycle job retains the newest 3 operational backups per
resource and prunes older archives automatically.

The repository does not promise a fixed RPO/RTO or SLA for the alpha/free-tier
deployment. What can be stated honestly today:

- the logical-backup recovery point is the timestamp of the latest successfully
  completed operational backup or customer-owned export;
- provider-native RPO depends on the production PostgreSQL/object-storage
  backup configuration;
- restore time scales with database migration/import work, archive size, media
  volume and provider throughput;
- keeping the old resources after a successful switch gives operators a
  rollback copy without putting cleanup on the critical recovery path.

A production launch must choose and document concrete provider retention,
backup cadence, PITR window (if any), cross-provider/region protection and
tested recovery objectives before advertising numeric guarantees.

## Provider-dependent deployment requirements

Repository-side recovery is complete without hard-coding one cloud vendor, but
production infrastructure still needs explicit policy for:

- customer PostgreSQL automatic backups/snapshots;
- control-plane PostgreSQL backups;
- PITR availability/window if offered;
- object-store versioning or equivalent recovery;
- recovery-object retention/lifecycle;
- optional independent/cross-region object replication;
- encryption/key-management policy; and
- periodic restore drills using production-like infrastructure.

These requirements should be configured in infrastructure, not by teaching the
Nostos application to manipulate vendor-specific snapshot identifiers.
