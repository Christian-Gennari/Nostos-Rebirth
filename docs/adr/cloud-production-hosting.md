# ADR: Nostos Cloud production hosting

- **Status:** Accepted for future production; migration deferred
- **Decision date:** 2026-09-23
- **Tracking:** #258, #435
- **Scope:** Hosted Nostos Cloud only. SelfHosted remains SQLite + local files.
- **Supersedes:** the earlier 2026-09-23 Azure-first draft of this ADR.

## Decision summary

Optimize for a bootstrapped SaaS rather than a single-enterprise-cloud architecture.

The intended paid-production stack is:

| Concern | Production target | Initial shape |
| --- | --- | --- |
| App compute | **DigitalOcean App Platform** | 1 GiB fixed shared container ($10/mo) |
| PostgreSQL | **DigitalOcean Managed PostgreSQL** | 1 GiB / 1 vCPU cluster ($15.15/mo), no standby initially |
| Media/object storage | **Backblaze B2** | pay-as-you-go, S3-compatible |
| Authentication | Clerk | existing provider-neutral auth boundary |
| Billing | Paddle | existing provider-neutral entitlement boundary |

For a Europe-first launch, prefer DigitalOcean Amsterdam (App Platform AMS + PostgreSQL AMS3) and a European B2 region, after verifying the existing alpha B2 account region.

**Fallback:** DigitalOcean App Platform + **Neon Launch** + B2. This is the least-disruptive path from the alpha database stack and remains attractive if the Nostos PostgreSQL workload is sufficiently intermittent that Neon's scale-to-zero economics beat a fixed managed cluster.

**Third candidate:** Azure App Service + Azure PostgreSQL Flexible Server + B2. This remains technically strong, but it is not materially cheaper or simpler enough for Nostos to justify making Azure the default.

Do not use Azure Blob, Supabase Storage, DigitalOcean Spaces, Railway Buckets, or Hetzner Object Storage merely to consolidate providers. The media layer should be chosen on audiobook storage/egress economics and recovery features.

## Current alpha remains unchanged

Until the migration trigger is met:

- Neon Free PostgreSQL;
- Backblaze B2 object/media storage;
- Clerk;
- Paddle/entitlements as already implemented;
- #399 portable SelfHosted ↔ Cloud export/import;
- #400 staged per-customer backup/restore;
- current alpha operator-side recovery jobs.

This ADR does not authorize infrastructure changes.

## Decision criteria

In priority order:

1. lowest sensible monthly cost;
2. minimal operational complexity;
3. managed PostgreSQL with provider backups/PITR;
4. cheap audiobook storage and delivery;
5. predictable scaling economics;
6. compatibility with the current .NET / EF Core / Npgsql / S3 architecture;
7. no infrastructure Nostos must babysit merely to save a small amount of money.

The 15 GB/user media allowance is an entitlement, not 15 GB of PostgreSQL or pre-provisioned storage.

## Candidate comparison

### 1. DigitalOcean App Platform + Managed PostgreSQL + B2 — selected

Why it fits:

- App Platform is fully managed and supports .NET buildpacks or Dockerfiles.
- It supports ordinary web services, background workers, deploy jobs and cron jobs.
- Managed PostgreSQL handles OS/engine updates and daily backups plus WAL-based PITR for the previous seven days.
- One PostgreSQL cluster can contain many databases; Nostos does not need one cluster/server per customer.
- App Platform and PostgreSQL can sit in Amsterdam on the same DigitalOcean network.
- B2 preserves the already-implemented S3-compatible object-storage boundary and is substantially cheaper than Spaces/R2 for normal Nostos egress ratios.

Published starting costs at the decision date:

- App Platform fixed 1 GiB shared container: $10/month.
- Managed PostgreSQL 1 GiB / 1 vCPU: $15.15/month.
- Initial fixed total: approximately **$25.15/month** before media.
- Managed PostgreSQL 4 GiB / 2 vCPU: $60.90/month for a plausible later scale step.
- App Platform 2 GiB shared container: $25/month.

Sources:
- <https://www.digitalocean.com/pricing/app-platform>
- <https://www.digitalocean.com/pricing/managed-databases>
- <https://docs.digitalocean.com/products/databases/postgresql/details/features/>
- <https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-users-and-databases/>
- <https://docs.digitalocean.com/products/app-platform/reference/buildpacks/dotnet/>
- <https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/>

