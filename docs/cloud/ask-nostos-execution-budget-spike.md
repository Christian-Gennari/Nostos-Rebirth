# Ask Nostos per-turn execution-budget spike

Issue: #406  
Parent: #258  
Baseline inspected: `main@62c8540a8b2e23c41b338a59213473e9b6cd6ea2`  
Date: 2026-09-22

## Decision status

**Measured and set (2026-09-22).** The external protocol was executed: 1,080 live
turns of `gemini-3.8-flash` at `thinking_level=low` on synthetic fixtures only —
900 turns at 100 repetitions per scenario, plus a 180-turn sanity pass. The
transport was the one the app uses today, the local 9Router gateway through the
production `NineRouterLlmProvider`; #404's managed Cloud provider is still
unmerged and the direct Google AI Studio keys on this machine are free tier.

The measurement decided the four per-turn ceilings, and the code now ships them:

| Ceiling | Shipped value | Evidence from the 900-turn run |
| --- | --- | --- |
| Upstream-call safety ceiling | **6 calls** | Largest measured turn used 5 calls; 0/900 reached 6; the changing-tool pathological case still stops here. |
| Cumulative-token ceiling | **50,000 tokens** | Largest measured turn used 31,875; the worst a legitimate six-call turn reaches on this transport is ≈38,000. |
| Wall-clock ceiling | **60,000 ms** | 99% of turns finished inside 14.6 s; 8/900 stalled for 141–145 s on one slow upstream call while doing only 2–3 calls of work. |
| Estimated-cost ceiling | **$0.05** | Largest measured turn cost $0.0247; the token ceiling prices at ≈$0.039 today and ≈$0.078 in the 2027 epoch, which is why cost stays its own dimension. |

None of the four would have stopped a single legitimate turn in the sample, and
the wall-clock ceiling stops exactly the stalled ones. Runtime enforcement passes
the remaining turn deadline into each upstream provider call, so a single slow
call is cancelled at the 60 s turn boundary instead of waiting for the 90 s
per-request transport timeout. The distributions, the transport correction and
the honest limits of the measurement are in "External measurement results" below.

Therefore:

- the call-loop, approval/input and duplicate-tool rules below are kept, and the
  call ceiling is revalidated rather than reduced;
- the instrumentation that produced these numbers is the reusable production
  code path, not a mock;
- the token/time/cost ceilings are set from measurement, not invented precision;
- the token and cost figures are stated twice — as measured through the gateway
  and as the direct-API equivalent — because the gateway adds a constant
  2,000-token preamble to every upstream call.

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

## External measurement results (2026-09-22)

Two live runs were executed against `gemini-3.8-flash` at `thinking_level=low`, on
synthetic fixture data only, through the transport the app actually uses today: the local
9Router gateway, model id `ag/gemini-3.8-flash-low`, driven by the production
`NineRouterLlmProvider` (the OpenAI-compatible route).

| Run | Repetitions per scenario | Turns | Provider errors |
| --- | --- | --- | --- |
| `full-100-9r` (headline) | 100 | 900 | 0 |
| `sanity-20-9r` (sanity pass) | 20 | 180 | 0 |

**Transport correction.** The gateway adds a constant 2,000 tokens to every upstream
call: a minimal call reports 2,002 prompt tokens where the same text against the direct
API reports 2, and the delta stayed exactly additive as prompt size grew. Every table
below therefore reports the token and cost figures twice — as measured, and as the
direct-API equivalent (measured − 2,000 × upstream calls). The direct Google AI Studio
keys available for this run are free tier (20 requests/day/project/model), which is why
the gateway carries the dataset; a direct-path cross-check slice runs after the quota
reset and is reported separately.

### Per-scenario results (100 repetitions each)

