# Ask Nostos per-turn execution-budget spike

Issue: #406  
Parent: #258  
Baseline inspected: `main@62c8540a8b2e23c41b338a59213473e9b6cd6ea2`  
Date: 2026-09-22

## Decision status

This spike can make one policy decision from repository evidence now: **six
upstream calls remains the absolute runaway safety ceiling, not the normal
per-turn execution budget**. Legitimate deterministic scenarios in the current
Ask Nostos orchestrator need at most four upstream calls, while approval,
required user input, and an immediately repeated equivalent tool batch should
stop earlier.

The spike **cannot yet set evidence-backed cumulative-token, wall-clock, or
estimated-cost ceilings for Nostos Cloud**. The planned Cloud provider in #404
(`gemini-3.8-flash`, `thinking_level=low`) is not implemented in the current
repository and no real Cloud provider credentials were available to this run.
Using the current SelfHosted/9Router default
(`gemini/gemini-3.5-flash-lite`) as a substitute would measure a different
model, gateway and thinking configuration.

Therefore:

- the call-loop, approval/input and duplicate-tool rules below are ready to
  keep;
- the instrumentation needed for provider measurement is reusable production
  code;
- token/time/cost limits remain deliberately **unset**, rather than filled with
  invented precision;
- #406 should remain open until the external Gemini 3.8 Flash Low measurement
  protocol at the end of this document has been run.

## Scope and layer boundaries

This work is the **per-user-turn UX execution budget**. It is not:

1. abuse/rate limiting;
2. the monthly managed-AI allowance exposed by #403 entitlements;
3. billing or subscription lifecycle logic;
4. an operator/global emergency spend ceiling.

Those other controls belong to #405 (with monthly availability sourced from the
#403 entitlement result). A turn may be below its local execution budget and
still be refused by a rate limit, monthly allowance, or global emergency
ceiling. Conversely, having monthly allowance left must never permit one turn
to run without a bounded execution policy.

No billing, subscription schema, backup/restore, portability, onboarding,
account deletion or Cloud Settings code is touched here.

## What was inspected

The spike traced the whole current path:

- `AssistantOrchestrator` and its in-process tool loop;
- `AssistantOptions.MaxToolIterations`;
- `ILlmProvider`, `LlmCompletion` and the 9Router response parser;
- tool generation through `AssistantConversationBuilder`;
- the capability registry and trust classes;
- capture/user-input boundaries;
- `PlanAndAct` proposal and approval execution;
- the real SQLite-backed assistant tests and `FakeLlmProvider`;
- existing logging/telemetry.

Important baseline observations:

- all currently advertised tools are built once at turn start and the same set
  is sent on every upstream call;
- the baseline hard ceiling was six calls;
- a model could request the same tool with the same arguments repeatedly until
  that ceiling;
- each tool round intentionally receives a different idempotency key, so a
  repeated write request could otherwise be executed more than once;
- a capture that needs a page/timestamp already stopped immediately for user
  input;
- a `PlanAndAct` request was recorded as pending approval **but then consumed
  another upstream model call** before the turn ended;
- provider errors are not automatically retried by `NineRouterLlmProvider`;
- prompt and completion token fields already existed, but the orchestrator did
  not aggregate them and thinking/reasoning tokens were not represented.

## Methodology

### Repository-structural measurement

The representative scenarios run the **real `AssistantOrchestrator`, real
capability registry and real SQLite-backed services**, replacing only the
network model with the repository's scriptable `FakeLlmProvider`. This makes
upstream-call and tool-loop shape deterministic while exercising the actual
trust, tool-result and mutation paths.

These are structural measurements: they answer how many model/tool rounds the
current Nostos workflows require when the provider chooses the expected tools.
They are **not** a statistical sample of live model behavior.

The tests pin the call counts so a future orchestration change cannot silently
turn a two-call flow into a five-call flow.

### Content-free instrumentation

`AssistantExecutionMeter` now records only:

- attempted upstream calls;
- returned tool-call count;
- tool-loop iterations;
- cumulative provider-reported input/prompt tokens;
- cumulative provider-reported output/completion tokens;
- cumulative provider-reported thinking tokens when present;
- elapsed milliseconds;
- Nostos stop reason;
- last provider finish reason.

It stores/logs **no prompt text, reply text, tool arguments, tool results or
private library content**. If a provider omits a token dimension on any
completion, that aggregate is reported as unknown rather than silently
under-counted. An attempted request with no completion also has unknown token
usage.

`LlmCompletion` now has an optional `ThinkingTokens` field, and the current
OpenAI-compatible parser understands
`usage.completion_tokens_details.reasoning_tokens`. `ReportedTotalTokens`
is prompt + completion; thinking is not added a second time because providers
such as Gemini price thinking as part of output.

