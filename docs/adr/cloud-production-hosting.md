# ADR: Nostos Cloud production hosting

- **Status:** Accepted for future production; migration deferred
- **Decision date:** 2026-09-23
- **Tracking:** #258, #435
- **Scope:** Hosted Nostos Cloud only. SelfHosted remains SQLite + local files.

## Context

The current alpha is intentionally close to €0/month:

- Neon Free PostgreSQL;
- Backblaze B2 object/media storage;
- Clerk authentication;
- #399 provider-independent portable exports;
- #400 staged per-customer backup/restore plus alpha operator recovery jobs.

That stack should remain in place while Nostos is an alpha/free beta. The production decision is about what to use once paid demand justifies a small fixed infrastructure bill.

Nostos is unusual in one important way: a library may contain audiobooks. A nominal 15 GB/user storage entitlement is therefore useful, but media storage and especially download/streaming egress must stay inexpensive.

## Decision

Use a deliberately hybrid production stack:

| Concern | Production target | Initial size |
| --- | --- | --- |
| App compute | Azure App Service for Linux | Basic B1 |
| PostgreSQL | Azure Database for PostgreSQL Flexible Server | Burstable B1ms + 32 GiB |
| Media/object storage | Backblaze B2 | pay-as-you-go |
| Authentication | Clerk | existing provider-neutral auth boundary |
| Billing | Paddle | existing provider-neutral entitlement boundary |

Keep the current **control-plane database + one PostgreSQL database per customer** topology on the Azure PostgreSQL server.

Do **not** move media to Azure Blob merely to make the stack single-cloud.

Re-evaluate capacity independently:

- App Service: B1 -> B2 when measured CPU/memory/latency needs it.
- PostgreSQL: B1ms -> B2s (or a General Purpose tier later) when measured CPU, memory, connection pressure, or fleet migration work needs it.
- Tenancy: revisit database-per-customer only if connection-pool/fleet-management pressure, not raw account count, becomes the limiting factor.
- Media: reconsider R2 if measured B2 egress regularly exceeds 3x average stored bytes or B2 operations prove materially worse in practice.

## Why Azure App Service

The Nostos hosted runtime is still one ASP.NET Core application serving the Angular frontend. App Service fits that deployment shape without adding containers/Kubernetes orchestration as a product concern.

At the decision date Azure publishes Linux App Service **Basic B1** at about **$13.14/month** for 1 core / 1.75 GB RAM. B1 is appropriate for the first low-traffic paid production deployment; it can be resized without redesigning the application.

Source: <https://azure.microsoft.com/pricing/details/app-service/linux/>

## Why Azure PostgreSQL Flexible Server instead of Neon for paid production

Neon remains excellent for the €0 alpha because scale-to-zero and the Free plan avoid idle cost.

For the paid production target, Azure PostgreSQL is preferred because:

- it keeps compute and the relational control/data plane in one operational provider;
- automated backups and continuous transaction-log backup provide **7–35 day PITR**;
- the existing EF Core/Npgsql and database-per-customer design works without a persistence rewrite;
- the smallest Azure tier is inexpensive enough that the operational simplification is worth the fixed bill.

At the decision date Azure publishes:

- **B1ms:** about **$12.41/month**, 1 vCore / 2 GiB;
- provisioned PostgreSQL storage: about **$0.115/GiB-month**;
- backup storage up to 100% of provisioned server storage has no additional charge;
- **B2s:** about **$49.64/month**, 2 vCore / 4 GiB.

Therefore B1ms + 32 GiB is about **$16.09/month** before any backup storage beyond the included amount.

Azure documents automatic daily backups plus continuous transaction-log backup and PITR over the configured 7–35 day retention window.

Sources:

- <https://azure.microsoft.com/pricing/details/postgresql/flexible-server/>
- <https://learn.microsoft.com/azure/postgresql/backup-restore/concepts-business-continuity>

### Neon comparison

Neon paid plans remain usage-based and may still be cheaper for intermittently active development/staging databases. Its 2026 pricing also makes it a viable fallback.

The reason for selecting Azure PostgreSQL for the production target is not a fundamental Neon limitation; it is the simpler production operating model once Nostos is already paying for Azure compute and wants provider-managed PITR as the primary infrastructure recovery layer.

## Why Backblaze B2 for media

Backblaze B2 remains the media store in production.

At the decision date B2 publishes:

- **$6.95/TB-month** pay-as-you-go storage;
- **free egress up to 3x average monthly storage**;
- egress above that at **$0.01/GB**;
- S3-compatible API;
- buckets version files by default;
- lifecycle rules and Object Lock are available.

Sources:

- <https://www.backblaze.com/cloud-storage/pricing>
- <https://www.backblaze.com/docs/cloud-storage-s3-compatible-api>
- <https://www.backblaze.com/docs/cloud-storage-s3-compatible-api-bucket-versions>

This also avoids an unnecessary media migration because Nostos already targets an S3-compatible object-storage boundary.

## Why not Cloudflare R2 as the default

R2 is the best alternative if Nostos becomes unusually egress-heavy.

At the decision date R2 Standard publishes:

- **$0.015/GB-month** storage;
- no internet egress charge;
- S3-compatible API;
- 11-nines annual durability;
- lifecycle support.

Sources:

- <https://developers.cloudflare.com/r2/pricing/>
- <https://developers.cloudflare.com/r2/api/s3/api/>
- <https://developers.cloudflare.com/r2/buckets/storage-classes/>

For normal Nostos usage, B2 is cheaper because its storage price is less than half R2's while already including egress up to 3x stored bytes. R2 becomes attractive only if measured media delivery repeatedly pushes above B2's included egress envelope enough to offset the higher storage rate.

R2 also does not currently implement every S3 feature (for example S3 Object Lock is not implemented), so B2 has the stronger recovery/version-retention fit today.

## Why not Azure Blob for media

Azure Blob would simplify the provider list, but it would make audiobook delivery materially more expensive.

Azure internet egress from Europe currently provides the first 100 GB/month free and then charges about **$0.087/GB** for the next 10 TB on the premium global network.

Source: <https://azure.microsoft.com/pricing/details/bandwidth/>

For a media product, egress can therefore dominate the storage bill. That cost is not justified merely to keep media in the same provider as compute/database.

Azure Blob remains a valid future choice for small operational artifacts, not the default customer audiobook/ebook store.

## 15 GB/user economics

The 15 GB plan allowance is a **quota**, not pre-provisioned capacity. B2 charges actual bytes stored.

Ignoring the account-wide first 10 GB free allowance, approximate B2 storage cost per user is:

| Average stored/user | B2 storage/user/month | R2 storage/user/month |
| ---: | ---: | ---: |
| 3 GB | $0.021 | $0.045 |
| 8 GB | $0.056 | $0.120 |
| 15 GB | $0.104 | $0.225 |

Even if every user fills a 15 GB allowance, B2 media storage costs only about **10.4 cents/user/month** before unusual egress.

### Media egress assumptions

Use these planning cases:

- **light:** 3 GB stored/user, 3 GB egress/user/month (1x);
- **normal:** 8 GB stored/user, 12 GB egress/user/month (1.5x);
- **heavy/full:** 15 GB stored/user, 30 GB egress/user/month (2x).

All three remain inside B2's included 3x egress envelope, so modeled B2 bandwidth cost is **$0**.

A stress case of **5x stored bytes downloaded per month** would exceed the free envelope by 2x stored bytes and add approximately:

- 3 GB stored: **$0.06/user/month**;
- 8 GB stored: **$0.16/user/month**;
- 15 GB stored: **$0.30/user/month**.

## Production unit-economics model

Public list prices are planning figures, USD/month, excluding VAT, support plans, Paddle fees, managed-AI/STT spend, and unusual request charges. Region/invoice pricing can differ.

### Fixed infrastructure assumptions

For 10 and 100 users:

- App Service B1: $13.14;
- PostgreSQL B1ms: $12.41;
- PostgreSQL 32 GiB: $3.68;
- total fixed: **$29.23/month**.

For 1,000 users, model a conservative vertical step:

- App Service B2: $25.55;
- PostgreSQL B2s: $49.64;
- PostgreSQL 128 GiB: $14.72;
- total fixed: **$89.91/month**.

The 1,000-user sizing is a planning assumption, not an automatic user-count rule.

### Monthly cost estimate

Normal modeled egress is within B2's free allowance.

| Users | Avg stored/user | Fixed infra | B2 storage | B2 egress | Approx total | Approx total/user |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 3 GB | $29.23 | $0.21 | $0 | **$29.44** | **$2.94** |
| 10 | 8 GB | $29.23 | $0.56 | $0 | **$29.79** | **$2.98** |
| 10 | 15 GB | $29.23 | $1.04 | $0 | **$30.27** | **$3.03** |
| 100 | 3 GB | $29.23 | $2.09 | $0 | **$31.32** | **$0.31** |
| 100 | 8 GB | $29.23 | $5.56 | $0 | **$34.79** | **$0.35** |
| 100 | 15 GB | $29.23 | $10.43 | $0 | **$39.66** | **$0.40** |
| 1,000 | 3 GB | $89.91 | $20.85 | $0 | **$110.76** | **$0.11** |
| 1,000 | 8 GB | $89.91 | $55.60 | $0 | **$145.51** | **$0.15** |
| 1,000 | 15 GB | $89.91 | $104.25 | $0 | **$194.16** | **$0.19** |