Operational complexity: **low**.

Trade-off: the cheapest PostgreSQL topology is a single managed node, so it has provider-managed backups/PITR but not automatic standby failover. Add a standby later when the uptime promise/revenue justifies the extra database cost.

### 2. DigitalOcean App Platform + Neon Launch + B2 — fallback

Why it remains attractive:

- nearly zero database migration from the alpha topology;
- Neon is managed Postgres and explicitly supports multiple databases inside one project/cluster;
- Launch is usage-based with no fixed minimum;
- compute can suspend when idle;
- a 7-day restore window is available;
- restore-history data changes are billed separately, so recovery cost tracks write volume.

Current Neon Launch rates:

- compute: $0.106/CU-hour;
- database storage: $0.35/GB-month;
- restore history: $0.20/GB-month of retained changes.

One Neon CU is 1 vCPU / 4 GB RAM. A 0.25 CU compute is 1 GB RAM.

Sources:
- <https://neon.com/blog/major-compute-price-reduction-on-neon>
- <https://neon.com/blog/new-usage-based-pricing>
- <https://neon.com/docs/manage/endpoints/>
- <https://neon.com/blog/neon-object-hierarchy>

Operational complexity: **low**.

Trade-off: it is less bill-predictable than DigitalOcean's fixed managed database, and provider PITR applies at Neon branch/project scope rather than solving Nostos's single-customer restore requirement.

### 3. Azure App Service + Azure PostgreSQL Flexible Server + B2

Azure remains a valid production candidate:

- App Service B1: $13.14/month.
- PostgreSQL B1ms: $12.41/month.
- PostgreSQL provisioned storage: $0.115/GiB-month.
- 32 GiB database storage produces an initial Azure fixed total around **$29.23/month**.
- Azure PostgreSQL performs daily snapshots plus transaction-log backups with configurable 7–35 day PITR.

Sources:
- <https://azure.microsoft.com/pricing/details/app-service/linux/>
- <https://azure.microsoft.com/pricing/details/postgresql/flexible-server/>
- <https://learn.microsoft.com/azure/postgresql/backup-restore/concepts-backup-restore>

Operational complexity: **low-to-moderate**.

Why it loses: for Nostos's present scale it is neither cheaper nor operationally simpler enough than DigitalOcean to justify Azure's broader infrastructure surface. Keep it as an enterprise/HA-oriented future option rather than the default bootstrapped target.

### Railway all-in

Railway is appealing because app, PostgreSQL, buckets, cron and PITR can all live in one project.

Pricing is usage-based:

- Pro minimum: $20/month, credited toward usage;
- RAM: $10/GB-month;
- CPU: $20/vCPU-month;
- volume: $0.15/GB-month;
- service egress: $0.05/GB;
- Railway buckets: $0.015/GB-month with free bucket egress and API operations.

Railway also supports pgBackRest-based PITR with weekly full/daily differential backups and WAL archiving.

However, Railway's own documentation explicitly calls its PostgreSQL templates **unmanaged**: Nostos remains responsible for database backup/DR configuration, tuning, security, monitoring and maintenance.

Sources:
- <https://railway.com/pricing>
- <https://docs.railway.com/databases>
- <https://docs.railway.com/volumes/point-in-time-recovery>
- <https://docs.railway.com/storage-buckets>
- <https://docs.railway.com/storage-buckets/uploading-serving>

Operational complexity: **medium**.

Decision: not selected. Railway has excellent developer UX, but it fails the key requirement that Christian should not become the PostgreSQL operator.

### DigitalOcean one-platform with Spaces

This is the strongest single-provider "boring cloud" alternative.

Spaces costs:

- $5/month includes 250 GiB storage + 1 TiB outbound;
- additional storage: $0.02/GiB-month;
- additional egress: $0.01/GiB;
- S3-compatible;
- presigned URLs, bucket versioning and lifecycle rules are supported.

Sources:
- <https://www.digitalocean.com/pricing/spaces-object-storage>
- <https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/>
- <https://docs.digitalocean.com/products/spaces/how-to/enable-versioning/>