## Representative scenario measurements

The table reports upstream model calls and tool-calling rounds. “After policy”
differs from baseline only where this spike adds a deterministic stop.

| Scenario | Repository fixture | Baseline calls | After policy | Tool rounds | Observation |
| --- | --- | ---: | ---: | ---: | --- |
| Simple conversational/read-only question | no tool, final prose | 1 | 1 | 0 | One provider response is enough. |
| Library lookup | `library_list_collections` + final prose | 2 | 2 | 1 | One read then synthesis. |
| Notes/concepts lookup | `concepts_list` + final prose | 2 | 2 | 1 | One read then synthesis. |
| Capture/write action | `notes_capture` + final prose | 2 | 2 | 1 | Capture executes once; app acknowledgement remains authoritative. |
| Multi-tool read-only | `notes_read_for_review` → `concepts_list` → prose | 3 | 3 | 2 | Two dependent reads. |
| Dependent multi-step action | create collection → use returned id to update book → prose | 3 | 3 | 2 | Real returned state requires a second tool round. |
| Multi-step organization | list collections → create → rename → prose | 4 | 4 | 3 | Highest legitimate structural sample. |
| Approval-required task | destructive `PlanAndAct` proposal | 2 | **1** | 1 | Extra narration call removed; pending plan is the boundary. |
| Required user input | external audiobook capture without timestamp | 1 | 1 | 1 | Deterministic timestamp prompt stops the turn. |

For the nine legitimate scenarios after the policy change, the observed call
counts are:

`1, 2, 2, 2, 3, 3, 4, 1, 1`

- median: **2 calls**;
- scenarios needing more than 2 calls: **3/9 (33%)**;
- scenarios needing more than 4 calls: **0/9**;
- legitimate scenarios approaching or exceeding 6 calls: **0/9**;
- observed legitimate maximum: **4 calls**.

No p90 or p99 is claimed from nine hand-selected deterministic scenarios. A
nearest-rank percentile over this set would create false precision: these are
coverage cases, not a production frequency distribution. The external run
below is what should supply tail percentiles.

## Pathological/tool-loop measurements

Two distinct runaway cases are kept because they test different controls.

### Immediate equivalent repeat

Before this spike, a model could emit `concepts_list({})` (or the same write)
on every round and reach the hard ceiling.

The new deterministic rule fingerprints the **ordered tool batch** using:

- tool name;
- canonical JSON arguments;
- no tool-call id;
- object properties sorted so whitespace/property order does not defeat the
  comparison;
- array order preserved.

If the next upstream response requests the same batch with equivalent
arguments, Nostos stops **before executing the second batch**. Thus the
pathological identical-repeat fixture uses two upstream calls but executes the
tool only once.

This N=2 rule is justified for the current in-process Nostos tools: after the
first call, the model has already received that exact request's result and no
new user input exists. A second identical request cannot obtain new information
and is particularly unsafe for writes because receipt keys differ by iteration.

The same rule also catches “retry the exact same failing tool with the exact
same arguments” after one returned error. A materially changed argument is not
treated as the same loop.

### Changing runaway

A deliberately pathological model that changes its search argument every round
evades equivalent-call detection. The existing absolute ceiling still stops
that turn after **6 upstream calls**. This proves the ceiling remains
defense-in-depth rather than being replaced by a single heuristic.

A future “no meaningful result/state change” detector may catch more complex
oscillations (A→B→A, semantically equivalent results, changing irrelevant
arguments), but that needs tool-specific semantics. It should not be guessed
into this spike.

## Approval, user input and external dependency boundaries

These are termination conditions, not budget consumption targets.

### Approval

When a model proposes one or more `PlanAndAct` steps, the server records the
pending plan and stops before another upstream call. Nothing destructive is
executed. Approval remains a separate explicit user action and the existing
plan/token checks are unchanged.

The deterministic fallback reply is sufficient: “I've prepared a plan for your
approval.” There is no reason to pay the model to narrate the same boundary.

### Required user input

The existing page/timestamp capture boundary remains immediate. If Nostos
cannot truthfully continue without a page, timestamp, book choice or other
required user input, the current turn ends. The user's answer is a **new turn
with a new execution budget**; unused budget is not banked.

A model-written clarification with no tool calls likewise ends the provider
loop normally.

### External dependency/provider failure

The current provider does not retry a failed upstream request. The meter records
the attempted call and a `ProviderError`/cancelled stop reason without
inventing token usage for a response that never arrived. Tool errors may be
shown back to the model once; an exact repeated call is then caught by the
repeat detector.

