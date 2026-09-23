# ADR: Public Nostos core and private hosted-service boundary

- **Status:** Accepted for Phase 1 architecture; production extraction deferred
- **Decision date:** 2026-09-23
- **Tracking:** #438
- **Coordinates with:** #258, #408, #435
- **Inventory:** `docs/cloud/public-private-boundary-inventory.md`

## Decision summary

Nostos remains **one product**.

The canonical product, domain model, customer frontend, SelfHosted implementation, provider-neutral storage/AI/portability contracts and portable customer data format stay public in `Christian-Gennari/Nostos-Rebirth`.

A future private `Christian-Gennari/Nostos-Cloud` repository may own only the official hosted-service composition and operations: commercial billing, hosted identity policy, account/resource control plane, PostgreSQL fleet provisioning/migrations, S3/B2 tenant implementation, hosted recovery/operators, managed provider credentials/accounting and hosted CI/CD.

The dependency direction is one-way:

```text
future private Nostos-Cloud
        |
        v
public Nostos product/core
```

The public repository never imports a private package, source tree, generated artifact or build secret.

Before any hosted source is removed from the public repository, the public backend must gain a reusable product project/composition seam so the private host can consume the same implementation rather than copy it.

For a solo maintainer, the initial cross-repository dependency mechanism should be a **pinned Git submodule from the private repository to the public repository**, with direct project references to public product projects and the public Angular source built from that same pinned revision. Do **not** introduce NuGet/GitHub Packages for the initial extraction.

No private repository is created and no production code is moved by this ADR.

## 1. Motivation

The current Cloud alpha was intentionally built inside the public Nostos repository to establish the product boundary quickly. That succeeded:

- SelfHosted and Cloud use the same domain model;
- both use the same Angular application;
- the canonical EF model is `NostosDbContext`;
- storage is already abstracted behind `IBookAssetStorage`;
- AI orchestration already consumes provider interfaces;
- #399 portability is provider-independent;
- hosted PostgreSQL reuses the public EF model instead of maintaining a second schema;
- capability-driven UI already lets one frontend adapt at runtime.

The remaining problem is repository ownership, not product identity.

Official hosted-service implementation contains commercial/provider/operator concerns that do not need to be part of the public SelfHosted distribution: Paddle integration, operator-managed provider credentials and budgets, production tenant provisioning, control-plane state, fleet jobs and deployment operations.

Moving those concerns can reduce public hosted-service surface **only if** the split does not create a Cloud fork or make public Nostos depend on private code.

## 2. Public/private boundary

### Public: product and reusable core

Public means code necessary to define or run Nostos as a product, independent of who hosts it:

- Library, Brain, Reader, Studio and shared product behavior;
- domain/data models and repositories;
- canonical `NostosDbContext`;
- `Nostos.Shared` DTOs/enums;
- deployment mode/capability contracts;
- common HTTP/API behavior;
- SQLite SelfHosted persistence;
- local filesystem media;
- local backup/restore;
- provider-neutral media contract `IBookAssetStorage`;
- provider-neutral AI contracts such as `ILlmProvider`, `ISTtProvider`, provider configuration seams and assistant orchestration;
- SelfHosted/BYOK provider settings and providers;
- portable import/export and its archive format;
- generic recovery/export contracts where they are truly provider-neutral;
- one Angular customer frontend, including capability-gated hosted entry/settings UX;
- documentation and tests for the public product contract.

### Private: official hosted-service implementation

Private may own implementation specific to operating Nostos Cloud as a commercial service:

- Paddle-specific billing and reconciliation;
- Nostos-host subscription/entitlement enforcement;
- hosted account/resource control plane;
- official hosted authentication policy/provider configuration;
- PostgreSQL customer-database allocation, fleet migration and provisioning operations;
- S3/B2 tenant namespace implementation and hosted direct-delivery signing;
- operational Cloud recovery stores, staged resource switching and fleet backup jobs;
- worker leases/schedulers;
- official managed-AI transports, operator provider credentials, commercial usage accounting and global budgets;
- hosted-only operator/admin endpoints and future operator UI;
- DigitalOcean/other production deployment operations;
- private staging/release/incident runbooks and hosted CI.

### Boundary-sensitive

A component is not private simply because its filename contains `Cloud`.

Examples:

- `DeploymentCapabilities` stays public because the shared frontend needs a product-level capability contract.
- `NostosDbContext` stays public even though Cloud runs it on PostgreSQL.
- `IBookAssetStorage` stays public while `S3BookAssetStorage` can become private.
- `IManagedAiUsageService` can stay public while the commercial reservation/accounting implementation becomes private.
- browser-visible Cloud onboarding/auth DTOs can stay public because they are part of one frontend and contain no privileged implementation.
- `NostosHealthChecks.cs` must be split because it currently mixes public SelfHosted and private hosted readiness checks.
- `Program.cs` must be decomposed because it currently composes both products and hosted infrastructure.

The inventory is the authoritative file-by-file classification.

## 3. Dependency direction

The invariant is:

> Private hosted composition may depend on public Nostos. Public Nostos may never depend on the private hosted layer.

That means the following are forbidden:

- a public `ProjectReference` to `Nostos.Cloud.*`;
- a public NuGet/npm dependency published only from the private repository;
- a public build step that clones private source;
- a public CI secret/token whose only purpose is accessing private Cloud code;
- a generated public source bundle copied from private code;
- a runtime plugin that SelfHosted must obtain from a private registry merely to start;
- conditional compilation where the public build succeeds only if private files are present.

A fresh public clone must build and run SelfHosted with no private access.

## 4. What absolutely remains public

The following are architectural commitments, not implementation suggestions:

1. **Canonical product/domain model.** There will be one Library/Brain/Reader/Studio domain, one canonical relational model and one set of application services.
2. **SelfHosted runtime.** SQLite, local media, local backup/restore and BYOK Ask Nostos continue to work from a fresh public clone.
3. **Portable data ownership.** #399 import/export, archive format and provider-neutral portability implementation remain public.
4. **Provider-neutral contracts.** Storage and AI seams needed by common product code remain public.
5. **Single customer frontend.** Angular remains in the public repository. Official Cloud uses the same source revision.
6. **Capability contract.** Product-level deployment/capability DTOs remain public so frontend behavior does not depend on provider names/hostnames.
7. **Common product API behavior.** The official Cloud host composes the same product services/endpoints rather than reimplementing them.
8. **Tests for public invariants.** Public CI proves SelfHosted and public portability without private source.

## 5. What may become private

After #408 and the public composition refactor, the following responsibilities can move:

- hosted auth/session/account-state implementation;
- tenant identity/resource lookup;
- control-plane database/models/stores;
- Npgsql customer DB connection allocation;
- hosted PostgreSQL migrations/fleet migrator;
- provisioning;
- hosted subscription/entitlement state;
- Paddle adapter/webhooks/workers;
- managed Cloud LLM/STT provider glue;
- hosted provider pricing and managed usage/accounting;
- S3/B2 implementation;
- operational Cloud recovery and schedulers;
- hosted readiness checks;
- Cloud-only endpoints;
- hosted release/staging scripts/workflows.

Moving a responsibility private does not make its **public contract** private when common product code genuinely depends on that contract.

## 6. Frontend strategy

There will be **one customer frontend**: `Nostos.Frontend` in the public repository.

The existing approach is the correct direction:

- the backend reports server-authoritative deployment capabilities;
- the frontend uses those capabilities to show/hide SelfHosted-only controls;
- Cloud entry/auth/onboarding is an ordinary state in the same Angular application;
- provider secrets, tenant resource identifiers and operator internals stay server-side.

The future private host should build/serve the Angular source from the same pinned public revision as the public backend product code.

Do not create:

- `Nostos-Cloud-Frontend`;
- a copied Angular source tree;
- a private fork of Library/Brain/Reader/Studio;
- a second Settings implementation;
- per-host build flags that make product behavior diverge.

If future private operator tooling requires UI, it should be an operator/admin surface separate from the customer application.

## 7. Backend/project strategy

The current `Nostos.Backend` Web project mixes:

- common product/API implementation;
- SelfHosted infrastructure;
- official Cloud infrastructure;
- the top-level dual-mode composition root.

That is the main technical obstacle.

Before cross-repository extraction, introduce a reusable public product project. Working target:

```text
public Nostos-Rebirth

Nostos.Shared
      ^
      |
Nostos.Product                 <-- common domain/application/API + NostosDbContext
      ^
      |
Nostos.Backend                 <-- SelfHosted executable/composition
(SQLite, local files/backups,
 BYOK provider settings)

Nostos.Frontend                <-- one customer frontend
```