Operational complexity: **very low**.

Decision: do not use it as the default media store. It is attractive below the included 250 GiB / 1 TiB allowances, but B2 becomes materially cheaper as audiobook libraries scale.

### Hetzner Cloud + Object Storage

Hetzner is the cash-cost winner if Nostos runs app + PostgreSQL on a VM.

Current post-June-2026 pricing includes:

- CX23: $6.49/month;
- CX43: $18.49/month;
- server backups: +20% of server price, seven daily backup slots;
- Object Storage: $5.99/month including 1 TB stored + 1 TB outbound;
- excess object storage: $0.008/TB-hour;
- excess egress: $1.20/TB;
- S3-compatible storage supports versioning, lifecycle and Object Lock.

Sources:
- <https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/>
- <https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/>
- <https://www.hetzner.com/pressroom/object-storage/>
- <https://docs.hetzner.com/storage/object-storage/howto-protect-objects/protect-versioning/>

Operational complexity: **high** for the architecture that makes it so cheap.

The server snapshots are not PostgreSQL-aware PITR. A production-quality design requires Nostos to own OS patching, PostgreSQL upgrades, WAL archiving, monitoring, restore drills, security and probably HA/failover later.

Decision: not selected. Saving roughly $10–20/month is not worth turning the solo founder into a database/sysadmin operator.

### Supabase

Supabase is not a simplification for Nostos.

Pro is $25/month and includes daily backups with seven-day retention, but seven-day PITR is about **$100/month** extra. Its integrated Auth, Storage, PostgREST and realtime stack overlap with Clerk, Nostos's .NET API and the S3 object-storage layer.

PostgreSQL itself can host extra databases in one Supabase project, but Supabase explicitly documents that its dashboard and integrated services operate on the default postgres database; manually-created additional databases are essentially ordinary PostgreSQL databases managed outside most of the platform's value-add.

Sources:
- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/troubleshooting/manually-created-databases-are-not-visible-in-the-supabase-dashboard-4415aa>

Operational complexity: **low for PostgreSQL, but poor architectural fit**.

Decision: not selected. Nostos would pay for an integrated platform whose major differentiators it intentionally does not use.

### Azure-only baseline

Azure-only means App Service + PostgreSQL Flexible Server + Azure Blob.

It is operationally coherent, but audiobook egress is the problem. Azure currently charges Europe internet egress after the first 100 GB/month at about $0.087/GB for the next 10 TB, then $0.083/GB for the next tier.

Source:
- <https://azure.microsoft.com/pricing/details/bandwidth/>

Decision: rejected for customer media. Keep Azure compute/database + external cheap object storage as the only Azure architecture worth considering.

## Media economics

### Planning scenarios

- light: 3 GB stored/user, 3 GB delivered/user/month (1x stored bytes);
- normal: 8 GB stored/user, 12 GB delivered/user/month (1.5x);
- heavy/full: 15 GB stored/user, 30 GB delivered/user/month (2x).

### B2

At the decision date:

- $6.95/TB-month;
- first 10 GB free;
- egress free up to 3x average monthly storage;
- egress above that: $0.01/GB;
- S3-compatible;
- buckets are versioned by default;
- lifecycle rules and Object Lock are available.

Sources:
- <https://www.backblaze.com/cloud-storage/pricing>
- <https://www.backblaze.com/docs/cloud-storage-s3-compatible-api>
- <https://www.backblaze.com/docs/cloud-storage-s3-compatible-api-bucket-versions>
- <https://www.backblaze.com/docs/cloud-storage-enable-object-lock-with-the-s3-compatible-api>

Approximate marginal media storage/user/month:

| Average stored/user | B2 | R2 |
| ---: | ---: | ---: |
| 3 GB | $0.021 | $0.045 |
| 8 GB | $0.056 | $0.120 |
| 15 GB | $0.104 | $0.225 |

All three normal planning scenarios stay inside B2's 3x included-egress envelope.

Cloudflare R2 Standard is $0.015/GB-month with free egress. It becomes economically interesting only when Nostos repeatedly exceeds roughly 3.8x stored bytes in monthly delivery, before considering request costs. R2 also does not currently implement the S3 versioning/Object Lock APIs that B2 implements, although lifecycle and Cloudflare-native protection features exist.