## Tool-surface shrinking

Today every call in a turn receives the full tool list. That almost certainly
makes later prompts larger than necessary, but this spike does **not** implement
general dynamic pruning because the legitimate three- and four-call workflows
show why later tools can depend on earlier results.

Safe conclusions now:

- after approval or required user input, advertise nothing because there is no
  next model call;
- after an identical repeated batch, stop rather than offering another tool
  surface;
- do not globally remove tools merely because one tool has already succeeded;
  compound user requests can legitimately require another capability;
- the real Gemini measurement should compare full-registry prompt-token growth
  with a phase-aware reduced tool surface before general pruning is adopted.

If pruning is later added, the orchestrator—not the model—should decide the
allowed next capabilities from workflow state.

## Recommended Cloud per-turn policy

### Values supported now

| Dimension | Recommendation now | Evidence |
| --- | --- | --- |
| Immediate repeated equivalent tool batch | stop on the **second consecutive equivalent request, before second execution** | Deterministic no-new-information condition; protects repeated writes. |
| Approval required | **stop immediately after the proposing model response** | No further model information is required; baseline extra call was pure overhead. |
| Required user input | **stop immediately** | Existing deterministic capture behavior; continuing would require guessing. |
| Upstream-call safety ceiling | **6 calls** | Legitimate structural max is 4; no legitimate sample needs >4. Six is retained only as a final runaway guard while provider tails are measured. |
| Cumulative token budget | **not yet numerically set** | No Gemini 3.8 Flash Low distribution has been measured. |
| Wall-clock turn budget | **not yet numerically set** | Fake-provider elapsed time is not representative; current 90 s is a per-request transport timeout, not evidence for a turn UX ceiling. |
| Estimated provider-cost budget | **not yet numerically set** | Requires the real token distribution; pricing alone is not usage evidence. |

This intentionally refuses to turn “6” into a different arbitrary magic
number. The call ceiling is now explicitly the final runaway ceiling; normal
turns should end through task completion or a deterministic boundary well
before it.

### Planned provider and cost formula

Google's Gemini API documentation on 2026-09-22 lists
`gemini-3.8-flash` as stable, supporting function calling and
`low`/`medium`/`high` thinking levels:

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/thinking

The public standard paid price on that date is $0.75 / 1M input tokens and
$3.75 / 1M output tokens **including thinking tokens** through 2026-12-31:

- https://ai.google.dev/gemini-api/docs/pricing

For this price epoch, a measured turn's estimated provider cost is therefore:

`input_tokens / 1,000,000 × $0.75 + output_tokens / 1,000,000 × $3.75`

Do not add `thinking_tokens` again when the provider's output/completion
total already includes them. #405 should version price assumptions by provider,
model and effective date rather than hard-code this introductory price forever.

## Token, latency and cost characteristics observed here

No real-provider token, thinking-token, latency or cost distribution is
reported by this spike run.

That is a result, not missing data disguised as zeros:

- the fake provider intentionally does not spend quota;
- synthetic token counts in unit tests validate aggregation only and are not
  measurements;
- the current 9Router/3.5 Flash-Lite path is not the planned Cloud provider;
- #404 has not yet exposed `gemini-3.8-flash` with low thinking through the
  Cloud path.

The instrumentation preserves unknown values as null, specifically to keep
future #405 accounting from treating missing usage as free usage.

## Budget-exhaustion UX

Budget exhaustion must be distinguishable from success and from an approval or
input boundary.

The current deterministic fallback is now:

> I reached this turn's execution limit before I could finish. Send another
> message to continue.

It exposes no raw token count or cost.

For the final Cloud UI/enforcement implementation, a budget-exhausted response
should additionally surface already completed work from structured server state
(`Acknowledgement` and user-facing labels for `ExecutedCapabilities`) and
state that some requested work remains. It must not invent which remaining
steps would have succeeded. A continuation starts a new turn and is subject to
the ordinary #405 account/rate/quota checks.

Approval and user-input boundaries should keep their specific UX and must not
be mislabeled as budget exhaustion.

## Relationship to #403 and #405

#403 remains the source of effective Cloud entitlement/capability allowance.
This spike consumes only that architectural concept; it does not modify the
subscription schema.

#405 should take the content-free turn measurements and add the broader
accounting/enforcement dimensions:

- trusted Cloud account id;
- provider/model;
- input, output and thinking usage;
- upstream-call/tool-loop usage;
- price epoch and estimated cost;
- short-window abuse/rate-limit counters;
- monthly managed-AI consumption against #403 entitlement;
- operator/global emergency spend controls.

