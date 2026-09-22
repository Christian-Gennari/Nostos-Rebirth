# Nostos Cloud subscriptions and entitlements

Issue: #403

Nostos Cloud commercial state belongs to the **Cloud control plane**, never to a
customer library database.

The boundary is:

```text
future billing provider
        |
        v
billing adapter (#410)
        |
        v
Nostos control plane
  subscription state
  Nostos plan id
  entitlement snapshot
  audit trail
        |
        v
ICloudEntitlementService
        |
        v
Cloud product features
```

No Stripe, Paddle, Lemon Squeezy, Clerk Billing, or other payment-provider
objects are part of the product-facing entitlement API.

## Plan identity versus entitlements

A plan id is a stable, Nostos-owned identifier represented by
`NostosPlanId`.

It is **not** a provider product or price id:

```text
NostosPlanId != StripePriceId != PaddleProductId
```

This issue deliberately does not define final marketing tiers. A future billing
adapter maps an external product/subscription into a Nostos plan id and a
subscription change.

Product code should not branch on plan names. It consumes
`ICloudEntitlementService`, which returns effective values:

- `CloudAccess`
- `ManagedAiEnabled`
- `ManagedAiMonthlyAllowance`
- `StorageBytesLimit`
- the effective Nostos subscription lifecycle state

The managed-AI allowance is a plan allowance, not a remaining-usage counter.
Issue #405 owns usage metering, budget-unit policy, remaining allowance, and
rate/cost enforcement.

## Control-plane persistence

The control plane stores two commercial tables:

- `CloudSubscriptions` — one current subscription snapshot per Nostos account;
- `CloudSubscriptionAudit` — append-only snapshots of each applied change.

The current row stores:

- Nostos account id;
- Nostos plan id;
- lifecycle state;
- the entitlement set as JSONB;
- optional trial/grace deadlines;
- the last update timestamp.

Keeping the entitlement payload as a small JSONB value allows allowance values
and future capability data to evolve without adding a database column for every
commercial knob. The typed server model remains the authoritative contract.

Audit rows record the full new state, a bounded change source, and an optional
opaque reconciliation reference. They do **not** contain payment credentials,
card data, webhook secrets, customer library content, or provider-specific
objects required by product code.

The optional reconciliation reference exists so #410 can correlate an accepted
billing event with the state transition later without changing the entitlement
API.

## Existing control-plane upgrade

#396 originally created the control plane with `AccountResources` only and used
`EnsureCreated`.

Because `EnsureCreated` does not add tables to an already-existing database,
#403 adds an idempotent additive bootstrap for the two commercial tables after
the normal control-plane bootstrap.

The upgrade:

- leaves `AccountResources` untouched;
- adds only control-plane commercial tables/indexes;
- keeps subscription rows foreign-keyed to the canonical Nostos account;
- does not touch customer PostgreSQL databases;
- is covered by PostgreSQL integration testing that removes the commercial
  tables from an existing control plane, reruns bootstrap, and verifies the
  pre-existing resource mapping is preserved.

## Lifecycle semantics

Persisted/effective states are:

| State | Effective behavior |
| --- | --- |
| `None` | Effective-only state when no subscription exists. Cloud access denied. It is never persisted. |
| `Trial` | Configured entitlements apply until `TrialEndsAtUtc`. After the deadline the effective state becomes `Expired`. |
| `Active` | Configured entitlements apply. |
| `Grace` | Configured entitlements apply until `GraceEndsAtUtc`. After the deadline the effective state becomes `Expired`. |
| `PastDue` | Cloud access and effective resource allowances are denied. Data is retained. |
| `Cancelled` | Cloud access and effective resource allowances are denied. Data is retained. |
| `Expired` | Cloud access and effective resource allowances are denied. Data is retained. |

Lifecycle evaluation can only reduce access. For example, a stored entitlement
set cannot grant Cloud access while the effective lifecycle is PastDue,
Cancelled, or Expired.

A cancellation, payment failure, expired trial, or expired grace period **never
deletes customer data**. Retention and actual deletion are owned by #408.

This issue establishes the authoritative entitlement result. It does not
retrofit quota checks into every storage/AI path. The relevant follow-up issues
consume the service at the resource boundaries they own.

## Trusted-account isolation

`ICloudEntitlementService.GetEntitlementsAsync()` does not accept an account
id, plan id, provider id, or price id.

It resolves the current account through `ICloudTenantContextAccessor`, then
reads that account's control-plane subscription. This preserves the trusted
tenant boundary from #395/#396: normal product code cannot ask the service for
another customer's commercial state.

Internal control-plane/billing infrastructure uses `ICloudSubscriptionStore`
with an explicit canonical `NostosAccountId` when applying reconciled changes.

## SelfHosted

SelfHosted has no subscription requirement.

`ICloudEntitlementService` and the subscription store are registered only as
part of Cloud persistence composition. A normal SelfHosted process:

- does not need a plan;
- does not need entitlement records;
- does not need a billing account;
- does not make a billing/network call.

The SelfHosted AI/provider behavior remains independent of Nostos Cloud
commercial state.

## Billing integration (#410)

Nostos Cloud v1 uses Paddle Billing behind the provider-neutral boundary
established here. See [billing.md](billing.md) for the provider decision,
checkout/webhook/reconciliation lifecycle, configuration, and replacement
boundary.

The adapter performs this sequence:

```text
verified billing webhook/event
        |
        v
provider adapter
        |
        +-- map provider product -> NostosPlanId
        +-- map provider lifecycle -> CloudSubscriptionStatus
        +-- resolve authoritative entitlement set
        |
        v
ICloudSubscriptionStore.ApplyChangeAsync(...)
        |
        +-- update current state
        +-- append audit row
        |
        v
ICloudEntitlementService reflects the new state
```

Provider webhook verification, checkout, price mapping, customer portal,
idempotency receipts, and missed-event reconciliation remain outside #403 in
the Cloud billing infrastructure.

Clerk remains the authentication provider. Clerk identity is not the
subscription domain model. Paddle external ids are likewise not product-facing
subscription identity.

## Future managed AI integration (#405)

#405 should consume the effective entitlement service and meter actual managed-AI
usage against `ManagedAiMonthlyAllowance`.

#403 intentionally does not modify `AssistantOrchestrator`, count tokens, price
model calls, or implement rate limiting.

## Future storage enforcement

Storage consumers can use `StorageBytesLimit` as the authoritative account
allowance. Full object-storage usage accounting and enforcement are intentionally
deferred to the resource boundary that owns storage usage.

Entitlement changes never delete stored books/media themselves.