Sources:
- <https://developers.cloudflare.com/r2/pricing/>
- <https://developers.cloudflare.com/r2/api/s3/api/>

### Critical media-delivery requirement

The merged #397 implementation currently opens S3 range streams inside the ASP.NET process and writes them through Nostos HTTP responses.

Therefore the cost tables below assume a **future direct-download path** for large Cloud media:

1. authorize the authenticated Nostos account;
2. derive the tenant-owned object key server-side;
3. issue a short-lived presigned object URL (or equivalent edge-authorized redirect);
4. let the object provider serve audiobook/PDF/EPUB bytes and HTTP ranges directly.

Do not expose arbitrary object keys to clients. Keep authorization and tenant mapping in Nostos.

This change is required before meaningful paid audiobook traffic. Otherwise App Platform/service egress can dominate the media bill even when B2 itself has free/included egress.

For example, with current DigitalOcean App Platform transfer pricing ($0.02/GiB after the plan allowance), proxying the normal 12 GB/user/month media scenario would add roughly:

- 10 users: ~$0.40/month beyond a 100 GiB allowance;
- 100 users: ~$22/month;
- 1,000 users on the 2 GiB app tier: ~$236/month beyond its 200 GiB allowance.

Direct object delivery avoids that app-egress duplication.

## Unit economics

These are planning estimates in USD/month, excluding VAT, Paddle fees, Clerk overages, managed AI/STT, support, and unusual request charges. They are not provider quotes.

The B2 rows assume direct media delivery.

### Selected DigitalOcean + B2

Assumptions:

- 10 / 100 users: App Platform $10 + Managed PostgreSQL $15.15 = $25.15 fixed.
- 1,000 users: App Platform 2 GiB $25 + PostgreSQL 4 GiB / 2 vCPU $60.90 = $85.90 fixed.
- PostgreSQL backups/PITR are included in the managed DB price.

| Users | Media | Fixed app+DB | B2 storage | B2 egress | Approx total | Cost/user |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | light | $25.15 | $0.14 | $0 | **$25.29** | $2.53 |
| 10 | normal | $25.15 | $0.49 | $0 | **$25.64** | $2.56 |
| 10 | heavy | $25.15 | $0.97 | $0 | **$26.12** | $2.61 |
| 100 | light | $25.15 | $2.02 | $0 | **$27.17** | $0.27 |
| 100 | normal | $25.15 | $5.49 | $0 | **$30.64** | $0.31 |
| 100 | heavy | $25.15 | $10.36 | $0 | **$35.51** | $0.36 |
| 1,000 | light | $85.90 | $20.78 | $0 | **$106.68** | $0.11 |
| 1,000 | normal | $85.90 | $55.53 | $0 | **$141.43** | $0.14 |
| 1,000 | heavy | $85.90 | $104.18 | $0 | **$190.08** | $0.19 |

What gets expensive first: at early scale, fixed PostgreSQL/app compute; later, database connections/compute before B2 storage. AI/payment costs are likely larger variable COGS than media storage.

### Cross-candidate totals

Same light / normal / heavy media assumptions:

| Candidate | 10 users | 100 users | 1,000 users | Main caveat |
| --- | ---: | ---: | ---: | --- |
| **DigitalOcean App + Managed PG + B2** | $25 / $26 / $26 | $27 / $31 / $36 | $107 / $141 / $190 | selected; add HA later |
| Railway all-in* | ~$22 / $23 / $24 | ~$35 / $42 / $53 | ~$125 / $200 / $305 | PostgreSQL is unmanaged |
| Hetzner VM + Object Storage* | ~$14 / $14 / $14 | ~$14 / $14 / $19 | ~$42 / $82 / $145 | Christian operates PostgreSQL/OS |
| DigitalOcean App + Neon Launch + B2* | ~$31 / $31 / $32 | ~$56 / $59 / $64 | ~$148 / $182 / $231 | workload-metered DB |
| Azure App + Azure PG + B2 | $29 / $30 / $30 | $31 / $35 / $40 | $111 / $145 / $194 | more cloud surface, similar cost |
| DigitalOcean App + Managed PG + Spaces | ~$30 all | $31 / $43 / $75 | $166 / $356 / $676 | media storage/egress scales faster |
| Supabase + app + B2, daily backups only* | ~$35 / $35 / $36 | ~$37 / $40 / $45 | ~$121 / $156 / $204 | no PITR in this price |
| Supabase + app + B2, 7-day PITR* | ~$135 / $135 / $136 | ~$137 / $140 / $145 | ~$221 / $256 / $304 | PITR add-on dominates |
| Azure-only* | ~$30 / $32 / $49 | ~$52 / $140 / $309 | ~$397 / $1,265 / $2,888 | audiobook internet egress |