The exact namespace/file moves should be small behavior-preserving PRs after #408. The architectural requirements are:

- common product code can be referenced by another host;
- SelfHosted stays a first-class public executable;
- hosted provider packages are not required by the public SelfHosted executable after extraction;
- the public product library does not branch on private provider types.

Future private target:

```text
private Nostos-Cloud

upstream/Nostos-Rebirth        <-- pinned public Git submodule
src/Nostos.Cloud.Hosting       <-- hosted adapters/services
src/Nostos.Cloud.Host          <-- official Cloud executable/composition

Nostos.Cloud.Hosting --> upstream/.../Nostos.Product
Nostos.Cloud.Host    --> Nostos.Cloud.Hosting
Nostos.Cloud.Host    --> upstream/.../Nostos.Product
```

Cloud uses the canonical product implementation through project references; it does not copy it.

## 8. Dependency mechanism evaluation

### Option A — NuGet packages

**Pros**

- conventional .NET dependency/version model;
- reproducible restore;
- clean repository separation;
- strong API-boundary pressure.

**Cons for Nostos now**

- requires packageable public projects before extraction anyway;
- every coordinated frontend/backend change requires publishing/versioning packages;
- does not solve the Angular source/version problem by itself;
- adds release/package maintenance for one maintainer;
- local debugging across both repos becomes slower.

**Decision:** not the initial mechanism. Revisit if Nostos develops multiple independent consumers or a stable SDK release cadence.

### Option B — GitHub Packages

This is NuGet with an authenticated registry/repository workflow.

It adds token/permissions/configuration without solving the frontend coordination issue. It is higher maintenance than necessary for one private consumer.

**Decision:** do not use initially.

### Option C — pinned Git submodule from private -> public

**Pros**

- one public commit SHA pins backend product code **and** frontend source atomically;
- private CI is reproducible;
- public repository knows nothing about the private repository;
- no package publishing step;
- local debugging can cross project boundaries in one workspace;
- upgrading public Nostos is an explicit, reviewable submodule-pointer change;
- public history remains canonical.

**Cons**

- contributors must remember submodule initialization/update commands;
- branch switching can leave a detached/pinned submodule state, which is expected but unfamiliar;
- GitHub UI can be less convenient than package dependency views.

**Decision:** **recommended initial mechanism.**

The future private repo should pin the public repo under a path such as `upstream/Nostos-Rebirth`.

### Option D — CI/local script that clones public source by SHA

This preserves dependency direction and avoids submodule UX, but creates a custom source-resolution convention and makes local IDE/worktree coordination more manual.

**Decision:** acceptable fallback, but less explicit/reviewable than a committed submodule pointer.

### Option E — Git subtree

A subtree copies public source into private history and requires repeated pull/sync operations. That is too close to maintaining a second source copy and increases accidental divergence risk.

**Decision:** reject.

### Recommendation

Use **Git submodule + direct public project references** first.

Do not add a package registry until the maintenance cost is justified by additional consumers or release cadence.

## 9. Versioning and release strategy

The private repository must make the exact public revision visible in every build/deployment.

Initial version identity is a pair:

- `publicNostosSha` — pinned submodule commit;
- `cloudSha` — private hosted commit.

The hosted release manifest/image metadata should record both.

A normal upgrade is:

1. update the public submodule pointer in a private PR;
2. run public-product contract/build tests plus private hosted integration tests;
3. review any API/database/frontend changes together;
4. merge the pointer bump;
5. release the private host from the tested pair of SHAs.

This provides atomic-ish upgrades without a package publication train.

Public tags/releases continue to describe SelfHosted/public Nostos. Private hosted release identifiers may have their own cadence.

If stable public package APIs emerge later, semantic-versioned NuGet packages can replace some source project references without changing dependency direction.

## 10. CI implications

### Public CI

Public CI must require **zero** access to the private repository.

It should continue to prove:

- public solution restore/build;
- SelfHosted/SQLite runtime;
- local filesystem/media behavior;
- local backup/restore;
- public assistant/BYOK behavior;
- Angular build/tests;
- portable archive behavior;
- architecture rule that no public project references a private `Nostos.Cloud` dependency.

