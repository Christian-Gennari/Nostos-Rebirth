# Nostos Cloud public/private boundary inventory

- **Tracking:** #438, Phase 1
- **Inventory base:** `main` at `b8e94be405294ea4245030ed006b179e0c763927`
- **Date:** 2026-09-23
- **Scope:** architecture classification only; no production code is moved by this document
- **Coordination:** #408 is active in parallel. Every row marked **WAIT #408** must be re-read from the post-#408 version before extraction.

## Classification key

| Class | Meaning |
| --- | --- |
| **A — Public product/core** | Canonical Nostos product, provider-neutral contracts, SelfHosted implementation, or the single shared frontend. Remains in `Christian-Gennari/Nostos-Rebirth`. |
| **B — Private hosted-service candidate** | Official Nostos Cloud implementation or operations that can move to future private `Christian-Gennari/Nostos-Cloud` after the public composition seam exists. |
| **C — Boundary-sensitive** | Mixed public/private responsibilities or a contract whose final placement depends on separating product behavior from hosted composition. Split before extraction; do not move the file wholesale just because its name contains “Cloud”. |

The target dependency direction is always:

`Nostos-Cloud (private) -> Nostos public product/core`

The public repository must never reference a private project, package, repository, or build artifact.

## Target public shape

Phase 1 does not create these projects, but the extraction plan assumes the public repository will eventually expose a reusable product boundary (working name `Nostos.Product`) while keeping `Nostos.Backend` as the fully runnable SelfHosted host:

- `Nostos.Shared` — shared DTOs/enums;
- `Nostos.Product` — canonical domain/application/API code, `NostosDbContext`, provider-neutral storage/AI/portability contracts and common implementation;
- `Nostos.Backend` — public SelfHosted composition, SQLite, local filesystem, local backup/restore and BYOK provider setup;
- `Nostos.Frontend` — the one Angular customer frontend used by both SelfHosted and official Cloud.

The exact project move is a later public-repo refactor. Until it exists, the “target home” below names the responsibility rather than authorizing a file move.

## 1. Composition, deployment and canonical product data

