# PostgreSQL compatibility spike

Issue: #393  
Date: 2026-09-22

## Decision

**Proceed with one shared `NostosDbContext` / domain model for SelfHosted SQLite and Nostos Cloud PostgreSQL.**

The real current model and representative workflows run successfully against PostgreSQL 18.6 through the Npgsql EF Core provider after one small provider-neutral model correction: singleton CHECK constraints must quote EF's case-sensitive column identifiers.

No evidence from this spike justifies a second repository layer or a PostgreSQL-specific copy of the Nostos domain model.

## Test environment

The dedicated compatibility workflow runs:

- .NET 10
- EF Core 10.0.0 (the version currently pinned by Nostos)
- Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0
- PostgreSQL 18.6
- the real `NostosDbContext`

Npgsql 10.0.0 is intentional for the spike because it accepts EF Core >=10.0.0. Newer stable Npgsql patch releases should be adopted together with the corresponding EF Core patch upgrade rather than silently changing the application's EF dependency during this evidence-gathering issue.

## What was exercised on real PostgreSQL

The integration test creates the current EF model with PostgreSQL and exercises:

- PostgreSQL connection and schema creation from the real model;
- PostgreSQL-native `uuid` and `timestamp with time zone` mappings;
- TPH `BookModel` inheritance:
  - `PhysicalBookModel`
  - `EBookModel`
  - `AudioBookModel`;
- automatic `Work` assignment/reuse from `NostosDbContext.SaveChangesAsync`;
- GUID round trips;
- UTC `DateTime` and nullable UTC `DateTime` round trips;
- owned `BookMetadata`, `ReadingProgress`, and file/progress columns;
- Book -> Work relationships;
- Book <-> Collection membership;
- Note <-> Concept many-to-many relationships;
- Writing parent/child relationships and cascade delete;
- Library and Note command receipts;
- singleton library state;
- filtered unique ISBN/ASIN indexes;
- multiple NULL values through those filtered unique indexes;
- restrictive collection FK behavior;
- real PostgreSQL transactions and rollback;
- representative LINQ translation including `Contains`, `Include`, `OfType`, filtering, ordering and aggregate queries.

The generated PostgreSQL create script is also asserted to contain the expected filtered indexes and check constraints, and `EnsureCreatedAsync` executes that generated schema against PostgreSQL rather than only inspecting SQL text.

## Compatibility defect found and fixed

The original model used these singleton CHECK expressions:

```text
Id = 1
SingletonSlot = 1
```

SQLite treats those identifiers case-insensitively, but PostgreSQL folds unquoted identifiers to lowercase. EF creates quoted mixed-case columns such as `"Id"`, so PostgreSQL attempted to resolve `Id` as `id` and rejected the schema.

The shared model now uses:

```text
"Id" = 1
"SingletonSlot" = 1
```

for:

- `CK_AiProviderSettings_SingletonId`
- `CK_AssistantSettings_SingletonId`
- `CK_LibraryStates_SingletonSlot`

This is valid on both SQLite and PostgreSQL. The EF model snapshot is updated to the equivalent quoted expressions so the next SQLite migration does not see a false model drift.

## What should *not* be shared unchanged

### Migration history

The current migration snapshot/history was generated for SQLite and is not the Cloud migration strategy.

Examples in the current history include:

- explicit SQLite store types such as `TEXT` and `INTEGER`;
- migrations whose operations were generated against the SQLite snapshot;
- hand-written migration SQL for historical SQLite transitions;
- the destructive collection-column guard whose comments and implementation explicitly target SQLite limitations.

The first retained migration also assumes a pre-existing legacy schema; the repository intentionally has no initial baseline migration. That is why `DatabaseBootstrapService` has a special fresh-SQLite bootstrap path today.

**Conclusion:** #398 should establish a PostgreSQL-specific baseline/migration history while preserving the current SQLite history. The domain model should remain shared.

Do not point Npgsql at the existing SQLite migration chain and call that Cloud schema management.

### Database bootstrap

`DatabaseBootstrapService` is explicitly designed around the current SelfHosted SQLite lifecycle and its missing initial baseline migration.

The spike proves PostgreSQL can create the current model cleanly. It does **not** recommend stamping the SQLite migration history into Cloud databases as the long-term production lifecycle.

Cloud provisioning should use the PostgreSQL migration/baseline strategy defined by #398 and provisioning orchestration from #396.

### Backup/restore

`BackupService` is explicitly SQLite/file-oriented today. It uses behavior including:

- `VACUUM INTO`;
- `Microsoft.Data.Sqlite.SqliteException`;
- SQLite pool clearing;
- physical `nostos.db` replacement semantics.

That remains correct for SelfHosted and should not be generalized into PostgreSQL backup logic. Cloud backup/recovery belongs to #400.

## Package-version note

The current application pins Microsoft EF Core packages at 10.0.0.

For the spike, `Npgsql.EntityFrameworkCore.PostgreSQL` is therefore pinned to 10.0.0 as well. Later Npgsql 10.x patch releases raise their minimum EF Core patch dependency.

Before production Cloud work, upgrade EF Core and Npgsql patch versions **together**, run the SQLite suite, then rerun this PostgreSQL compatibility test. Do not independently float one provider package.

## Recommendation for next issues

### #394 — deployment mode / composition

Proceed.

Centralize:

```text
SelfHosted -> UseSqlite(...)
Cloud      -> UseNpgsql(...)
```

without branching domain/repository code.

### #398 — schema and migration lifecycle

Treat this as required architecture, not cleanup.

Recommended direction:

- retain the existing SQLite migrations for SelfHosted;
- create a PostgreSQL-specific initial baseline/current-schema history;
- keep both histories tied to the same `NostosDbContext` model;
- validate future schema changes against both providers;
- do not migrate every customer database synchronously during API startup.

### #396 — tenant provisioning

Can rely on PostgreSQL as technically viable, but should provision via the #398 PostgreSQL schema lifecycle rather than `EnsureCreated` in production.

## Final assessment

The spike found **a migration/lifecycle boundary, not a persistence-model boundary**.

That is the desirable result:

```text
shared:
  entities
  NostosDbContext
  repositories
  domain services
  API behavior

provider-specific:
  UseSqlite / UseNpgsql composition
  migration history
  bootstrap/provisioning
  backup/restore
```

Nostos does not need a PostgreSQL rewrite to become Nostos Cloud.