Asterisks indicate especially assumption-sensitive estimates:

- Railway is usage-metered; estimates assume modest app/database RAM/CPU plus direct bucket delivery and exclude unpredictable WAL archive growth.
- Hetzner includes server backup pricing but **not** the founder time or extra infrastructure required to build PostgreSQL-aware PITR/monitoring.
- Neon estimates assume an always-responsive compute baseline that grows approximately 0.25 CU -> 0.5 CU -> 1 CU plus modest relational storage/history. Scale-to-zero can make it cheaper.
- Supabase 1,000-user estimate assumes a Medium Postgres compute and a $25 App Platform host; actual load determines compute.
- Azure-only uses an approximate Hot Blob storage planning rate; the dominant modeled cost is Azure's published internet egress rate.

## 15 GB/user commercial conclusion

A 15 GB included storage entitlement is commercially viable.

With B2, a fully-used 15 GB quota costs about **$0.10/user/month** in storage. Under the heavy planning case (30 GB/month delivered, 2x stored bytes) B2 still charges no egress because it remains within the 3x included allowance.

Even 1,000 customers all filling 15 GB produce only about **$104/month** of B2 storage.

Do not price the subscription primarily around the 15 GB quota. AI/STT, payment fees, support and database/app capacity are more important COGS.

## Backup and recovery comparison

| Candidate | Provider DB recovery | Object recovery | Nostos custom recovery burden |
| --- | --- | --- | --- |
| **DigitalOcean Managed PG + B2** | daily backups + WAL PITR, previous 7 days | B2 default versions + lifecycle + optional Object Lock | low |
| Neon Launch + B2 | configurable restore history, up to 7-day launch window | B2 versions/lifecycle/Object Lock | low |
| Azure PG + B2 | automatic snapshots + WAL PITR, 7–35 days | B2 versions/lifecycle/Object Lock | low |
| Railway | native volume backup/PITR primitives exist, but DB service is explicitly unmanaged | Railway bucket has durable S3 storage; recovery feature set is less mature than B2 | medium |
| DigitalOcean + Spaces | same managed PG recovery | Spaces versioning + lifecycle | low |
| Hetzner VM | seven daily VM snapshots; not PostgreSQL-aware PITR | versioning/lifecycle/Object Lock | **high** |
| Supabase | daily backups 7 days; PITR is paid add-on | use B2 for Nostos media | low, but expensive PITR |
| Azure-only | 7–35 day PostgreSQL PITR | Azure Blob provider durability/versioning options | low, high media egress cost |

### Provider/infrastructure recovery

The selected production provider should own:

- PostgreSQL engine/OS patching;
- scheduled database backup and WAL retention;
- cluster-level point-in-time restore;
- infrastructure host replacement;
- object durability/version history.

### Nostos application recovery remains

Do **not** remove:

- **#399**: customer-owned, provider-independent portable export/import and anti-lock-in;
- **#400**: tenant-scoped staged restore, validation and safe replacement.

Provider PITR restores a PostgreSQL cluster/server/project state. It does not safely answer "restore only customer A without rolling customers B–Z backward."

### Alpha machinery that can later disappear

After the selected managed PostgreSQL production migration is complete and a provider-native PITR restore drill succeeds, retire alpha-only machinery whose only purpose is compensating for Free-tier infrastructure recovery gaps, for example:

- Neon-Free-specific provider snapshots/manual restore glue;
- provider-level control-plane dump jobs used solely as substitute infrastructure backups;
- provider-outage reconstruction scripts specific to the alpha database provider.

Keep #400's customer-level scheduler/restore artifacts where they serve tenant-level recovery, and keep #399.