The **marginal media-storage cost** of another user is therefore only about **$0.02–$0.10/month** across the modeled 3–15 GB range. In practice, managed AI and payment fees are more likely to matter to subscription pricing than the nominal 15 GB media quota.

### 5x-download stress case

At 5x downloaded bytes/month, B2 egress adds approximately $0.06 / $0.16 / $0.30 per user for the 3 / 8 / 15 GB storage cases.

For example, 1,000 users each storing 15 GB and downloading 75 GB/month would model to roughly:

- fixed infrastructure: $89.91;
- storage: $104.25;
- egress overage: $300;
- total: **$494.16/month**, or about **$0.49/user/month** before AI/payment costs.

This is deliberately far above the expected normal audiobook traffic model and is the threshold region where R2 should be re-evaluated.

## Recovery responsibility split

### Provider / infrastructure recovery

**Azure PostgreSQL**

- automated backups;
- transaction-log backup;
- 7–35 day PITR;
- restore to a replacement server after infrastructure/database failure.

**Azure App Service**

- application process/host replacement;
- no customer durable data may depend on the App Service filesystem.

**Backblaze B2**

- object durability;
- version history;
- lifecycle retention;
- optional Object Lock where appropriate.

### Nostos application recovery

Provider backups do not replace product-level recovery.

Keep:

- **#400 staged per-customer restore** for tenant-scoped logical recovery, validation, and safe replacement;
- **#399 portable export/import** for customer ownership and provider-independent exit/re-entry;
- restore verification and tenant-boundary checks.

Azure PITR is primarily **server/infrastructure recovery**. With multiple customer databases on one server, a PITR restoration may recover a whole server to a new server; Nostos still needs an application-controlled path to recover one customer's library without rolling every customer backward.

## Alpha recovery machinery that becomes redundant

After the Azure production cutover is complete **and a real Azure PITR restore has succeeded**, retire alpha-only provider work such as:

- Neon-specific snapshot/manual-restore handling;
- Neon/control-plane provider-level dump jobs that exist only to compensate for Free-plan infrastructure recovery limits;
- provider-outage reconstruction glue specific to Neon Free.

Do **not** retire:

- the #400 customer backup scheduler and staged single-customer restore path;
- #399 portable exports;
- B2 object version/lifecycle protection.

## Migration trigger

Do not provision long-lived Azure production resources for alpha/free beta.

Start #435 when either:

1. Nostos is preparing for public paid launch and has roughly **10 committed paying users / €100 MRR** worth of demand; or
2. Neon Free capacity, recovery, or operational constraints are expected to become a blocker within about **30 days**.

If Nostos promises production-grade reliability to paying customers earlier, finish the migration before making that promise.

The intent is to avoid paying a fixed infrastructure bill before the product has revenue while still moving before the alpha stack becomes an operational liability.

## Minimum sensible staging

Early staging should be logically isolated without duplicating the full monthly bill:

- separate staging App Service app on the **same B1 App Service plan**;
- separate staging control-plane/customer PostgreSQL databases on the **same Flexible Server**, using separate credentials;
- separate B2 staging bucket/key;
- Clerk development/staging configuration;
- Paddle sandbox/test configuration.

No staging resource may point at production customer data.

This shares compute/failure domains, which is acceptable at first paid-launch scale. Move staging to its own App Service plan and PostgreSQL server once load, migration risk, or MRR makes the shared blast radius unacceptable.

## Consequences

### Positive

- very small fixed production bill;
- provider-managed PostgreSQL PITR replaces alpha provider-backup glue;
- existing S3 storage implementation remains valid;
- 15 GB/user can be offered without reserving 15 GB/user;
- audiobook traffic avoids Azure's internet-egress economics;
- no Kubernetes/microservice work.

### Trade-offs

- production uses two infrastructure providers (Azure + Backblaze) plus Clerk/Paddle;
- B1/B1ms are intentionally small and must be monitored;
- initial staging shares Azure compute/failure domains with production;
- database-per-customer requires disciplined connection-pool and fleet-migration behavior.

## Revisit this ADR when

- B2 monthly media egress persistently exceeds 3x stored bytes;
- Azure PostgreSQL connection/fleet pressure makes database-per-customer materially painful;
- production needs zone-redundant HA/SLA beyond the initial low-cost tiers;
- staging load can materially affect production;
- public provider pricing changes enough to reverse the cost comparison.