| Current path | Project | Class | Rationale / important dependencies | Current consumers | Target home | Extraction risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Program.cs` | Backend | **C** | Current dual-mode composition root directly wires Cloud auth, PostgreSQL, billing, managed AI, S3, recovery and Cloud endpoints. It also wires normal product services. This direct coupling must be broken before any private extraction. | Entire ASP.NET host | Split: public SelfHosted host + future private `Nostos.Cloud.Host`; common endpoint/service registration moves to public product library | **Very high** | **WAIT #408** — hardening is likely to touch middleware, limits, auth, health and endpoint mapping |
| `Nostos.Backend/Configuration/DeploymentConfiguration.cs` | Backend | **C** | `DeploymentMode`, `DeploymentCapabilities` and `DeploymentDescriptor` are product-level contracts. `AddNostosPersistence` currently calls the Cloud implementation directly, which would create a forbidden public -> private dependency after extraction. | Program, capability endpoint, Settings/frontend | Keep mode/capabilities public; move Cloud persistence composition out of this public registration path | **High** | Re-read after #408 if startup composition changes |
| `Nostos.Backend/Endpoints/DeploymentCapabilitiesEndpoints.cs` | Backend | **A** | Server-authoritative product capabilities let one frontend adapt without hostname/build flags or provider names. | Angular capability service | Public product/API | Low | No expected extraction conflict |
| `Nostos.Backend/Data/NostosDbContext.cs` | Backend | **A** | Canonical relational/domain model shared by SQLite and PostgreSQL. Duplicating it would create a Cloud fork. | Repositories, product services, SelfHosted DB, Cloud PostgreSQL migration context | Public product | **High if duplicated; low if retained** | #408 may exercise it but should not make it private |
| `Nostos.Backend/Data/Models/*` | Backend | **A** | Library/Brain/Reader/Studio/assistant data model is product domain, not hosted-service state. | NostosDbContext and product services | Public product | Low | No extraction |
| `Nostos.Backend/Data/Repositories/*` and `Data/Interfaces/*` | Backend | **A** | Product persistence behavior over canonical `NostosDbContext`. | Product services/endpoints | Public product | Medium during project split | No extraction |
| `Nostos.Backend/Data/DatabaseBootstrapService.cs` | Backend | **A** | Deliberately SQLite/SelfHosted lifecycle. A public clone must retain it. | SelfHosted startup | Public SelfHosted host/infrastructure | Low | No |
| `Nostos.Shared/**` | Shared | **A** | Existing shared DTO/enums project; already referenced one-way by Backend and tests. | Backend, clients/tests | Public | Low | No |
| `Nostos.Backend/Nostos.Backend.csproj` | Backend | **C** | Today contains both SQLite and hosted dependencies (Npgsql, AWS S3) and builds the Angular app in Release. The hosted dependencies should leave the public SelfHosted host only after common code is separated. | Build/CI | Public SelfHosted host after project split; Npgsql/AWS dependencies move with private implementation | **High** | Wait for #408 before dependency cleanup |
| `Nostos.sln` | repo | **C** | Current graph is Backend -> Shared and Tests -> Backend + Shared. It has no reusable product-library project yet. | Build/CI | Public solution gains reusable product project; never references private Cloud | Medium | No direct conflict |

### Current dependency graph

At the inventory base:

- `Nostos.Backend` -> `Nostos.Shared`;
- `Nostos.Backend.Tests` -> `Nostos.Backend` + `Nostos.Shared`;
- `Nostos.Shared` has no project references;
- Release builds of `Nostos.Backend` build `Nostos.Frontend` and copy its browser bundle to `wwwroot`.

This graph is simple, but the Backend project currently contains both product and hosted implementation. Phase 2 must create a reusable public product boundary before hosted files can leave the repository.

## 2. Public storage, backup and portability seams

| Current path | Project | Class | Rationale / dependencies | Current consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Services/IBookAssetStorage.cs` | Backend | **A** | Explicit provider-neutral media boundary; local filesystem and S3 already implement it. | Library/acquisition/reader/portability | Public product | Low | Contract may be extended later for authorized direct delivery, but keep public |
| `Nostos.Backend/Services/IFileStorageService.cs` | Backend | **A** | Local filesystem-specific public SelfHosted contract. | Backup/local services | Public SelfHosted | Low | No |
| `Nostos.Backend/Services/FileStorageService.cs` | Backend | **A** | Local filesystem implementation of both local and provider-neutral asset seams. | SelfHosted product | Public SelfHosted | Low | No |
| `Nostos.Backend/Services/IBackupService.cs` | Backend | **A** | Local backup UI/API contract. Cloud operational recovery is a different hosted implementation and should not replace this. | Backup endpoints/Settings | Public SelfHosted | Low | No |
| `Nostos.Backend/Services/BackupService.cs` | Backend | **A** | SQLite-file/local-filesystem backup/restore. Required by fresh SelfHosted clone. | Backup worker/endpoints | Public SelfHosted | Low | No |
| `Nostos.Backend/Services/Portability/IPortableArchiveService.cs` | Backend | **A** | #399 provider-independent customer-owned export/import contract. | Portability endpoints, Cloud recovery | Public product | Low | **Must remain public even after #408** |
| `Nostos.Backend/Services/Portability/PortableArchiveModels.cs` | Backend | **A** | Portable archive format/domain mapping; provider-independent. | PortableArchiveService | Public product | Low | No |
| `Nostos.Backend/Services/Portability/PortableArchiveService.cs` | Backend | **A** | Depends on canonical `NostosDbContext` + `IBookAssetStorage`, so the same implementation works against local or hosted storage. | SelfHosted export/import, Cloud onboarding/recovery | Public product | Medium during project split | No extraction |
| `Nostos.Backend/Endpoints/PortabilityEndpoints.cs` | Backend | **A** | Product-level export/import HTTP contract. | Shared frontend, customers | Public product/API | Low | May receive generic upload hardening from #408; still public |
| `Nostos.Frontend/src/app/core/services/portable-library.service.ts` | Frontend | **A** | Browser contract for the public portable format. | Cloud first-run + normal frontend | Public frontend | Low | No |

## 3. PostgreSQL, control plane, provisioning and migration lifecycle

| Current path | Project | Class | Rationale / dependencies | Consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Cloud/CloudCustomerConnectionFactory.cs` | Backend | **B** | Npgsql connection-string derivation for per-customer databases. | Provisioning, tenant DB, migration/recovery | Private hosted infrastructure | High | **WAIT #408** — connection-pool/resource hardening is in scope |
| `Nostos.Backend/Cloud/ControlPlane/CloudAccountResource.cs` | Backend | **B** | Hosted resource map: account -> database/storage/schema/provisioning state. Not product Library domain. | Control-plane store, provisioning, recovery | Private hosted control plane | **Very high** | **WAIT #408** — deletion/resource lifecycle and tenant isolation |
| `Nostos.Backend/Cloud/ControlPlane/CloudControlPlaneDbContext.cs` | Backend | **B** | Hosted operational/commercial database containing resources, subscriptions, billing and managed-AI usage. | Cloud stores/bootstrap | Private hosted control plane | **Very high** | **WAIT #408** |
| `Nostos.Backend/Cloud/ControlPlane/CloudControlPlaneStore.cs` | Backend | **B** | Account resource/status store; also implements Cloud account status used by auth. | Auth, provisioning, persistence, recovery | Private hosted control plane | **Very high** | **WAIT #408** |
| `Nostos.Backend/Cloud/ControlPlane/CloudDataProtectionKeyRepository.cs` | Backend | **B** | Hosted ASP.NET Data Protection key persistence/encryption against control-plane PostgreSQL. | Cloud auth/session startup | Private hosted security infrastructure | High | **WAIT #408** — secret/environment separation |
| `Nostos.Backend/Cloud/ControlPlane/CloudSubscription.cs` | Backend | **B** | Official-host commercial subscription/plan state and audit records. | Entitlements/billing | Private hosted commercial layer | Medium | Possible privacy lifecycle touch; extract after #408 |
| `Nostos.Backend/Cloud/ControlPlane/CloudSubscriptionStore.cs` | Backend | **B** | PostgreSQL commercial subscription store. | Entitlement/billing services | Private hosted commercial layer | Medium | Possible privacy lifecycle touch |
| `Nostos.Backend/Cloud/Persistence/CloudTenantDbContextFactory.cs` | Backend | **B** | Resolves trusted Cloud account -> control-plane mapping -> Npgsql `NostosDbContext`. Reuses public model rather than duplicating it. | Product repositories/services in Cloud requests | Private hosted persistence adapter | **Very high** | **WAIT #408** — tenant isolation boundary |
| `Nostos.Backend/Cloud/Provisioning/CloudCustomerDatabaseProvisioner.cs` | Backend | **B** | Creates/initializes customer PostgreSQL resources and records state. | Provisioning/onboarding | Private hosted provisioning | **Very high** | **WAIT #408** — lifecycle, failure cleanup and surface hardening |
| `Nostos.Backend/Cloud/Migrations/CloudTenantSchemaMigrator.cs` | Backend | **B** | Fleet/customer PostgreSQL migration orchestration and compatibility checks. | Provisioning/recovery/operator lifecycle | Private hosted DB operations | **Very high** | **WAIT #408** — migration/pool/operability hardening |
| `Nostos.Backend/Cloud/Migrations/PostgresNostosDbContext.cs` | Backend | **B** | Migration-only Npgsql context inheriting the public canonical `NostosDbContext`. This is the desired reuse direction. | EF migration generation/recovery | Private hosted PostgreSQL adapter | Medium | **WAIT #408** |
| `Nostos.Backend/Cloud/Migrations/Postgres/20260922170154_InitialCloudBaseline.cs` | Backend | **B** | PostgreSQL hosted schema migration. | Cloud migration lifecycle | Private hosted PostgreSQL migrations | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Migrations/Postgres/20260922170154_InitialCloudBaseline.Designer.cs` | Backend | **B** | Generated metadata for hosted PostgreSQL migration. | EF tooling/runtime | Private hosted PostgreSQL migrations | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Migrations/Postgres/20260922170207_EstablishCloudMigrationLifecycle.cs` | Backend | **B** | Hosted fleet migration lifecycle. | Cloud migrator | Private hosted PostgreSQL migrations | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Migrations/Postgres/20260922170207_EstablishCloudMigrationLifecycle.Designer.cs` | Backend | **B** | Generated metadata for hosted PostgreSQL migration. | EF tooling/runtime | Private hosted PostgreSQL migrations | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Migrations/Postgres/PostgresNostosDbContextModelSnapshot.cs` | Backend | **B** | Hosted PostgreSQL EF snapshot generated from the public model. | EF tooling | Private hosted PostgreSQL migrations | High | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudControlPlaneOptions.cs` | Backend | **B** | Hosted PostgreSQL admin/control/customer connection configuration. | Cloud persistence/provisioning/recovery | Private hosted configuration | Medium | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudPersistenceRegistration.cs` | Backend | **B** | Registers control plane, Npgsql tenant factory, entitlements, managed usage, migrations and provisioning. | Program/deployment composition | Private hosted composition | **Very high** | **WAIT #408** |

Provider-neutral EF compatibility fixes discovered while maintaining PostgreSQL must still be applied to the public `NostosDbContext`; the Npgsql provider, fleet migration orchestration and hosted migration set do not need to remain public.

## 4. Authentication and tenant context

| Current path | Project | Class | Rationale / dependencies | Consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Security/CloudAccountIdentity.cs` | Backend | **C** | Contains server-derived `NostosAccountId`, trusted tenant-context accessors and Cloud account status. These are security-critical hosting concepts, not currently needed by SelfHosted/product code. | Auth, control plane, tenant DB/storage, background jobs | Prefer private hosted security layer. Introduce a smaller public owner-context contract only if product code later genuinely needs one. | **Very high** | **WAIT #408** |
| `Nostos.Backend/Security/CloudAuthentication.cs` | Backend | **C** | Generic OIDC primitives are used, but policies are specific to official hosted access and depend on Cloud entitlements/account state. | Cloud middleware/endpoints | Private hosted auth/composition; keep only product capability semantics public | **Very high** | **WAIT #408** — central hardening surface |
| `Nostos.Backend/Configuration/CloudAuthOptions.cs` | Backend | **B** | Hosted OIDC/Clerk configuration including secret environment variable names. | CloudAuthentication | Private hosted configuration | High | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudDataProtectionOptions.cs` | Backend | **B** | Hosted session/Data Protection key protection settings. | DataProtectionRegistration | Private hosted security configuration | High | **WAIT #408** |
| `Nostos.Backend/Configuration/DataProtectionRegistration.cs` | Backend | **C** | Mixes normal public ASP.NET Data Protection setup with Cloud control-plane key storage. | Program/auth | Split: ordinary SelfHosted registration public; Cloud key repository wiring private | High | **WAIT #408** |
| `Nostos.Backend/Endpoints/CloudAuthEndpoints.cs` | Backend | **B** | Hosted login/logout/session API. Public browser code may consume it, but backend implementation and policy are host concerns. | Shared Angular Cloud-entry flow | Private hosted API | High | **WAIT #408** |
| `Nostos.Frontend/src/app/core/dtos/cloud-auth.dtos.ts` | Frontend | **A** | Safe browser-visible session/account state; contains no provider token/secret. Keeping it public preserves one frontend. | CloudAuthService/CloudEntry | Public frontend | Low | Update only for contract changes from #408 |
| `Nostos.Frontend/src/app/core/services/cloud-auth.service.ts` and `.spec.ts` | Frontend | **A** | Browser client for hosted auth API; no privileged provider implementation. | CloudEntryService | Public frontend | Low | Re-test after #408 auth changes |

The public product does **not** currently need to understand tenant identity to serve normal product behavior. Product code already receives tenant-selected `NostosDbContext` and `IBookAssetStorage` through dependency injection. Keeping the trusted identity/resource lookup in the private host therefore yields a cleaner boundary than publishing Cloud tenancy concepts pre-emptively.

## 5. Billing, entitlements and onboarding

| Current path | Project | Class | Rationale / dependencies | Consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Cloud/Billing/CloudBillingOptions.cs` | Backend | **B** | Official-host plan configuration plus Paddle mapping. | Billing service/registration | Private hosted commercial layer | Medium | Re-read after #408 secret/config review |
| `Nostos.Backend/Cloud/Billing/CloudBillingState.cs` | Backend | **B** | External billing-provider binding/event receipts in control plane. | Paddle reconciliation | Private hosted commercial layer | High | Privacy lifecycle may touch it |
| `Nostos.Backend/Cloud/Billing/PaddleBilling.cs` | Backend | **B** | Paddle API/webhook/reconciliation implementation and worker. | Billing endpoints/onboarding | Private hosted commercial/provider adapter | High | Secret redaction/observability may touch it; extract after #408 |
| `Nostos.Backend/Cloud/Entitlements/CloudEntitlements.cs` | Backend | **B** | Nostos-host subscription/allowance enforcement. SelfHosted must not depend on it. | Auth, managed AI, onboarding | Private hosted commercial layer | High | Account lifecycle/rate-limit behavior may touch it |
| `Nostos.Backend/Cloud/Onboarding/CloudOnboardingService.cs` | Backend | **B** | Orchestrates hosted subscription, entitlement and provisioning. | Cloud onboarding endpoints | Private hosted service | High | **WAIT #408** because provisioning/account states are hardened there |
| `Nostos.Backend/Configuration/CloudBillingRegistration.cs` | Backend | **B** | Hosted Paddle/commercial DI composition. | Program | Private hosted composition | Medium | Extract after #408 |
| `Nostos.Backend/Endpoints/CloudBillingEndpoints.cs` | Backend | **B** | Hosted checkout/manage/reconcile/Paddle webhook API. | Public Angular onboarding UI/provider webhooks | Private hosted API | High | Secret/error/rate-limit hardening may touch it |
| `Nostos.Backend/Endpoints/CloudOnboardingEndpoints.cs` | Backend | **B** | Hosted account onboarding orchestration API. | Shared Angular frontend | Private hosted API | High | **WAIT #408** |
| `Nostos.Backend/Endpoints/CloudProvisioningEndpoints.cs` | Backend | **B** | Low-level hosted provisioning API. #408 explicitly needs to reconsider exposure of schema details. | Smoke tests/operator/onboarding legacy path | Private hosted API | **Very high** | **WAIT #408** |
| `Nostos.Frontend/src/app/core/dtos/cloud-onboarding.dtos.ts` | Frontend | **A** | Browser-visible product onboarding states, not provider implementation. | Shared Cloud-entry UI | Public frontend | Low | Reconcile with post-#408 API |
| `Nostos.Frontend/src/app/core/services/cloud-onboarding.service.ts` and `.spec.ts` | Frontend | **A** | Browser calls to hosted API. Keeping it public avoids a Cloud frontend fork. | CloudEntryService | Public frontend | Low | Re-test after #408 |
| `Nostos.Frontend/src/app/core/services/cloud-entry.service.ts` and `.spec.ts` | Frontend | **A** | One-browser orchestration boundary that gates on deployment capabilities and composes auth/onboarding/portable import. | App root/CloudEntryComponent | Public frontend | Medium | May change if #408 changes account state semantics |
| `Nostos.Frontend/src/app/cloud-entry/cloud-entry.component.ts` | Frontend | **A** | Customer-facing hosted entry UI within the one Nostos frontend. | App root | Public frontend | Low | UI contract only |
| `Nostos.Frontend/src/app/cloud-entry/cloud-entry.component.html` | Frontend | **A** | Customer-facing hosted entry copy/actions. | CloudEntryComponent | Public frontend | Low | UI contract only |
| `Nostos.Frontend/src/app/cloud-entry/cloud-entry.component.css` | Frontend | **A** | Shared product styling. | CloudEntryComponent | Public frontend | Low | No |
| `Nostos.Frontend/src/app/app.component.ts` and `.html` | Frontend | **A** | Same app bundle decides whether product is ready or hosted entry is required. | Entire frontend | Public frontend | Medium | No extraction |

## 6. Managed AI and BYOK

| Current path | Project | Class | Rationale / dependencies | Consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Services/Ai/ILlmProvider.cs` | Backend | **A** | Provider-neutral assistant contract and errors. | Assistant orchestrator, BYOK and hosted providers | Public product | Low | Generic rate/error behavior may be hardened but remains public |
| `Nostos.Backend/Services/Ai/ISTtProvider.cs` | Backend | **A** | Provider-neutral speech-to-text contract. | Transcription flow, BYOK and hosted STT | Public product | Low | Remains public |
| `Nostos.Backend/Services/Ai/AiProviderConfig.cs` | Backend | **A** | Effective provider configuration seam used by public BYOK and hosted provider composition. | AI providers/settings | Public product | Low | Do not leak secrets in API/logging |
| `Nostos.Backend/Services/Ai/AiProviderSettingsService.cs` | Backend | **A** | SelfHosted/BYOK provider configuration. | Settings + NineRouter providers | Public SelfHosted/product | Medium | #408 may harden shared secret redaction; do not extract |
| `Nostos.Backend/Services/Ai/NineRouterLlmProvider.cs` | Backend | **A** | SelfHosted BYOK LLM transport. | Assistant | Public SelfHosted | Low | No extraction |
| `Nostos.Backend/Services/Ai/NineRouterSttProvider.cs` | Backend | **A** | SelfHosted BYOK STT transport. | Transcription | Public SelfHosted | Low | No extraction |
| `Nostos.Backend/Services/Ai/OpenAiCompatibleChatCompletions.cs` | Backend | **A** | Generic protocol implementation reusable by provider adapters. | LLM providers | Public product | Low | No |
| `Nostos.Backend/Services/Ai/SttErrorCodes.cs` | Backend | **A** | Product-facing provider-neutral error contract. | STT endpoints/providers | Public product | Low | No |
| `Nostos.Backend/Services/Ai/ThoughtProcessor.cs`, `IThoughtProcessor.cs` | Backend | **A** | Product assistant behavior, not commercial hosting. | Note capture/assistant | Public product | Low | No |
| `Nostos.Backend/Services/Ai/ManagedAiAccessPolicy.cs` | Backend | **C** | File mixes public interface + SelfHosted policy with a Cloud policy that imports hosted entitlements. | Assistant endpoints/orchestrator | Split: interface/SelfHosted public; Cloud policy private | Medium | **WAIT #408** if rate/abuse policy changes |
| `Nostos.Backend/Services/Ai/ManagedAiUsage.cs` | Backend | **C** | Provider-neutral usage interface/status is useful to product code; SelfHosted no-op belongs public, hosted reservation/accounting implementation does not. | Assistant/STT/status endpoint | Keep contract + SelfHosted implementation public | Medium | #408 may extend abuse/observability semantics |
| `Nostos.Backend/Services/Ai/CloudManagedAiProviderSettingsService.cs` | Backend | **B** | Official-host provider identity/model/credential glue. | Cloud managed providers | Private hosted AI composition | Medium | Secret-redaction hardening; extract after #408 |
| `Nostos.Backend/Services/Ai/GroqManagedSttProvider.cs` | Backend | **B** | Official-host Groq transport using operator credentials. | Cloud transcription | Private hosted provider adapter | Medium | Rate-limit/telemetry/secret hardening may touch |
| `Nostos.Backend/Services/Ai/VercelAiGatewayManagedLlmProvider.cs` | Backend | **B** | Official-host Vercel AI Gateway transport. | Cloud assistant | Private hosted provider adapter | Medium | Rate-limit/telemetry/secret hardening may touch |
| `Nostos.Backend/Cloud/Ai/CloudAiPricing.cs` | Backend | **B** | Operator cost/pricing epochs for managed providers. | Managed usage accounting | Private hosted commercial/ops layer | Low | Observability/budget hardening may touch |
| `Nostos.Backend/Cloud/Ai/CloudAiUsageModels.cs` | Backend | **B** | Per-account managed provider usage/reservations in control plane. | Cloud usage service | Private hosted commercial/ops layer | High | **WAIT #408** — cost/usage observability |
| `Nostos.Backend/Cloud/Ai/CloudManagedAiUsageService.cs` | Backend | **B** | Enforces hosted allowance + global operator budgets. | Assistant/STT managed providers | Private hosted commercial/ops layer | High | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudManagedAiOptions.cs` | Backend | **B** | Hosted provider endpoints/models/secret variable names. | Cloud managed providers | Private hosted configuration | Medium | **WAIT #408** secret/environment review |
| `Nostos.Backend/Configuration/CloudManagedAiUsageOptions.cs` | Backend | **B** | Operator budget/usage policy. | Cloud usage service | Private hosted configuration | Medium | **WAIT #408** |
| `Nostos.Backend/Endpoints/CloudManagedAiUsageEndpoints.cs` | Backend | **B** | Hosted usage status API; intentionally hides provider/cost internals. | Shared Settings UI | Private hosted API | Medium | **WAIT #408** rate/observability policy |

## 7. Object storage

| Current path | Project | Class | Rationale / dependencies | Consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Cloud/Storage/S3BookAssetStorage.cs` | Backend | **B** | S3-compatible tenant-scoped implementation of public `IBookAssetStorage`; derives namespace from trusted Cloud context/control plane. | Product media endpoints/portability | Private hosted storage adapter | **Very high** | **WAIT #408** — B2 namespace isolation/direct delivery |
| `Nostos.Backend/Cloud/Storage/CloudObjectStorageBootstrapper.cs` | Backend | **B** | Hosted bucket readiness/access validation. | Startup/health | Private hosted infrastructure | High | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudObjectStorageOptions.cs` | Backend | **B** | Hosted S3/B2 endpoint/bucket/credential variable configuration. | S3 registration/storage/recovery | Private hosted configuration | High | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudObjectStorageRegistration.cs` | Backend | **B** | Wires S3 client, asset storage and Cloud recovery services. | Program | Private hosted composition | **Very high** | **WAIT #408** |

A future authorized short-lived direct-media URL capability should be introduced through a narrow **public** media-delivery contract only if product/API code needs it. The signing/key derivation implementation stays private.

## 8. Operational recovery, workers and health

| Current path | Project | Class | Rationale / dependencies | Consumers | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Backend/Cloud/Recovery/CloudRecoveryModels.cs` | Backend | **B** | Hosted operational backup/restore resource manifests and audit state. Depends on public portability format but is not customer portability itself. | Recovery services/endpoints | Private hosted recovery | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Recovery/CloudRecoveryService.cs` | Backend | **B** | Account-scoped staged restore orchestration over control plane + public portability. | Recovery endpoints/scheduled backup | Private hosted recovery | **Very high** | **WAIT #408** — superseded-resource lifecycle explicitly deferred here |
| `Nostos.Backend/Cloud/Recovery/CloudRecoveryControlPlane.cs` | Backend | **B** | Atomic switch of account resource mapping to staged DB/storage. | CloudRecoveryService | Private hosted recovery/control plane | **Very high** | **WAIT #408** |
| `Nostos.Backend/Cloud/Recovery/CloudRecoveryResourceManager.cs` | Backend | **B** | Creates temporary PostgreSQL/S3 restore resources and composes public archive import. | CloudRecoveryService | Private hosted recovery infrastructure | **Very high** | **WAIT #408** |
| `Nostos.Backend/Cloud/Recovery/CloudRecoveryStore.cs` | Backend | **B** | S3 operational backup store and restore audit metadata. | CloudRecoveryService | Private hosted recovery infrastructure | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Recovery/CloudBackupSweepRunner.cs` | Backend | **B** | Fleet loop over eligible hosted accounts with trusted background tenant scopes. | Scheduled worker/operator execution | Private hosted operations | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Recovery/CloudScheduledBackupWorker.cs` | Backend | **B** | Hosted scheduled fleet backup worker. | Cloud host | Private hosted operations | High | **WAIT #408** |
| `Nostos.Backend/Cloud/Runtime/CloudWorkerLease.cs` | Backend | **B** | PostgreSQL advisory-lock style fleet singleton lease. | Billing/recovery workers | Private hosted runtime | High | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudRecoveryScheduleOptions.cs` | Backend | **B** | Hosted operator schedule. | Scheduled backup registration | Private hosted configuration | Medium | **WAIT #408** |
| `Nostos.Backend/Configuration/CloudRecoveryScheduleRegistration.cs` | Backend | **B** | Hosted worker composition. | Program | Private hosted composition | Medium | **WAIT #408** |
| `Nostos.Backend/Endpoints/CloudRecoveryEndpoints.cs` | Backend | **B** | Hosted operational recovery API. | Operator/customer recovery UX if exposed | Private hosted API | High | **WAIT #408** |
| `Nostos.Backend/Health/NostosHealthChecks.cs` | Backend | **C** | One file mixes generic response + SelfHosted DB readiness with Cloud control-plane/object-storage readiness. | /health/live, /health/ready | Split: generic/SelfHosted public, Cloud readiness private | High | **WAIT #408** — production alerts/dependency failure handling |

#400 behavior remains supported after extraction by letting private recovery call the **public** `IPortableArchiveService`. Provider PITR remains infrastructure recovery and does not replace #399/#400.

## 9. Shared API surfaces #408 may harden but must remain public

These are not extraction candidates merely because official Cloud uses them:

| Current path | Class | Why it stays public | #408 interaction |
| --- | --- | --- | --- |
| `Nostos.Backend/Endpoints/OpdsEndpoints.cs` + `Configuration/OpdsOptions.cs` | **A** | OPDS is a public product capability. | **WAIT #408 for behavior**, because Cloud must not inherit the current unauthenticated private-LAN assumption |
| `Nostos.Backend/Endpoints/BooksEndpoints.cs` | **A** | Core Library media/upload API. | #408 may add upload/rate/content validation; keep the hardened version public |
| `Nostos.Backend/Endpoints/ImportEndpoints.cs` | **A** | Core import API. | #408 may add limits; keep public |
| `Nostos.Backend/Endpoints/AssistantEndpoints.cs` | **A** | Product Ask Nostos API. | #408 may add expensive-endpoint rate limits; keep public |
| `Nostos.Backend/Endpoints/TranscriptionEndpoints.cs` | **A** | Product voice transcription API over public STT contract. | #408 may add rate/upload limits; keep public |
| `Nostos.Backend/Endpoints/AiProviderSettingsEndpoints.cs` | **A** | SelfHosted/BYOK product settings surface, capability-gated in Cloud. | Secret/error redaction improvements remain public |

Extraction must start from the **post-#408 hardened version** of these shared surfaces. Do not “solve” Cloud hardening by moving product endpoints private.

## 10. Frontend and Settings

| Current path | Project | Class | Rationale / dependencies | Target home | Risk | #408 |
| --- | --- | --- | --- | --- | --- | --- |
| `Nostos.Frontend/src/app/core/dtos/deployment-capabilities.dtos.ts` | Frontend | **A** | Mirrors provider-neutral product capabilities. | Public frontend | Low | No |
| `Nostos.Frontend/src/app/core/services/deployment-capabilities.service.ts` + spec | Frontend | **A** | Runtime-gates one bundle for SelfHosted/Cloud. | Public frontend | Low | No |
| `Nostos.Frontend/src/app/settings/settings.component.ts` | Frontend | **A** | Settings uses capabilities to hide local backup/network/provider configuration in Cloud while retaining one screen/codebase. | Public frontend | Medium | Contract changes only |
| `Nostos.Frontend/src/app/settings/settings.component.html` | Frontend | **A** | One product Settings UI. | Public frontend | Low | Contract changes only |
| `Nostos.Frontend/src/app/settings/settings.component.css` | Frontend | **A** | Shared visual implementation. | Public frontend | Low | No |
| `Nostos.Frontend/src/app/ui/assistant/**` | Frontend | **A** | Ask Nostos product UX is common; hosted provider credentials/accounting stay server-side. | Public frontend | Low | Rate/error UX may adapt after #408 |

**Frontend decision:** do not create a private Cloud frontend, private fork, copied Angular tree, or private npm package for the whole application. The private Cloud host consumes/builds the public frontend at the same pinned public revision. Browser-visible hosted entry/auth/onboarding clients remain public; secrets, provider SDK credentials and operator APIs remain private backend concerns.

If a future operator/admin UI is needed, it is a separate operations surface owned by the private repository, not a fork of Library/Brain/Reader/Studio.

## 11. Configuration files

| Current path | Class | Target | Risk / note | #408 |
| --- | --- | --- | --- | --- |
| `Nostos.Backend/appsettings.json` | **C** | Keep public product/SelfHosted-safe defaults; hosted production values live in private deployment configuration/environment | Medium | **WAIT #408** for safe defaults/redaction |
| `Nostos.Backend/appsettings.Development.json` | **A/C** | Public local development defaults only; never real hosted credentials | Low | Review after #408 |
| `Nostos.Backend/appsettings.Probe.json` | **C** | Keep only public/generic probe config; hosted probe config can move private | Low | Review after #408 |

No repository should contain production secrets. Making hosted code private is not a substitute for secret management.

## 12. CI/CD and deployment assets

| Current path | Class | Rationale / target | Risk | #408 |
| --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | **C** | Today orchestrates both SelfHosted and every Cloud integration job. After extraction, public CI must build/test public product + SelfHosted with **no private access**; hosted jobs move to private CI. | High | Rebase plan after #408 tests land |
| `.github/workflows/frontend.yml` | **A** | One public frontend CI. | Low | No |
| `.github/workflows/selfhosted-integration.yml` | **A** | Proves fresh public SelfHosted/SQLite runtime. | Low | No |
| `.github/workflows/postgresql-compatibility.yml` | **B/C** | Hosted Npgsql/fleet integration moves private. Provider-neutral EF-model regression remains public where possible. | High | **WAIT #408** |
| `.github/workflows/object-storage-integration.yml` | **B** | Hosted S3/B2 adapter integration (MinIO in CI). | Medium | **WAIT #408** |
| `.github/workflows/cloud-recovery-integration.yml` | **B** | Hosted PostgreSQL+S3 staged recovery. | High | **WAIT #408** |
| `.github/workflows/portability-integration.yml` | **C** | #399 service/format tests remain public; Cloud PostgreSQL+S3 round-trip belongs private after extraction. Split rather than delete portability coverage. | Medium | Re-run against hardened Cloud after #408 |
| `.github/workflows/cloud-runtime.yml` | **C** | Contains useful generic/SelfHosted production-container checks plus Cloud runtime behavior. Split: public container/SelfHosted checks, private Cloud runtime checks. | High | **WAIT #408** |
| `.github/workflows/cloud-release.yml` | **B** | Builds/publishes official hosted immutable image and staging smoke path. Future private hosted release pipeline. | High | **WAIT #408** |
| `scripts/cloud/staging-smoke.sh` | **B** | Official Cloud liveness/readiness/capability/provisioning smoke. | Private hosted ops | **WAIT #408** — provisioning response + HSTS smoke are active hardening concerns |
| `Dockerfile` + `.dockerignore` | **A/C** | Generic product container recipe can remain public for SelfHosted. Private Cloud should have its own host image recipe that consumes the pinned public source rather than altering the public image to depend on private code. | Medium | Re-check after runtime hardening |

## 13. Tests

Tests move with the responsibility they verify; do not preserve Cloud test files in public CI by importing private implementation.

### Public tests that must remain

- `Nostos.Backend.Tests/Portability/PortableArchiveServiceTests.cs`
- `Nostos.Backend.Tests/Portability/PortableArchiveTestSupport.cs`
- `Nostos.Backend.Tests/Configuration/DeploymentConfigurationTests.cs`
- `Nostos.Backend.Tests/Backup/BackupServiceTests.cs`
- `Nostos.Backend.Tests/Services/FileStorageServiceTests.cs`
- product/domain/API/assistant tests that do not require hosted implementations;
- frontend tests, including capability-gated Settings and Cloud-entry UI contract tests.

### Hosted tests that should follow implementation to the private repository

- `Nostos.Backend.Tests/Cloud/CloudAiPricingTests.cs`
- `CloudAiUsageIntegrationTests.cs`
- `CloudBackupSweepTests.cs`
- `CloudBillingIntegrationTests.cs`
- `CloudBillingTests.cs`
- `CloudEntitlementServiceTests.cs`
- `CloudObjectStorageIntegrationTests.cs`
- `CloudOnboardingTests.cs`
- `CloudProvisioningIntegrationTests.cs`
- `CloudProvisioningSecurityTests.cs`
- `CloudRecoveryIntegrationTests.cs`
- `CloudRecoveryScheduleTests.cs`
- `CloudRuntimeIntegrationTests.cs`
- `CloudSchemaMigrationIntegrationTests.cs`
- `CloudSubscriptionIntegrationTests.cs`
- `Nostos.Backend.Tests/Security/CloudAuthenticationTests.cs`
- hosted-provider tests such as `ManagedCloudAiProviderTests.cs`.

### Boundary-sensitive integration test

`Nostos.Backend.Tests/Cloud/CloudPortabilityIntegrationTests.cs` proves an important **public** invariant (#399 works across SelfHosted/Cloud), but the Cloud fixture requires private PostgreSQL/S3 composition. After extraction:

1. public CI keeps portable archive format/service tests and a full SelfHosted export/import round-trip;
2. private CI runs the cross-deployment SelfHosted -> official Cloud and Cloud -> SelfHosted integration against the pinned public revision.

This preserves portability as a public promise without making public CI depend on private source.

## 14. Existing Cloud documentation

Previously published architecture/implementation documentation does not need destructive history rewriting. During extraction:

- keep public product docs such as deployment capabilities, portability and SelfHosted behavior in the public repo;
- retain already-published Cloud docs as historical context where useful;
- put **new** operator runbooks, commercial-provider internals, private CI/deployment details and production incident procedures in the private repository;
- never move secrets into documentation in either repository.

The new ADR `docs/adr/cloud-public-private-boundary.md` is the canonical technical decision for the split.

## 15. #408 extraction hold list

The following modules are either explicitly named by #408 or sit on the security/privacy/operability path it is likely to modify. **Do not extract them until #408 is merged; start from the hardened post-merge files.**

- `Program.cs` and Cloud middleware/endpoint mapping;
- `Security/CloudAccountIdentity.cs`, `Security/CloudAuthentication.cs`, `Configuration/CloudAuthOptions.cs`;
- control plane/account status/resource lifecycle;
- tenant PostgreSQL factory, connections, migration/provisioning;
- object-storage namespace/auth/read path;
- all Cloud recovery resources, cleanup and scheduler/lease code;
- Cloud health/readiness/observability surfaces;
- managed-AI usage/budget/rate-limit/telemetry surfaces;
- Cloud billing/provider secret/error handling where #408 changes it;
- `CloudProvisioningEndpoints.cs` (schema detail exposure is explicitly called out);
- OPDS, upload/import/assistant/transcription shared endpoints when hardened;
- Cloud CI/integration tests and `scripts/cloud/staging-smoke.sh`.

The next extraction session must first compare this inventory against the #408 merge diff and update any moved/renamed contracts before code migration starts.

## 16. Contributor / copyright inventory for relicensing review

This section records repository evidence only; it is **not legal advice**.

### Repository evidence

- `LICENSE` begins with `Copyright (C) 2026 Christian Gennari` and contains GNU GPL version 3 text.
- `Nostos.Backend.csproj` and `Nostos.Shared.csproj` declare `GPL-3.0-or-later`.
- The repository tree contains no `CONTRIBUTING`, `AUTHORS`, CLA, DCO or `.mailmap` file establishing contributor assignment/relicensing terms.
- An audit of all 1,255 commits visible through GitHub on 2026-09-23 found:
  - 1,202 commits associated with GitHub user `Christian-Gennari`;
  - 25 additional commits authored as “Christian Gennari” without a linked GitHub author object;
  - **26 commits authored by GitHub user `discovicke`**, including substantive product work such as EPUB typography/theme, note Markdown export, command palette, reading stats, audio controls and UI fixes;
  - **2 commits authored only as `t`** with no linked GitHub author object, touching audio-reader/UI behavior.

Commit counts establish provenance signals, not copyright ownership or whether a contribution remains copyright-significant in the current tree.

### What that means for a future license decision

- Git history does **not** support treating the repository as unambiguously sole-author.
- The repository evidence alone does not show an assignment, CLA or separate relicensing permission from `discovicke` or the unidentified `t` author.
- Before changing future public releases from GPL-3.0-or-later to AGPL or another license, identify the real author/rights status of those contributions and determine whether permission, replacement or another approach is needed.
- Versions already published under GPL terms remain part of the public history; this architecture work does not attempt to retract them or rewrite ordinary published code history.
- The technical plan also does **not** decide whether a private hosted executable that project-references GPL public code has licensing obligations when built/deployed/distributed. That question, and any effect of future AGPL licensing, requires actual legal advice before a proprietary-hosting boundary is relied upon.

### Questions for counsel / maintainer records

1. Who owns the copyright in the 26 `discovicke` commits, and was any assignment or broad relicensing permission agreed outside GitHub?
2. Who authored the two `t` commits, and under what contribution terms?
3. Which externally-authored changes remain copyright-significant in current source?
4. Can future public versions be relicensed to AGPL without additional permissions, or would affected contributions need consent/replacement?
5. What obligations arise if the private hosted project references/builds GPL-licensed public projects, particularly if containers/binaries are conveyed to third parties or infrastructure providers?
6. Are there employment, school, contractor, AI-assisted-development or third-party code facts not represented in Git history that affect ownership?
7. Does the desired public/private distribution model require a different technical process boundary for licensing reasons?

No `LICENSE` change belongs in Phase 1.