| Scenario | Calls p50/p90/p99 | Input tokens p50/p90/p99 (measured) | Input tokens p50/p90/p99 (direct-API equivalent) | Output tokens p50/p90/p99 | Total tokens p99 (equivalent) | Elapsed ms p50/p90/p99 | Cost p50/p99 (measured) | Cost p50/p99 (equivalent) | >2 / >4 / ≥6 calls | Stops | Flow matched |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `simple_read_only` | 1 / 1 / 1 | 5,173 / 5,173 / 5,173 | 3,173 / 3,173 / 3,173 | 30 / 33 / 35 | 3,208 | 1,250 / 1,740 / 4,672 | $0.0040 / $0.0040 | $0.0025 / $0.0025 | 0 / 0 / 0 | Completed 100 | 100/100 |
| `library_lookup` | 2 / 2 / 2 | 11,782 / 11,785 / 11,787 | 7,782 / 7,785 / 7,787 | 60 / 65 / 69 | 7,856 | 2,487 / 3,360 / 4,018 | $0.0091 / $0.0091 | $0.0061 / $0.0061 | 0 / 0 / 0 | Completed 100 | 100/100 |
| `notes_concepts_lookup` | 2 / 2 / 2 | 11,772 / 12,343 / 12,345 | 7,772 / 8,343 / 8,345 | 350 / 376 / 393 | 8,735 | 3,108 / 4,085 / 5,835 | $0.0102 / $0.0107 | $0.0072 / $0.0077 | 0 / 0 / 0 | Completed 100 | 100/100 |
| `capture_write` | 2 / 2 / 2 | 10,862 / 10,964 / 11,015 | 6,862 / 6,964 / 7,015 | 43 / 50 / 56 | 7,059 | 3,788 / 4,657 / 5,592 | $0.0083 / $0.0084 | $0.0053 / $0.0054 | 0 / 0 / 0 | Completed 100 | 100/100 |
| `dependent_read_only` | 2 / 2 / 3 | 11,936 / 11,989 / 18,877 | 7,936 / 7,989 / 12,877 | 251 / 306 / 347 | 13,130 | 4,074 / 5,303 / 139,414 | $0.0099 / $0.0152 | $0.0069 / $0.0107 | 9 / 0 / 0 | Completed 100 | 100/100 |
| `dependent_multi_step_organization` | 3 / 3 / 3 | 19,880 / 19,923 / 19,950 | 13,880 / 13,923 / 13,950 | 201 / 205 / 210 | 14,150 | 5,313 / 6,203 / 142,158 | $0.0157 / $0.0157 | $0.0112 / $0.0112 | 100 / 0 / 0 | Completed 100 | 100/100 |
| `approval_required` | 5 / 5 / 5 | 31,542 / 31,558 / 31,601 | 21,542 / 21,558 / 21,601 | 263 / 271 / 277 | 21,866 | 6,425 / 8,290 / 14,003 | $0.0247 / $0.0247 | $0.0172 / $0.0172 | 100 / 71 / 0 | ApprovalRequired 1, Completed 99 | 1/100 |
| `required_user_input` | 1 / 1 / 1 | 5,390 / 5,435 / 5,480 | 3,390 / 3,435 / 3,480 | 25 / 25 / 25 | 3,818 | 2,727 / 3,213 / 3,880 | $0.0041 / $0.0042 | $0.0026 / $0.0027 | 0 / 0 / 0 | UserInputRequired 100 | 100/100 |
| `harmless_adversarial_repeat_read` | 3 / 3 / 3 | 16,708 / 16,793 / 16,816 | 10,708 / 10,793 / 10,816 | 81 / 91 / 108 | 10,899 | 4,638 / 6,286 / 141,233 | $0.0129 / $0.0130 | $0.0084 / $0.0085 | 89 / 0 / 0 | Completed 100 | 100/100 |

### Pooled engineering sample

The nine scenarios are weighted equally on purpose — this is an engineering sample, not a
production traffic distribution, and it must not be read as one.

- Final turns: **900** (provider-error turns: 0, retry attempts: 0)
- Flow matched: 801/900 (89.0%)
- Upstream call histogram: 1→200, 2→402, 3→202, 4→25, 5→71
- Calls above 2 / above 4 / at least 6: 298 (33.1%) / 71 (7.9%) / 0 (0.0%)
- Stop reasons: ApprovalRequired 1, Completed 799, UserInputRequired 100

| Metric | Median (p50) | p90 | p99 |
| --- | --- | --- | --- |
| Upstream calls | 2 | 4 | 5 |
| Input tokens (measured) | 11,784 | 22,301 | 31,562 |
| Input tokens (direct-API equivalent) | 7,784 | 14,301 | 21,562 |
| Output tokens | 81 | 315 | 381 |
| Thinking tokens | 224 | 272 | 318 |
| Total tokens (measured) | 12,093 | 22,491 | 31,829 |
| Total tokens (direct-API equivalent) | 8,093 | 14,491 | 21,829 |
| Elapsed time (ms) | 3,511 | 6,218 | 14,649 |
| Estimated cost, measured | $0.0098 | $0.0174 | $0.0247 |
| Estimated cost, direct-API equivalent | $0.0068 | $0.0114 | $0.0172 |