Cloud-specific PostgreSQL/S3/Paddle/managed-provider/fleet jobs leave public CI only when their implementation leaves the public repository.

### Private CI

Private CI checks out:

1. the private repository;
2. its pinned public submodule.

It then runs:

- public product project build/contract tests needed by the host;
- public frontend build;
- private hosted unit/integration tests;
- PostgreSQL tenant/provisioning/migration tests;
- S3/B2 adapter tests;
- auth/entitlement/billing tests;
- managed AI usage/provider tests;
- recovery tests;
- production-container/staging smoke.

The private repository owns production deployment credentials and environment integration.

Public CI must not be weakened merely because hosted tests move private; the equivalent private gate must exist before the public test/implementation is removed.

## 11. Local development workflow

For the solo-maintainer case:

1. clone the private repo with submodules initialized;
2. the pinned public checkout lives under `upstream/Nostos-Rebirth`;
3. open a workspace containing private host projects and public product/frontend;
4. debug `Nostos.Cloud.Host` with direct project references into the pinned public source;
5. make public product changes in a normal branch/worktree of the public repository;
6. test the private host against that public commit/branch locally;
7. merge public changes first when they are reusable product changes;
8. update the private submodule pointer after the public commit is available;
9. keep hosted-only changes exclusively in the private repo.

Do not edit the submodule as an untracked source copy and later “sync” files manually. Changes must land in their owning repository.

## 12. How private Cloud consumes public source

The private host consumes public source at build time:

- `ProjectReference` to public `Nostos.Product` / `Nostos.Shared`;
- public Angular build from the pinned submodule path;
- optionally public test fixtures/contracts intended for downstream hosts, if later formalized.

It does **not** consume:

- a copied public source directory committed into private history;
- generated source snapshots;
- a public binary that is built from a different revision than the frontend;
- a private plugin from the public executable.

The private host is the composition root for official Cloud. Public product code should not need to know that Paddle, Clerk, B2, DigitalOcean, Groq or Vercel are present.

## 13. Migration sequencing

No production extraction begins until #408 is merged.

The detailed wave plan is in `docs/cloud/private-host-extraction-plan.md`. The required ordering is:

1. **Phase 1 (this PR):** inventory + ADR + plan only.
2. **After #408:** reconcile inventory against hardened main.
3. **Public seam preparation:** create reusable public product project/composition boundaries while current Cloud still works in the public repo.
4. **Private repo bootstrap:** create private repo only when it can consume the public project boundary without copying product code.
5. **Hosted leaf extraction:** managed provider adapters/commercial/provider-specific leaf code.
6. **Hosted state/security extraction:** auth/control plane/entitlements/provisioning/PostgreSQL/storage/recovery from post-#408 source.
7. **Private Cloud host becomes authoritative:** run complete staging parity and release checks.
8. **Public cleanup:** remove hosted provider packages/workflows only after the private host proves equivalent behavior.
9. **Guardrails:** enforce public-no-private-dependency and private-pins-public-sha rules.

Each wave should be independently reviewable and reversible.

## 14. Rollback strategy

The split must not require a single irreversible “big bang.”

Rules:

- keep the current public Cloud implementation operational until the private host has passed equivalent integration/staging checks;
- move hosted-only source in small concern-oriented waves;
- do not delete the public implementation in the same moment the private infrastructure is first invented;
- when a hosted file is migrated, temporary duplication is allowed only as a short-lived migration state between coordinated PRs — never as a maintained fork;
- record source provenance/old public commit in private migration commits;
- if a private wave fails, revert the private commit/submodule pointer and continue using the last known-good public Cloud version;
- do not rewrite public Git history to hide previously public source;
- do not change customer archive formats during repository extraction unless a separate migration issue explicitly requires it;
- preserve #399 portability as the escape hatch between SelfHosted and Cloud.

A failed extraction wave must not make a public SelfHosted clone unusable.

## 15. Security implications

Repository privacy is **not** a security boundary for credentials.

Regardless of repository:

- no production keys/secrets are committed;
- provider credentials remain environment/secret-manager supplied;
- tenant identity is derived only from validated server-side auth context;
- object keys/namespaces are server-authoritative;
- public browser contracts contain no provider credentials/control-plane identifiers;
- logging/error responses do not disclose secrets or unnecessary infrastructure details;
- production and staging credentials/resources remain isolated;
- destructive account/resource lifecycle is auditable.