A second-provider database backup is **not required by default** for the initial paid product when managed PITR is restore-tested. Add off-provider database copies only if a documented disaster-recovery requirement later justifies their cost/complexity.

## Database-per-customer

The Nostos model remains:

- one shared PostgreSQL server/cluster;
- one control-plane database;
- one ordinary PostgreSQL database per Nostos customer;
- one object namespace per customer.

It does **not** mean one paid server/project per customer.

Provider fit:

- DigitalOcean Managed PostgreSQL: clean; explicitly supports additional databases on one cluster.
- Azure PostgreSQL: clean standard PostgreSQL.
- Neon: clean for multiple databases inside one project/branch.
- Railway/Hetzner: technically clean standard PostgreSQL, but operator burden differs.
- Supabase: technically possible, but additional databases sit outside most Supabase integrated tooling, weakening the reason to use Supabase.

Scale guidance:

### ~100 customers

Database-per-customer is sensible. Keep it.

### ~1,000 customers

Still reasonable if active concurrency is moderate, but **connection pools and fleet migrations** become the primary engineering risks. Each database has a distinct connection string/pool, so Nostos must bound per-tenant pool sizes, expire idle pools, and batch schema upgrades.

Do not redesign tenancy merely because account count reaches 1,000.

### ~10,000 customers

Do not assume a single PostgreSQL cluster should contain the entire fleet.

Before considering shared-schema multi-tenancy, first preserve the database-per-customer model and **shard customers across multiple shared PostgreSQL clusters**:

control plane -> cluster identifier -> customer database.

That keeps isolation and existing domain assumptions while bounding connection count, blast radius and migration batches.

Only revisit shared-schema TenantId-everywhere tenancy if measured economics/operations show that multi-cluster database-per-customer is the actual bottleneck.

## Staging

For the selected DigitalOcean target, avoid paying for a permanent duplicate production stack too early.

Minimum staging:

- a separate low-cost App Platform service/environment;
- staging databases isolated by names/credentials from production;
- separate B2 staging bucket/key;
- Clerk development/staging configuration;
- Paddle sandbox.

A staging database can remain on Neon Free/Launch initially if this reduces idle cost, because staging is not the production recovery boundary. Before risky PostgreSQL-provider/schema changes, use an ephemeral or short-lived DigitalOcean managed PostgreSQL staging cluster and destroy it after validation.

Do not point staging at production customer resources.

## Migration trigger

Do not migrate merely because external beta starts.

Start #435 when either:

1. Nostos is preparing for public paid launch and has roughly **10 committed paying users / €100 MRR** of demand; or
2. Neon Free capacity/recovery/operational limits are likely to block the service within roughly 30 days; or
3. Nostos is about to make a production reliability promise that the alpha stack cannot reasonably satisfy.

At that point the approximately $25/month fixed DigitalOcean app+database floor is justified by revenue rather than paid speculatively.

## Migration requirements

When #435 is eventually unblocked:

1. deploy the existing .NET application to DigitalOcean App Platform;
2. provision one DigitalOcean Managed PostgreSQL cluster, not one cluster per user;
3. migrate the control-plane and customer databases while preserving IDs and database-per-customer topology;
4. retain B2 media unless a later ADR changes the media provider;
5. enable/test DigitalOcean native backup/PITR;
6. perform a real infrastructure PITR restore drill;
7. perform a real #400 single-customer restore drill;
8. preserve #399 round-trip portability;
9. add direct, authorized large-media delivery so audiobook bytes do not proxy through App Platform at scale;
10. cut traffic over with a documented rollback path;
11. remove obsolete Neon-Free-specific recovery glue only after replacement recovery is proven;
12. compare first-month actual spend with this ADR.

## Revisit this ADR when

- B2 media delivery persistently exceeds roughly 3.8x average stored bytes/month;
- App Platform or Managed PostgreSQL pricing materially changes;
- Nostos needs automatic database failover/HA rather than restore-based recovery;
- database-per-customer connection/fleet migration pressure appears around the 1,000+ tenant scale;
- a multi-cluster database-per-customer topology is approaching its practical limits;
- a future enterprise/compliance requirement makes Azure or another provider operationally preferable.