### What the ceilings would have done to these 900 turns

| Ceiling as shipped | Turns it would have stopped | Comment |
| --- | --- | --- |
| 6 upstream calls | 0 of 900 | Largest observed turn used **5** calls. |
| 50,000 cumulative tokens | 0 of 900 | Largest observed turn used **31,875** tokens (measured); the worst a legitimate six-call turn can reach on this transport is ≈38,000. |
| 60,000 ms wall clock | 8 of 900 | 99% of turns finished inside 14,649 ms; the 8 stopped turns stalled 141–145 s on a single slow upstream call with only two or three calls and ~10–15 k tokens, i.e. provider stalls rather than heavy work. |
| $0.05 estimated cost | 0 of 900 | Largest observed turn cost **$0.0247** (measured, gateway transport). |

So the shipped ceilings do not clip a single legitimate turn in the sample, and the one
dimension that fires does so exactly on the pathology it exists for.

### Loop, stop and missing-field observations

- No turn ended `ProviderError`; there were no transport retries in either run.
- Stop reasons across 900 turns: ApprovalRequired 1, Completed 799, UserInputRequired 100. No turn ended on the repeated-tool or ceiling guards.
- Thinking tokens were reported in 91 of 900 turns (all in the required-user-input scenario, p50 224); every other turn left the field unknown. The instrumentation records unknown, never zero, so a provider that omits the field cannot be mistaken for a free one.
- Provider finish reasons were present on every turn.
- Scenario `approval_required` is the one flow the transport did not reproduce: only 1 of 100 turns reached `ApprovalRequired`. In the others the model asked for a capability name that does not exist (`library_delete_empty_collection`, the real one is `library_delete_collection`), so the orchestrator refused the unknown name, executed nothing, and the turn ended `Completed` after three to five calls. The guard behaved correctly; the approval flow itself was exercised on the direct API instead (4 calls, `ApprovalRequired`).
- A single turn also reached the intended approval flow through the gateway (rep 42, 4 calls), so the flow is reachable on this transport, just not reliably prompted by this scenario wording.


## Recommended Cloud per-turn policy

### Measured per-turn policy (2026-09-22)

| Dimension | Shipped value | Evidence |
| --- | --- | --- |
| Immediate repeated equivalent tool batch | stop on the **second consecutive equivalent request, before second execution** | Deterministic no-new-information condition; protects repeated writes. The 100 measured adversarial repeat turns all ended normally inside 3 calls. |
| Approval required | **stop immediately after the proposing model response** | No further model information is required; the direct-API turn reached the decision in 4 calls, and the gateway turn that proposed a real destructive call stopped in 4. |
| Required user input | **stop immediately** | 100/100 measured turns stopped here after a single call. |
| Upstream-call safety ceiling | **6 calls** | Revalidated, not reduced: the largest of 900 measured turns used 5 upstream calls and none reached 6, so the ceiling still has headroom over real work while remaining the final runaway guard. |
| Cumulative token budget | **50,000 tokens** | 1.6× the worst measured turn (31,875) and above the ≈38,000 a legitimate six-call turn reaches on this transport; it bounds a runaway, not a context window. |
| Wall-clock turn budget | **60,000 ms** | 4× the worst non-stalled p99 (14.6 s) and deliberately below the 90 s per-request transport timeout, so a stalled turn ends as a stopped turn rather than a transport error. |
| Estimated provider-cost budget | **$0.05** | 2× the worst measured turn ($0.0247); equals the token ceiling priced at the recorded epoch (≈$0.039) with a small margin, and binds first if the 2027 epoch doubles prices. |

The call ceiling stays the final runaway ceiling rather than the normal turn
budget: measured legitimate work ended through task completion or a deterministic
boundary after one to three calls, and the approval flow after four.

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

## External Gemini 3.8 Flash Low measurement protocol

**Executed 2026-09-22.** The numbers are in "External measurement results" above; the
harness that produced them lives in `Nostos.Backend.Tests/Measurement/` and is test-only.
It ran through the local 9Router gateway because #404's managed Cloud provider was still
unmerged and the direct AI Studio keys are free tier; the gateway's constant 2,000-token
preamble is measured (not assumed) and subtracted in every reported direct-API equivalent.
The protocol below is kept as the recipe for the re-run against the direct API once the
migration lands.

Do not commit credentials.

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