The four control layers must remain independently observable:

| Layer | Purpose | Example decision |
| --- | --- | --- |
| Per-turn UX execution budget (#406) | Stop one runaway/overlong task | repeated-tool stop, call/token/time/cost turn ceiling |
| Abuse/rate limit (#405) | Stop bursty or abusive request patterns | requests/minute, concurrent turns |
| Monthly entitlement (#403 + #405) | Enforce plan allowance | managed-AI units remaining |
| Operator emergency ceiling (#405) | Bound platform-wide incident spend | disable/limit managed AI globally |

## External Gemini 3.8 Flash Low measurement required to finish #406

Run this only after #404 exposes the managed Cloud provider (or in a throwaway
measurement harness using the same adapter). Do not commit credentials.

### Synthetic fixture

Use only synthetic data, for example:

- 12 synthetic books;
- 20 synthetic notes;
- 8 synthetic concepts;
- 6 synthetic collections;
- stable ids across repetitions.

Do not use a real user's library, prompts or notes.

### Scenario set

Run at least these scenarios against `gemini-3.8-flash` with
`thinking_level=low`:

1. plain conversational/read-only question;
2. one library lookup;
3. notes/concepts lookup;
4. one capture/write;
5. dependent multi-tool read-only flow;
6. dependent multi-step organization flow;
7. approval-required proposal;
8. required user-input flow;
9. harmless adversarial prompt that tends to request a repeated read tool.

Keep the deterministic fake-provider changing-loop test for the hard safety
ceiling; there is no value in paying a real provider to intentionally burn all
six calls repeatedly.

### Repetitions and output

Start with 20 repetitions per legitimate scenario as a cost/shape sanity pass.
If the adapter and usage fields are sound, run **100 repetitions per legitimate
scenario** so a nearest-rank p99 is at least observable per scenario. Do not
pool an artificially equal scenario mix and call it a production percentile;
report per-scenario percentiles plus an explicitly labeled pooled engineering
sample.

Capture only:

`scenario, repetition, upstream_calls, tool_calls, tool_loop_iterations, input_tokens, output_tokens, thinking_tokens, elapsed_ms, stop_reason, provider_finish_reason, estimated_cost_usd`

Do not capture prompt text, assistant text, tool arguments or tool results.

Report:

- median / p90 / p99 upstream calls where the sample supports it;
- median / p90 / p99 input, output, thinking and total reported tokens;
- median / p90 / p99 elapsed time;
- median / p90 / p99 estimated cost;
- count and percentage of legitimate turns requiring >2, >4 and >=6 calls;
- every stop reason;
- every repeated-tool event;
- any provider usage response that omitted a required usage field.

Only after that run should the numeric cumulative-token, wall-clock and
estimated-cost turn ceilings be selected. The chosen values should be justified
against observed tails and the desired Cloud UX/cost envelope, not copied from
context-window limits.

## Exact handoff prompt for the external run

```text
Continue Christian-Gennari/Nostos-Rebirth issue #406 after the #404 managed
Gemini provider is available.

Read AGENTS.md, #406, #404, #405, and
docs/cloud/ask-nostos-execution-budget-spike.md. Use an isolated worktree from
current main and do not merge your own PR.

Run the external measurement protocol from the spike document against the
actual managed Cloud model gemini-3.8-flash with thinking_level=low. Use only
synthetic fixture data and supply the API credential via environment/secret
configuration; never commit it.

First run 20 repetitions per legitimate scenario as a sanity pass. Verify the
instrumentation reports upstream calls, tool calls/iterations, input tokens,
output tokens, thinking tokens when provided, elapsed time, stop reason and
finish reason without recording prompts, replies, tool arguments or tool
results. Calculate cost using the currently effective official Google price
epoch and record that price source/date.

If the sanity pass is sound, run 100 repetitions per legitimate scenario.
Report per-scenario median/p90/p99 plus an explicitly labeled pooled engineering
sample. Report how many legitimate turns need >2, >4 and >=6 upstream calls,
all loop/stop patterns, missing usage fields, and the token/latency/cost
distribution.

Then update the spike document with the measured values and select explicit
cumulative-token, wall-clock and estimated-cost per-turn ceilings justified by
those measurements. Revalidate whether six remains the right absolute
upstream-call safety ceiling. Keep per-turn UX budget separate from #405 rate
limits, monthly #403 entitlement, and operator/global emergency spend ceiling.

Run dotnet build Nostos.sln, the assistant tests, the full relevant backend
tests, and AGENTS.md-required validation. Push the branch, update/open the PR,
and close #406 only if the real-provider measurement and final numeric policy
are genuinely complete.
```
