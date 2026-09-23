# Nostos Cloud hosted onboarding

Issue: #409  
Parent: #258

Nostos Cloud uses the same Angular application and ASP.NET backend as
SelfHosted Nostos. Hosted onboarding is a temporary entry gate around that
shared product, not a second dashboard or frontend.

## Product flow

```text
Cloud app
  |
  +-- runtime capability manifest
  |      |
  |      +-- SelfHosted -> normal Nostos immediately
  |      |
  |      '-- Cloud
  |            |
  |            +-- signed out -> /api/auth/login -> hosted OIDC/Clerk UI
  |            |
  |            '-- authenticated Nostos account
  |                    |
  |                    +-- no usable subscription -> checkout/reconcile
  |                    |
  |                    +-- usable Trial / Active / Grace
  |                    |       |
  |                    |       '-- idempotent provisioning
  |                    |               |
  |                    |               +-- progress/retry
  |                    |               '-- Ready
  |                    |
  |                    '-- Disabled / Deleted -> blocked
  |
  '-- Ready -> ordinary Library / Brain / Studio / Reader routes
```

The Angular root gate is the only Cloud-entry orchestration point. Normal
product components do not contain their own authentication, billing or
provisioning checks.

## Server-authoritative onboarding contract

Authenticated pre-activation users can call:

- `GET /api/cloud/onboarding/`
- `POST /api/cloud/onboarding/checkout`
- `POST /api/cloud/onboarding/reconcile`
- `POST /api/cloud/onboarding/provision`
- `POST /api/cloud/onboarding/billing-portal`

The group uses the #395 `AuthenticatedAccount` policy. It does not require the
account to be Active yet, which is necessary for first-run setup.

The browser receives only product state:

- `subscription_required`
- `subscription_pending`
- `subscription_inactive`
- `ready_to_provision`
- `provisioning`
- `provisioning_failed`
- `ready`
- `account_unavailable`

The response can also say whether checkout, subscription reconciliation,
billing management or provisioning retry is available.

It does **not** return:

- database names or connection strings;
- storage namespaces, buckets or credentials;
- schema versions;
- provisioning stage/failure codes;
- Paddle transaction/customer/subscription identifiers;
- Clerk issuer/subject claims or tokens.

Tenant identity is still the canonical `NostosAccountId` derived from the
validated OIDC issuer + subject. No onboarding request accepts an account id or
resource selector from the browser.

## Subscription before provisioning

Provisioning is intentionally ordered after effective Cloud access.

`ICloudEntitlementService` remains authoritative:

- `Trial`, `Active` and unexpired `Grace` can proceed when
  `CloudAccess=true`;
- `None`, `PastDue`, `Cancelled` and `Expired` cannot enter or provision.

A Paddle redirect does not change this. Checkout creates provider state through
#410, while access changes only after a verified webhook or authenticated
server reconciliation updates #403 state.

When checkout exists but entitlement is not usable yet, onboarding reports
`subscription_pending` and offers a server-side reconciliation action.

#409 deliberately does not invent public pricing or a plan-selection UI. The
v1 hosted checkout handoff expects exactly one configured billing plan with
`CloudAccess=true`. If Nostos later exposes multiple public Cloud tiers,
explicit product plan selection should be designed separately rather than
rendering internal plan ids.

## Provisioning and refresh safety

#409 calls the existing #396 provisioner. It does not allocate databases or
storage itself.

The onboarding layer:

1. re-checks effective entitlement;
2. derives the trusted account from server authentication;
3. invokes the existing idempotent provisioner;
4. reads progress back from the control plane.

Provisioning work is not cancelled merely because the browser disconnects.
Refreshing or closing the page therefore does not make browser state
authoritative.

If an app process is interrupted while the control plane says
`Provisioning`, Retry may re-enter the same idempotent provisioner. The
stable account/resource mapping and #396 concurrency/idempotency guarantees
prevent a second customer resource mapping from being selected by the browser.

The frontend polls only the product-safe onboarding endpoint. It never stores
authoritative provisioning state locally.

## First successful entry and portable import

A returning account that is already Ready goes directly into the normal Nostos
application.

When the current browser initiated first-time provisioning, a small local
marker remembers only that the optional first-run choice is still pending.
That marker:

- contains the already browser-visible canonical Nostos account id;
- grants no access;
- selects no tenant/database/storage resource;
- is not authoritative for provisioning.

After Ready, that browser can choose:

- **Start fresh**
- **Import an existing Nostos library**

Import uploads the selected `.nostos` archive directly to the existing #399
`POST /api/portability/import` endpoint. #409 adds no archive parser or second
migration engine.

After either choice, onboarding disappears and the ordinary application shell
is used. A returning Ready account with no pending first-run marker is never
forced through a permanent Cloud dashboard.

## SelfHosted

SelfHosted never calls Cloud session, billing, onboarding or provisioning APIs.

The shared Angular root first reads the existing deployment capability
manifest. In SelfHosted mode it immediately enables the normal product shell.
No Clerk account, Paddle account, Cloud entitlement or Cloud resources are
required.

## Failure UX

Frontend copy is intentionally product-level:

- auth/session unavailable: a safe Cloud-unavailable/retry surface;
- provisioning failure: “We couldn’t finish preparing your library. Retry.”;
- inactive subscription: billing management/check-again actions;
- backend/control-plane failure: safe retry without displaying the internal
  exception.

Raw SQL/provider errors and infrastructure identifiers remain server-side.

## External Clerk boundary

Repository code is provider-neutral and is complete without committing Clerk
credentials.

A deployed Cloud environment still needs its Clerk OIDC application configured
with the actual HTTPS Cloud application origin.

ASP.NET Core OpenID Connect uses its standard middleware callback paths:

- sign-in redirect URI: `https://<cloud-app-origin>/signin-oidc`
- sign-out callback URI: `https://<cloud-app-origin>/signout-callback-oidc`

Nostos runtime configuration then needs:

```text
CloudAuth__Authority=<validated Clerk OIDC issuer/authority>
CloudAuth__ClientId=<OIDC client id>
CloudAuth__Audience=<audience accepted by Nostos; normally the configured client/API audience>
NOSTOS_CLOUD_AUTH_CLIENT_SECRET=<secret injected at runtime only>
```

The secret value must never be committed, copied into a GitHub issue, or written
to repository documentation.

The preferred branded hosted-auth domain remains `accounts.nostos.page` when
the current Clerk environment supports custom domains. If not, the provider
hosted domain can be used without changing the Nostos application contract.

A full browser login/logout smoke requires a real reachable Cloud origin and
Clerk application. #402 intentionally left that external staging boundary
unconfigured.

## Landing-page boundary

The marketing site is a separate repository and is not modified by #409.

Once the final hosted Cloud application origin exists, its Cloud CTA should
navigate to the application's auth entry point, for example:

```text
https://<cloud-app-origin>/api/auth/login?returnUrl=%2Flibrary
```

That backend challenge performs the Clerk-hosted handoff and establishes the
HttpOnly Nostos session on return. The landing page must not embed Clerk
secrets or implement a second authentication flow.
