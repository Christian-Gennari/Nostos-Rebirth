# Public/private ownership inventory

This is the current ownership summary for #438/#462. The architecture decision is
documented in the [boundary ADR](../adr/cloud-public-private-boundary.md).

| Capability | Public Nostos | Private Nostos-Cloud |
| --- | --- | --- |
| Domain model, Library, Brain, Reader, Studio, Notes | Canonical implementation in `Nostos.Product` | Consumes the pinned public implementation |
| Customer frontend | One Angular application | Builds the same pinned public frontend |
| SelfHosted runtime | ASP.NET host, SQLite and schema bootstrap | Not applicable |
| Media and backup | Local filesystem and local backup/restore | Hosted storage and operator recovery |
| AI | Ask Nostos orchestration, provider-neutral contracts, BYOK settings/providers | Managed provider credentials, commercial metering and hosted adapters |
| Portability | `.nostos` archive format, import/export and product APIs | Supplies trusted hosted authorization and storage adapters |
| Deployment capabilities | Stable product-level SelfHosted/Cloud contract | Reports hosted capabilities through the same contract |
| Authentication and tenancy | No hosted provider or tenant implementation | Hosted identity, account control plane, provisioning and tenant routing |
| Billing and entitlements | No commercial billing implementation | Subscription state, Paddle lifecycle and entitlement enforcement |
| CI/release | Public build, SelfHosted, portability and frontend acceptance | Pinned public SHA, private host, provider integration and hosted release |

## Dependency rules

- The public repository must build and start SelfHosted without private source,
  packages, credentials or generated artifacts.
- Private Nostos-Cloud consumes public code through a submodule pinned to one exact
  public commit.
- Product/domain/frontend changes land in public Nostos before the private pin
  moves.
- No canonical product or Angular source is copied into the private repository.
- Hosted-only implementations and operations do not return to the public build.

## Acceptance gates

Public CI guards the boundary and requires SelfHosted SQLite bootstrap, local media,
local backup/restore, public product regressions, BYOK behavior, portable
import/export and the Angular production build. A disposable PostgreSQL test checks
the canonical model without making the SelfHosted host depend on PostgreSQL.

Private CI checks the public gitlink and `pinned-public-sha.txt`, records both SHAs
in release metadata and rejects copied product source. Isolated provider-backed
staging parity/security remains a release gate for the hosted cutover.