### #408 coordination

#408 is the security/privacy/operability baseline for the current implementation. It is actively changing or likely to change:

- Cloud auth and trusted tenant identity;
- account Disabled/Deleted lifecycle;
- control-plane state;
- tenant PostgreSQL connection/resource handling;
- provisioning and low-level provisioning API exposure;
- S3/B2 namespace isolation and future authorized direct delivery;
- Cloud recovery cleanup/lifecycle;
- worker/scheduler behavior;
- HSTS and middleware/security headers;
- rate/upload limits;
- secret/error redaction;
- dependency readiness/observability;
- managed-AI cost/usage/rate surfaces;
- Cloud CI/staging smoke.

Therefore those modules are explicitly **do not extract until #408 merged**.

The extraction session must start from the hardened versions, not from a pre-#408 commit copied into private history.

## 16. Licensing implications

This ADR chooses a **technical** repository/dependency boundary. It does not claim that the resulting private/public combination satisfies any desired licensing model.

Current repository evidence:

- `LICENSE` is GNU GPL v3 text with a 2026 Christian Gennari copyright notice;
- Backend and Shared projects declare `GPL-3.0-or-later`;
- Git history contains 26 commits from `discovicke`; maintainer clarification identifies him as Christian's friend who helped with styling/product UI work;
- the two commits authored as `t` are, per maintainer clarification, from an AI coding agent used under Christian's direction rather than an unidentified human contributor;
- no CLA, DCO, contributor assignment file or `.mailmap` was found in the repository.

Consequences for planning:

- do not change `LICENSE` in this phase;
- do not infer relicensing rights for surviving third-party styling contributions solely from repository ownership or commit metadata;
- do not assume a private host that project-references/builds GPL public code has no licensing obligations;
- do not assume previously published GPL source can be made retroactively private;
- AGPL is a possible future decision, not an outcome of this ADR.

Before relying commercially on the private/public licensing boundary, obtain actual legal advice on contributor rights, relicensing permissions and the obligations of the chosen build/deployment/distribution model.

The contributor/provenance evidence and specific legal questions are recorded in the inventory.

## Consequences

### Positive

- preserves one Nostos product and one frontend;
- public SelfHosted remains complete and independent;
- official hosted-service internals can evolve privately;
- private Cloud upgrades public product through an explicit pinned revision;
- no package registry is required initially;
- Cloud continues to reuse canonical product/domain code;
- public CI never needs access to private source.

### Costs

- requires a real public project/composition refactor before extraction;
- cross-repository changes require disciplined two-PR sequencing;
- submodule workflow adds some Git friction;
- private CI must duplicate **testing responsibility**, not product source;
- licensing questions must be resolved before the technical boundary is treated as a proprietary licensing boundary.

## Rejected designs

### Private package imported by the public app

Rejected because it reverses the required dependency direction and makes SelfHosted/public builds depend on private access.

### Separate Cloud frontend

Rejected because it guarantees product/UI drift and creates two products.

### Copy the public backend/domain into the private repository

Rejected because it forks the domain model and application behavior.

### Permanent source-sync script

Rejected because it institutionalizes duplication and creates hidden divergence.

### Git subtree

Rejected for the same source-copy/drift reasons.

### NuGet/GitHub Packages immediately

Rejected as unnecessary maintenance for one private consumer and because it does not solve synchronized frontend source.

### Move `Cloud/**` wholesale

Rejected because the actual boundary does not match folder names: public capability/contracts and shared code exist outside and inside current Cloud-adjacent areas, while mixed files such as `Program.cs`, health and managed-AI policies need to be split first.

## Validation of this ADR

This Phase 1 decision was derived from the current `main` tree and actual project/source dependencies, including:

- `Nostos.sln` and all project references;
- Backend package references and Release frontend build;
- composition in `Program.cs`;
- deployment/persistence registration;
- canonical `NostosDbContext`;
- storage and AI interfaces/implementations;
- control plane, provisioning, PostgreSQL migrations, billing, entitlements, managed AI, object storage and recovery;
- shared Angular capability/auth/onboarding/Settings paths;
- Cloud/SelfHosted CI workflows;
- #258, #408, #435 and #438;
- repository license and complete visible Git commit-author inventory.

Runtime behavior is intentionally unchanged.
