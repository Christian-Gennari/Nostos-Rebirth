# Nostos Cloud billing — Paddle

Issue: #410  
Foundation: #403

## Decision

Nostos Cloud v1 uses **Paddle Billing** as its billing provider and merchant of
record.

The choice is operational, not a product-domain dependency. Paddle is a good fit
for a small Swedish/EU SaaS because its pay-as-you-go merchant-of-record model
bundles subscription billing, payment processing, VAT/sales-tax collection and
remittance, fraud/chargeback handling, and buyer billing support without a
monthly platform fee.

The current public Paddle pay-as-you-go price is 5% + USD 0.50 per checkout
transaction. Pricing is an external provider fact and is deliberately not
encoded in Nostos plan/domain types.

The provider boundary remains replaceable:

```text
Paddle
  |
  | verified webhook / authenticated API
  v
Cloud billing adapter
  |
  | Nostos-owned plan + lifecycle mapping
  v
#403 CloudSubscriptions + audit
  |
  v
ICloudEntitlementService
  |
  v
Cloud product features
```

Library, Reader, Brain, Studio, Ask Nostos, and customer library databases never
query Paddle.

Clerk remains authentication only. Billing links to the canonical
`NostosAccountId`, not to a Clerk user id, email address, Paddle customer id, or
Paddle subscription id.

## Checkout

`POST /api/cloud/billing/checkout` accepts a Nostos-owned `planId`.

The server:

1. resolves the authenticated canonical Nostos account;
2. ensures the control-plane account mapping exists;
3. maps the Nostos plan to the configured Paddle price id;
4. creates a Paddle transaction server-side;
5. puts only the opaque Nostos account id and plan id in Paddle `custom_data`;
6. persists the transaction binding in the Cloud control plane;
7. returns Paddle's checkout URL.

A browser redirect or checkout-success callback **never activates
entitlements**. Access changes only after a verified Paddle event or an
authenticated Paddle API reconciliation.

Paddle copies transaction `custom_data` to the subscription created from a
recurring checkout, so future subscription events can be associated with the
same canonical Nostos account without using email as identity.

## Provider mapping

Nostos plan identity and Paddle catalog identity are separate.

```text
Paddle price id (pri_...)
        |
        v
CloudBilling:Paddle:PriceMappings
        |
        v
NostosPlanId
        |
        v
CloudBilling:Plans entitlement set
```

Only the billing adapter knows Paddle price/customer/subscription ids.

Each v1 Nostos plan has exactly one mapped Paddle base subscription price.
Unmapped recurring add-ons may remain on a Paddle subscription, but exactly one
mapped base price must be present for reconciliation to succeed.

Final public pricing/marketing tiers are not defined in code by #410.

## Lifecycle mapping

| Paddle subscription state | Nostos #403 state | Behavior |
| --- | --- | --- |
| `trialing` | `Trial` | Full configured entitlements until Paddle `next_billed_at`, used as `TrialEndsAtUtc`. |
| `active` | `Active` | Full configured entitlements. |
| `past_due`, inside configured grace window | `Grace` | Entitlements remain available until `GraceEndsAtUtc`. |
| `past_due`, after grace window | `PastDue` | Entitlements denied; data retained. |
| `paused` | `Cancelled` | Entitlements denied while paused; a later resume event maps back to `Active`. |
| `canceled` | `Cancelled` | Entitlements denied; data retained. |

Paddle has no direct state that Nostos needs to map to `Expired`.
`ICloudEntitlementService` can still produce effective `Expired` when a stored
Trial or Grace deadline passes, preserving #403 semantics.

Payment failure, cancellation, pause, trial expiry, grace expiry, and
`PastDue` **never delete customer data**. Retention/deletion remains #408.

## Past-due grace

`CloudBilling:PastDueGraceHours` controls Nostos's product grace window.

The default configuration value is 72 hours.

A verified Paddle `past_due` state initially maps to `Grace` while the
deadline remains in the future. Reconciliation later maps the same provider
subscription to `PastDue` after that deadline if Paddle still reports
`past_due`.

This is Nostos-owned product policy. Paddle remains responsible for payment
recovery/dunning; it is not queried at request time to decide whether a product
feature is available.

## Upgrades and downgrades

`POST /api/cloud/billing/change-plan` accepts a target Nostos plan id.

The adapter:

1. gets the authoritative Paddle subscription;
2. preserves recurring items that are not Nostos base-plan prices;
3. replaces the mapped base-plan price;
4. updates Paddle with `on_payment_failure=prevent_change`;
5. uses `prorated_immediately` for ordinary active subscriptions;
6. uses `do_not_bill` while a subscription is still trialing;
7. reconciles the authenticated Paddle API response into #403 state.

The later Paddle webhook is still processed normally. Duplicate/stale delivery
cannot roll the subscription backward.

## Cancellation

`POST /api/cloud/billing/cancel` uses Paddle's subscription cancellation API.

Paddle's default behavior schedules cancellation at the end of the current
billing period. Nostos therefore keeps the subscription `Active` while Paddle
still reports it as active, then moves to `Cancelled` when the provider reports
the cancellation as effective.

No customer data is deleted.

## Customer billing management

`POST /api/cloud/billing/portal` creates a short-lived Paddle customer-portal
session and returns its authenticated URL.

Nostos does not store portal URLs or tokens. Customers can use the hosted Paddle
portal for payment-method and subscription-management workflows supported by
Paddle.

## Webhook verification

Paddle sends webhooks to:

```text
POST /api/cloud/billing/webhooks/paddle
```

The route is anonymous at the ASP.NET authentication layer because Paddle is not
a Clerk user. It is authenticated cryptographically before any event is parsed
or applied.

Verification:

1. read the request body without transforming it;
2. parse `ts` and one or more `h1` values from `Paddle-Signature`;
3. reject timestamps outside the five-second tolerance;
4. compute HMAC-SHA256 over `<ts>:<raw-body>`;
5. compare signatures with a fixed-time comparison;
6. only then deserialize and reconcile the event.

Webhook secrets and API keys are never logged.

## Idempotency and ordering

Paddle uses at-least-once delivery and does not guarantee delivery order.

The control plane therefore stores:

- one provider binding per Nostos account;
- the latest known Paddle transaction/customer/subscription ids;
- the last accepted provider event timestamp;
- one receipt keyed by `(Provider, EventId)`.

For a webhook:

- an already-recorded `event_id` is a no-op;
- an event whose `occurred_at` predates the account's last accepted event is
  recorded as stale and cannot overwrite current #403 state;
- an accepted event updates the binding, #403 current subscription, #403 audit
  trail, and event receipt in one PostgreSQL transaction;
- a concurrent duplicate that loses the database uniqueness race fails the
  delivery so Paddle retries; the retry then observes the committed receipt as
  a duplicate.

The external subscription id is unique across Nostos account bindings, so an
event for account A cannot move that same Paddle subscription onto account B.

## Missed-event recovery

A checkout transaction id is persisted before the customer leaves Nostos.

A Cloud-only reconciliation worker runs every
`CloudBilling:ReconciliationIntervalMinutes` (15 minutes by default):

1. list Paddle bindings in the control plane;
2. when only a checkout transaction id is known, fetch the transaction and
   discover the resulting subscription id;
3. fetch the authoritative subscription;
4. map its current price/status to the Nostos plan/lifecycle;
5. feed it through the same ordered/idempotent reconciliation path.

`POST /api/cloud/billing/reconcile` exposes the same recovery operation for the
current authenticated account.

Provider state is therefore recoverable after delayed, duplicated, out-of-order,
or missed webhook delivery without turning Paddle into a request-time product
dependency.

## Configuration

`appsettings.json` declares names and non-secret defaults only.

Example operator configuration:

```json
{
  "CloudBilling": {
    "Provider": "Paddle",
    "PastDueGraceHours": 72,
    "ReconciliationIntervalMinutes": 15,
    "Plans": [
      {
        "PlanId": "cloud-standard",
        "CloudAccess": true,
        "ManagedAiEnabled": true,
        "ManagedAiMonthlyAllowance": 1000,
        "StorageBytesLimit": 10737418240
      }
    ],
    "Paddle": {
      "Environment": "Sandbox",
      "ApiKeyEnvironmentVariable": "NOSTOS_CLOUD_BILLING_PADDLE_API_KEY",
      "WebhookSecretEnvironmentVariable": "NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET",
      "CheckoutUrl": "https://nostos.page/pay",
      "PriceMappings": [
        {
          "PriceId": "pri_REPLACE_WITH_SANDBOX_PRICE_ID",
          "PlanId": "cloud-standard"
        }
      ]
    }
  }
}
```

The entitlement numbers above are examples only, not public-plan decisions.

Required secrets:

```text
NOSTOS_CLOUD_BILLING_PADDLE_API_KEY
NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET
```

Do not put their values in appsettings, source control, GitHub issues, CI YAML,
or documentation.

## Paddle sandbox setup

Before Cloud billing can start, create/configure in Paddle Sandbox:

1. a Paddle sandbox account;
2. one recurring product/price for each Nostos Cloud plan;
3. an API key with the minimum permissions required for:
   - transaction read/write;
   - subscription read/write;
   - customer-portal-session write;
4. a notification destination pointing at
   `https://<cloud-host>/api/cloud/billing/webhooks/paddle`;
5. subscription lifecycle notifications, including created/updated/activated,
   trialing, past-due, paused/resumed, and canceled;
6. an approved checkout/default-payment-link domain;
7. a checkout page matching `CloudBilling:Paddle:CheckoutUrl` that loads
   Paddle.js so Paddle transaction payment links can open checkout;
8. copy the resulting sandbox price ids into
   `CloudBilling:Paddle:PriceMappings`;
9. store the API key and notification secret in the two environment variables
   above.

Production uses a separate live Paddle account/catalog/key/notification secret.
Set `CloudBilling:Paddle:Environment` to `Live` only after sandbox validation
and Paddle live-account approval.

## Local and sandbox testing

Never use production billing credentials in CI.

Unit tests use deterministic fake Paddle HTTP responses plus locally generated
valid/invalid signatures.

PostgreSQL integration coverage uses the repository's disposable PostgreSQL
service and does not call Paddle. It proves:

- accepted provider events update #403 subscription state;
- effective entitlements follow the update;
- duplicate events are no-ops;
- stale events cannot roll state backward;
- one provider subscription cannot affect two Nostos accounts;
- cancellation denies entitlements without deleting control-plane/customer
  resource mappings.

For end-to-end sandbox validation, use Paddle's webhook simulator and sandbox
checkout rather than live money.

## SelfHosted

SelfHosted does not register:

- `ICloudBillingService`;
- Paddle API clients;
- billing reconciliation storage;
- the reconciliation worker;
- checkout/portal/webhook endpoints.

It requires no Paddle API key, webhook secret, catalog, account, or network
connection.

## Replacing Paddle later

A future provider migration should replace:

- provider API client;
- signature/authentication verification;
- provider lifecycle mapping;
- provider catalog-id mapping.

It should keep:

- canonical `NostosAccountId`;
- `NostosPlanId`;
- `CloudSubscriptionStatus`;
- `CloudEntitlementSet`;
- #403 current subscription and audit trail;
- `ICloudEntitlementService`;
- customer library databases and product/domain code.

That boundary is the reason provider ids remain confined to Cloud billing
infrastructure.
