# SQLite and PostgreSQL schema lifecycle

Issue: #398

Nostos has **one domain model** and deliberately separate migration histories for
its two deployment databases.

```text
NostosDbContext
   |
   +-- SelfHosted / SQLite
   |     existing Nostos.Backend/Migrations/*
   |     DatabaseBootstrapService
   |
   +-- Cloud / PostgreSQL
         PostgresNostosDbContext (migration-only derived context)
         Cloud/Migrations/Postgres/*
         CloudTenantSchemaMigrator
```

Provider-specific migration artifacts are expected. Product/domain entities and
repositories are not forked by provider.

## SelfHosted / SQLite

Nothing about the established SelfHosted lifecycle changes.

- The ordinary runtime context remains `NostosDbContext` + SQLite.
- Existing SQLite migration files remain under `Nostos.Backend/Migrations`.
- `DatabaseBootstrapService` keeps the repository's historic fresh-database
  baseline behavior.
- Existing non-empty SQLite databases continue through ordinary
  `MigrateAsync`.
- Cloud code never rewrites or re-baselines a SelfHosted database.

## Cloud / PostgreSQL

PostgreSQL migrations use the migration-only
`PostgresNostosDbContext : NostosDbContext`.

It inherits the exact same EF model but has a distinct context type, so EF Core
does not mix PostgreSQL migrations with the historical SQLite migration set.

The first EF-generated migrations are:

```text
20260922170154_InitialCloudBaseline
20260922170207_EstablishCloudMigrationLifecycle
```

The second migration is intentionally empty. It establishes a real
post-baseline migration boundary so the repository can continuously test that
an already-versioned Cloud database advances through a pending migration
without manufacturing a product schema change.

`CloudCustomerSchema.CurrentVersion` is the exact latest EF migration id.

## Generating future PostgreSQL migrations

Generate Cloud migrations explicitly against the migration-only context:

```bash
dotnet ef migrations add <Name> \
  --project Nostos.Backend \
  --startup-project Nostos.Backend \
  --context PostgresNostosDbContext \
  --output-dir Cloud/Migrations/Postgres
```

Do not hand-invent migration timestamps or copy SQLite migrations into the
PostgreSQL history. After generation, update `CloudCustomerSchema.CurrentVersion`
to the exact generated migration id, decide whether the previous version stays
inside `IsApplicationCompatible`, and run the PostgreSQL migration lifecycle
suite before opening the PR.

## Fresh tenant initialization

New customer databases no longer use `EnsureCreated`.

Provisioning:

1. creates the isolated PostgreSQL database;
2. calls `CloudTenantSchemaMigrator` for that one account;
3. EF applies the PostgreSQL migration set;
4. Nostos seeds/verifies the LibraryState singleton;
5. the control plane records the exact current migration id;
6. only then does provisioning mark the account Ready/Active.

If migration fails, provisioning remains failed and retryable against the same
resource/database mapping.

## Adoption of #396 databases

Issue #396 briefly created PostgreSQL databases with `EnsureCreated` and wrote:

```text
current-model-v1
```

Those databases contain the current model but no EF migration history.

They are adopted conservatively:

- adoption is allowed only when the trusted control-plane row still says
  `current-model-v1`;
- the public table set must exactly match the #396 model table set;
- the public table/column shape must exactly match the shared EF relational model;
- Nostos creates EF's own history table and stamps only
  `20260922170154_InitialCloudBaseline`;
- ordinary EF migration then applies the lifecycle marker;
- customer rows are never recreated or copied;
- the control plane advances to the current migration id only after success.

An existing database with tables, no EF migration history, and no recognized
legacy marker fails closed as `schema_unversioned_database`.

A versioned tenant whose database has unexpectedly become empty also fails
closed. Nostos will not silently rebuild an empty library over possible data
loss.

## Existing Cloud upgrades

`CloudTenantSchemaMigrator` migrates exactly one customer database at a time.

For an existing tenant:

1. read the trusted account→database mapping;
2. verify compiled migration constants match the EF migration set;
3. reject unknown migration-history entries;
4. run EF `MigrateAsync`;
5. verify no migrations remain pending;
6. record the latest migration id in the control plane.

A failed upgrade records a bounded machine-readable schema failure code without
rewriting the last known `SchemaVersion`.

If that previous schema is still in the explicit compatibility window, the
tenant may continue operating and the migration can be retried. If it is no
longer compatible, the normal Cloud authorization/tenant factory fails closed.

## Bounded compatibility window

The application does not treat every historical schema as usable.

The first rollout deliberately accepts:

```text
current-model-v1
20260922170154_InitialCloudBaseline
20260922170207_EstablishCloudMigrationLifecycle
```

They have the same product-facing relational shape.

Future schema changes must explicitly decide whether the immediately previous
version remains safe. Old versions are removed from the compatibility set
rather than accumulating indefinitely.

## Fleet rollout

The ASP.NET web server **does not migrate every customer database at startup**.

Startup only verifies the small control-plane database. Customer migrations are
explicit per-tenant operations.

Production rollout should be staged:

1. CI runs the disposable PostgreSQL migration lifecycle suite;
2. deploy/migrate a disposable or staging tenant;
3. verify the application against that tenant;
4. migrate a bounded production batch;
5. inspect control-plane schema/failure state;
6. continue the next batch;
7. retry failed tenants individually.

#402 can automate that deployment/batch orchestration. #398 provides the
migration primitive and state semantics it must call.

## CI migration proof

The PostgreSQL workflow now exercises:

- fresh PostgreSQL customer DB → current migrations;
- #396 `EnsureCreated` DB with customer data → baseline adoption → current;
- baseline-only DB → pending migration → current, preserving data;
- unknown unversioned DB → fail closed + observable failure;
- existing tenant-isolation/provisioning coverage;
- the shared PostgreSQL model compatibility suite.

The normal backend regression suite continues to cover the SelfHosted SQLite
bootstrap/migration behavior.
