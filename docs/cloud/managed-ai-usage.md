# Managed AI metering and spend controls

Issue: #405  
Parent: #258

This layer surrounds, but does not replace, the #406 per-turn execution policy.

## Four independent enforcement layers

1. **Short-window rate limit** — account-scoped server admission for bursts and accidental loops.
2. **Per-turn execution budget (#406)** — unchanged: 6 upstream calls, 50,000 reported tokens, 60,000 ms, and $0.05 estimated cost, plus approval/input/repeated-tool boundaries.
3. **Monthly entitlement budget (#403 + #405)** — the effective `ManagedAiMonthlyAllowance` is consumed by Nostos-managed provider spend.
4. **Operator/global ceiling** — a server-side emergency switch and calendar-month spend cap across all Cloud accounts.

A request must pass every applicable layer. A healthy monthly balance never weakens the per-turn guard.

## Budget unit and period

`ManagedAiMonthlyAllowance`, reservations, and quota charges use **micro-USD of estimated provider spend**:

- 1 USD = 1,000,000 micro-USD;
- the unit is internal plan/accounting data, not public plan copy;
- calendar-month boundaries are UTC;
- a new period starts at 00:00:00 UTC on the first day of each month;
- historical rows are retained; rollover is a new period query, not deletion/reset mutation.

Plan changes apply the new allowance immediately against usage already accumulated in the same UTC month. Grace accounts keep their effective entitlement until #403's grace deadline. Cancelled, expired, past-due, or otherwise non-entitled accounts cannot start provider spend. No lifecycle transition in this subsystem deletes customer data.

## Trusted account attribution

Normal product code cannot supply an account id to the usage service. It derives the canonical account from `ICloudTenantContextAccessor`, the same trusted server context used by entitlements and tenant persistence.

Pre-spend admission writes a reservation inside a PostgreSQL transaction protected by a fixed-order global + account advisory lock. The transaction checks:

- account request count in the short window;
- committed + reserved account spend against the current effective entitlement;
- committed + reserved global spend against the operator ceiling.

This makes concurrent API requests serialize at the decision boundary instead of all observing the same remaining balance.

Settlement can only resolve a reservation owned by the same trusted account. A reservation id cannot be used to spend or mutate another account.

## Content-free metering schema

`CloudAiUsage` records only execution/accounting metadata:

- canonical Nostos account id;
- LLM or STT kind;
- provider, model, optional model version;
- pricing epoch;
- start/completion/period timestamps;
- upstream request count;
- input/output/thinking/reported-total tokens when reported;
- tool-loop iterations;
- STT duration in milliseconds when reported;
- estimated provider cost when known;
- conservative quota charge;
- result/stop category and provider finish reason.

`CloudAiUsageReservations` contains only the pre-spend account/provider/model/time/reserved-cost metadata needed for atomic admission.

There are deliberately **no fields for prompts, assistant replies, tool arguments/results, notes, books, writings, or audio**. Audio remains streamed through the #404 STT boundary.

## Pricing epochs

Historical cost is never recomputed with today's price.

Current catalog entries:

- Google `gemini-3.8-flash`
  - through 2026-12-31: $0.75 / 1M input and $3.75 / 1M output tokens;
  - from 2027-01-01: $1.50 / 1M input and $7.50 / 1M output tokens.
  - Gemini output usage already includes thinking; thinking is stored separately when reported but is not charged twice.
- Groq `whisper-large-v3-turbo`
  - $0.04/hour;
  - minimum billed duration: 10 seconds.

Every known estimate stores a versioned pricing epoch. A provider/model without a catalog match, or an omitted usage dimension, has `EstimatedCostMicrousd = null`. Unknown is not rewritten to zero.

## Failed calls and conservative reservations

#404 performs no hidden provider retries.

Before the first LLM request in a turn, Cloud reserves #406's $0.05 per-turn cost ceiling. STT reserves the configured bounded duration (300 seconds by default). If usage is known on settlement, the actual estimate replaces the reservation as the quota charge.

If a request was attempted but fails/returns partial data without enough usage metadata to price it, estimated cost remains unknown and the reservation is charged conservatively. This deliberately avoids assuming `failed == free`.

If a process dies before settlement, the reservation remains against that account/global allowance for the current UTC month. This can over-reserve but cannot silently create extra allowance; the next monthly period naturally stops counting it.

## STT limitations

Groq verbose JSON supplies provider-reported duration on successful transcriptions, and that duration is the primary accounting metric. The pricing rule applies Groq's 10-second minimum billed length.

The HTTP endpoint can only enforce its existing maximum duration after Groq reports duration, so a malformed/over-length upload may already have incurred provider spend. Such calls are still metered. Short-window rate limiting, the pre-spend STT reservation, upload cap, monthly allowance, and global ceiling bound this exposure without storing audio.

## Operator controls

`CloudManagedAiUsage` is server configuration:

- `OperatorEnabled=false` is the emergency stop;
- `GlobalMonthlyBudgetMicrousd` is the UTC calendar-month global ceiling; `0` is a hard stop;
- rate-window/request limits are independent of monthly allowance;
- `SttReservationSeconds` controls conservative pre-spend STT reservation;
- `NearLimitPercent` controls the product-level warning state.

These values can be changed in runtime/hosting configuration without a frontend or code release. The browser cannot override them.

## Product-level usage API

Cloud exposes:

`GET /api/cloud/ai/usage`

The authenticated response contains only:

- `state`: `normal`, `near_limit`, `exhausted`, `not_included`, or `temporarily_unavailable`;
- `renewsAtUtc`: the next UTC monthly boundary when applicable.

This is intentionally sufficient for #407 Settings without turning ordinary users into a provider token/cost dashboard.

## Relationship to adjacent work

- #403 supplies provider-neutral effective entitlements.
- #404 supplies the managed Gemini/Groq provider transports.
- #406 remains authoritative for one-turn execution limits and deterministic stop boundaries.
- #405 adds persistence, atomic admission, monthly/rate/global enforcement, pricing epochs, failure policy, and the product-level usage API.
- SelfHosted uses the no-op usage service and never depends on Cloud usage tables, subscriptions, or Cloud network calls.
- #407 may consume the usage API; no frontend change is required here.
