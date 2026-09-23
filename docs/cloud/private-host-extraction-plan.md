# Nostos Cloud private-host extraction plan

- **Tracking:** #438
- **Phase:** Wave 0 complete; Wave 1 implemented by #459 pending final CI
- **Hardened extraction baseline:** `e20df0daf352cb94bec9867dbe3b78c64678f83b` (PR #458 / #408)
- **Prerequisite:** #408 is merged; cross-repository extraction still waits for #459 to merge green
- **Non-goal:** #435 infrastructure migration
- **Architecture:** `docs/adr/cloud-public-private-boundary.md`
- **Inventory:** `docs/cloud/public-private-boundary-inventory.md`

This plan deliberately separates **public seam preparation** from **cross-repository extraction**. Moving files first would force the private host to copy product code or make public Nostos depend on private code.

## Operating rules for every wave

1. Public Nostos remains the canonical product/domain/frontend source.
2. Dependency direction is private -> public only.
3. No production secrets enter either repository.
4. No separate customer frontend.
5. No copied Library/Brain/Reader/Studio/domain implementation.
6. No permanent source-sync scripts.
7. No extraction from a pre-#408 version of a file marked WAIT #408.
8. #399 portability remains public and working at every step.
9. #435 remains deferred; repository extraction must not quietly migrate production infrastructure.
10. A wave is not complete until its rollback point is explicit and its required CI is green.

## Wave 0 — finish #408, reconcile and freeze the extraction baseline

**Status:** complete in #459.

**Repository:** public `Nostos-Rebirth`

**Extraction baseline:** `e20df0daf352cb94bec9867dbe3b78c64678f83b` (PR #458).

### Work

- record the #408 merge SHA as the extraction baseline;
- diff #408 against the Phase 1 inventory;
- update paths/classifications for anything renamed/split;
- re-read:
  - auth/tenant context;
  - control plane/account lifecycle;
  - PostgreSQL provisioning/migrations;
  - S3/B2 storage;
  - recovery cleanup;
  - worker leases/schedulers;
  - health/observability;
  - managed-AI usage/rate-limit paths;
  - Cloud API surface and staging smoke;
- explicitly verify HSTS/provisioning-response decisions landed as intended;
- declare a short hosted-code migration freeze: no discretionary Cloud feature work until the private host reaches parity. Security/correctness fixes are allowed but must be incorporated into the extraction baseline.

### Validation

- PR #458's Dual-mode CI was green at the hardened source before extraction work began;
- the inventory was reconciled against the #408 changed-file set and new privacy-lifecycle paths;
- #459 preserves the hardened auth/tenant, deletion, HSTS/rate-limit, upload, recovery, redaction and staging/release semantics behind the new composition seam;
- public SelfHosted and current Cloud remain behaviorally unchanged by design.

### Rollback

No cross-repository change exists yet. Revert only documentation if the architecture inventory needs correction.

## Wave 1 — introduce a reusable public product project

**Status:** implemented by #459 / PR #464; completion requires the full transitional CI matrix to remain green.

**Repository:** public `Nostos-Rebirth`

**Goal:** make common Nostos code consumable by a second executable without importing the current Web/Cloud composition root.

This is a behavior-preserving public refactor. Cloud is still implemented in the public repo during this wave.

### Wave 1A — data/domain and core contracts

Introduce a public reusable project (working name `Nostos.Product`) referenced by the existing `Nostos.Backend`.

Move or otherwise establish ownership there for:

- canonical `NostosDbContext`;
- data models/repository contracts and reusable repositories;
- `IBookAssetStorage`;
- portable archive interfaces/models/service;
- provider-neutral AI contracts;
- common assistant/application contracts required by both hosts;
- shared product abstractions that do not require SQLite, Npgsql, S3, Paddle or hosted auth.

Do **not** move:

- SQLite bootstrap/local backup implementation;
- Npgsql provider/migrations;
- S3 implementation;
- Paddle;
- hosted auth/control plane;
- managed-provider credentials/accounting.

### Wave 1B — common application/API composition

Move common product services/endpoints into the reusable public project where practical, or expose focused public extension methods that let both executables register/map them.

Desired shape:

- `AddNostosProduct(...)` — product/common services only;
- `MapNostosProductEndpoints(...)` — common product routes only;
- SelfHosted host adds local persistence/storage/BYOK/local backup;
- future private host adds hosted auth/persistence/storage/billing/managed AI around the same common product registration.

Avoid an abstraction named specifically for the private service. Public code should express product capabilities, not “load Nostos-Cloud”.

### Wave 1C — isolate mixed public/private files

Split the current mixed surfaces while retaining behavior:

- `ManagedAiAccessPolicy.cs`: public interface + SelfHosted implementation separate from Cloud policy;
- `ManagedAiUsage.cs`: keep public contracts/SelfHosted no-op separate from hosted accounting;
- `NostosHealthChecks.cs`: public/common/SelfHosted health separate from hosted dependency checks;
- `DataProtectionRegistration.cs`: public normal setup separate from hosted control-plane key repository;
- `DeploymentConfiguration.cs`: keep deployment capabilities public, remove any future requirement that public registration calls a private implementation;
- reduce direct Cloud type references in `Program.cs` behind composition extensions so later removal is mechanical.

### Validation

- `dotnet build Nostos.sln`;
- ordinary public backend tests;
- SelfHosted/SQLite integration;
- current Cloud/PostgreSQL/object-storage/recovery integrations still green;
- Angular check/test/build;
- portable archive tests;
- no runtime behavior/API contract change intended.

### Rollback

Each sub-wave is a normal public refactor PR. Revert it independently if composition behavior changes. No private repository is required to keep production running.

## Wave 2 — bootstrap the private repository with a pinned public dependency

**Repository:** future private `Christian-Gennari/Nostos-Cloud`

**Prerequisites:** Wave 1 reusable public product boundary is merged and green.

This is the first point at which the private repository needs to exist.

### Initial structure

Suggested:

```text
Nostos-Cloud/
  upstream/Nostos-Rebirth/        # Git submodule pinned to a public commit
  src/Nostos.Cloud.Hosting/
  src/Nostos.Cloud.Host/
  tests/
  docs/
  .github/workflows/
```

### Work

- add public `Nostos-Rebirth` as a Git submodule;
- pin an exact public SHA;
- create private hosting library/executable skeletons;
- add direct project references to the public `Nostos.Product` / `Nostos.Shared`;
- make private CI initialize the submodule explicitly;
- prove the private solution can build against the pinned public source;
- configure the private host build to invoke the public Angular build from the same submodule revision;
- add release metadata fields for both public and private SHAs.

Do **not** copy hosted production source yet if the skeleton cannot consume public product code cleanly.

### Validation

- private clean clone + submodule initialization succeeds;
- private solution builds with no source-copy step;
- public repo remains completely buildable without credentials/access to private repo;
- public SHA is visible in build metadata.

### Rollback

Delete/revert only private bootstrap commits. Public product remains the current production implementation.

## Wave 3 — migrate hosted foundation from the post-#408 baseline

**Repository:** private `Nostos-Cloud`

**Source baseline:** exact hardened public SHA from Wave 0/updated through Wave 1.

This wave starts the temporary migration period where hosted-only code may exist in both repositories. Keep it short and do not add features to only one copy.

### Wave 3A — identity/control plane

Migrate hosted-only implementations:

- trusted Cloud account identity/context;
- Cloud account status;
- auth/OIDC policy/configuration;
- control-plane models/DbContext/store;
- hosted Data Protection key repository.

The private implementation must continue to derive account identity server-side and preserve all #408 lifecycle/security rules.

### Wave 3B — PostgreSQL tenant runtime

Migrate:

- customer connection factory;
- Cloud tenant `NostosDbContext` factory;
- migration-only PostgreSQL context;
- hosted PostgreSQL migration set;
- tenant schema migrator;
- provisioning;
- Cloud persistence/configuration registrations.

The private PostgreSQL context continues to inherit/use the public canonical model.

### Wave 3C — entitlements/onboarding foundation

Migrate:

- hosted subscription state/store;
- entitlements;
- onboarding service;
- hosted provisioning/onboarding endpoints where required for private-host integration tests.

### Validation

Private CI runs the same hardened categories currently represented by:

- Cloud authentication;
- provisioning security;
- PostgreSQL compatibility;
- schema migration;
- tenant isolation;
- entitlements/subscriptions;
- onboarding.

Also assert the private project references public product projects, not a copied domain model.

### Rollback

The current public Cloud remains authoritative during Wave 3. If the private implementation diverges, revert private migration commits and re-import from the exact hardened baseline. Do not patch both copies independently unless it is an urgent security fix.

## Wave 4 — migrate hosted provider adapters and commercial operations

**Repository:** private `Nostos-Cloud`

### Wave 4A — billing

Migrate:

- Cloud billing state;
- Paddle options/adapter/API/webhook verification;
- billing reconciliation worker;
- hosted billing endpoints/registration.

No Paddle secret/value is committed.

### Wave 4B — managed AI

Migrate:

- hosted provider settings;
- Vercel AI Gateway managed LLM adapter;
- Groq managed STT adapter;
- Cloud AI pricing epochs;
- usage/reservation models;
- commercial allowance/global budget implementation;
- hosted managed-AI usage endpoint/configuration.

The public assistant orchestration, LLM/STT interfaces and SelfHosted BYOK implementation remain public.

### Validation

- billing webhook/reconciliation tests;
- entitlement integration;
- managed LLM tool-calling regression;
- STT regression;
- usage reservation/accounting/budget tests;
- secret/error-redaction assertions from #408.

### Rollback

Public Cloud remains deployable until private parity is complete. Revert private adapter migrations without affecting public users.

## Wave 5 — migrate storage, recovery and fleet operations

**Repository:** private `Nostos-Cloud`

### Wave 5A — object storage

Migrate:

- S3/B2 `IBookAssetStorage` implementation;
- hosted object-storage options/bootstrap/registration;
- any post-#408 authorized direct-media implementation.

Keep `IBookAssetStorage` public.

### Wave 5B — operational recovery

Migrate from the hardened #408 version:

- recovery models/service;
- recovery control-plane switch;
- recovery resource manager;
- S3 recovery store;
- backup sweep;
- scheduled backup worker;
- superseded-resource cleanup/reconciliation introduced by #408.

Keep `IPortableArchiveService` public and call it from the private recovery layer.

### Wave 5C — runtime/health

Migrate:

- Cloud worker lease implementation;
- hosted readiness checks;
- hosted scheduler composition;
- hosted-only operational endpoints.

### Validation

- object-storage tenant-isolation integration;
- authorized media-delivery security tests if present;
- recovery integration including successful/failed staged restore;
- cleanup lifecycle tests from #408;
- scheduled worker/lease tests;
- readiness dependency-failure tests;
- cross-deployment portability test using the pinned public archive implementation.

### Rollback

Public Cloud is still the fallback. Do not remove public recovery/storage code until private staging has restored a real disposable tenant fixture end-to-end.

## Wave 6 — assemble the private Cloud host and reach staging parity

**Repository:** private `Nostos-Cloud`

### Work

Compose one official hosted executable:

- public product registrations/endpoints;
- private authentication;
- private PostgreSQL tenant persistence;
- private S3/B2 media;
- private entitlements/billing;
- private managed AI;
- private recovery/workers;
- private Cloud-only endpoints;
- public Angular frontend from the pinned submodule.

Recreate hosted middleware/security behavior from the hardened public composition, including:

- forwarded headers/proxy behavior;
- HSTS/security headers;
- authentication/authorization order;
- upload/request limits;
- health endpoints;
- error redaction;
- deployment capability response.

Move/copy as **hosted operational assets**, not product source:

- Cloud staging smoke;
- hosted release workflow;
- PostgreSQL/S3/recovery integration workflows;
- production deployment/runbooks.

### Current infrastructure constraint

This wave does **not** implement #435.

Use the currently supported alpha/staging provider shape while proving repository parity. A later #435 project may change DigitalOcean/Neon production resources independently.

### Parity gate

Before the private host becomes authoritative, prove:

- sign-up/sign-in/session;
- subscription/onboarding/provisioning;
- tenant isolation;
- Library CRUD and media;
- Brain/notes;
- Reader access;
- Studio/writings;
- Ask Nostos managed LLM;
- voice transcription;
- Settings capability behavior;
- portable SelfHosted -> Cloud import;
- portable Cloud -> SelfHosted export/import;
- backup/recovery;
- health/readiness;
- production container build;
- staging smoke.

Record both public and private SHAs for the tested deployment.

### Rollback

Continue deploying the last hardened public Cloud image until the private host passes this gate. The private host is not production-authoritative merely because it compiles.

## Wave 7 — make private Cloud authoritative

**Repositories:** private first, then public cleanup

### Work

1. deploy private host to isolated staging from the parity-tested SHA pair;
2. complete final security smoke;
3. promote according to the normal release process;
4. keep the last public Cloud image/revision documented as a rollback artifact;
5. only after successful operation, start removal of hosted implementation from public main.

If production rollback is required, redeploy the last known-good hosted artifact; do not reintroduce public/private source coupling.

## Wave 8 — remove hosted implementation from public Nostos

**Repository:** public `Nostos-Rebirth`

This is the point where the temporary duplicate hosted implementation ends.

### Remove/move out of public build

- `Nostos.Backend/Cloud/**` hosted implementation;
- Cloud auth/tenant hosted implementation;
- Cloud-only configuration/registrations/endpoints;
- Npgsql/AWS/Paddle/managed-provider dependencies no longer needed by public code;
- hosted release/staging/ops workflows/scripts;
- private-only hosted tests.

### Keep public

- public `Nostos.Product`;
- canonical model/domain;
- SelfHosted executable;
- SQLite/local media/local backup;
- BYOK;
- portability;
- product/capability contracts;
- public frontend including Cloud-entry/browser client contracts needed by official Cloud;
- generic Docker/SelfHosted packaging;
- public documentation/history appropriate to the product.

### Required public acceptance test

From a completely fresh public clone with no private credentials/access:

- restore/build succeeds;
- SelfHosted starts;
- SQLite database bootstraps;
- local media works;
- local backup/restore works;
- Library / Brain / Reader / Studio work;
- BYOK Ask Nostos remains configurable;
- portable export/import works;
- frontend builds;
- no reference to a private Nostos package/repo is required.

### Rollback

If public cleanup accidentally removes a product contract or breaks SelfHosted, revert the cleanup PR. Private Cloud remains pinned to the previously tested public SHA until a corrected public release is available.

## Wave 9 — enforce the boundary

Add cheap guardrails after the split is stable.

### Public repository

- CI check: no `ProjectReference`, package or source path containing private `Nostos.Cloud` dependency;
- public solution must build in an environment with no GitHub private-repo credentials;
- SelfHosted integration remains required;
- portable archive compatibility tests remain required.

### Private repository

- submodule must be pinned to a commit, never floating branch content;
- build/release metadata must include public SHA;
- CI initializes public submodule from the recorded pointer;
- no public product source is committed outside the submodule;
- hosted code changes that need reusable product behavior are made upstream in public first.

## Suggested PR granularity

Avoid one giant extraction PR. A reasonable sequence after #408:

1. public: introduce `Nostos.Product` data/contracts;
2. public: move common services/API composition;
3. public: split mixed Cloud/SelfHosted files;
4. private: repo/submodule/solution skeleton;
5. private: identity + control plane;
6. private: PostgreSQL + migrations + provisioning;
7. private: entitlements + onboarding;
8. private: billing;
9. private: managed AI;
10. private: object storage;
11. private: recovery + workers + health;
12. private: Cloud host + CI/staging parity;
13. public: remove hosted implementation/dependencies;
14. both: boundary guards/docs.

If a step becomes too large, split by dependency direction rather than by arbitrary file count.

## Conflict map with #408

Do not start extraction PRs against any of these areas until #408 has merged:

- auth/tenant security;
- control-plane/account lifecycle;
- PostgreSQL connection/provisioning/migration;
- S3/B2 tenant storage and direct delivery;
- Cloud recovery/cleanup;
- schedulers/leases;
- production health/observability/security middleware;
- managed-AI usage/rate limits;
- Cloud API response minimization;
- Cloud CI/staging smoke.

Public product refactors after #408 should preserve the hardened semantics exactly before moving them across repositories.

## Relationship to #435

#435 is a future production-infrastructure migration trigger/plan. This extraction should not:

- move customer data between database providers;
- change B2 buckets/regions;
- switch production compute;
- change backup/PITR provider policy;
- otherwise use repository restructuring as an excuse to perform infrastructure migration.

The private host can later implement #435 with substantially less public-repo churn because production operations will already have the correct ownership boundary.

## Completion criteria for #438

Phase 1 completion is **not** issue completion.

#438 should close only after:

- reusable public product boundary exists;
- future private repo exists;
- official hosted implementation has been extracted;
- private host consumes a pinned public revision;
- one public Angular frontend is used;
- public SelfHosted fresh clone passes the acceptance test;
- private hosted CI/staging passes parity/security tests;
- public repo has no private dependency;
- permanent duplicate hosted/product source has been removed;
- documentation/CI guardrails describe and enforce the final boundary.

Until then, PRs should reference #438 without `Closes #438`.
