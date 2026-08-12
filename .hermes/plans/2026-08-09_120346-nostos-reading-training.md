# Nostos Reading Training Implementation Plan

> **For Hermes:** Use the Nostos persistent-TUI development workflow and subagent-driven review to implement this plan phase by phase. Nostos must remain fully usable, testable, and shippable with Hermes absent.

**Goal:** Move Reading Training into Nostos as a first-class, standalone capability with complete manual UI control, while exposing the same Nostos-owned operations through REST and MCP so Hermes/Telegram can act as another client without owning state or progression logic.

**Architecture:** Nostos becomes the sole writer and source of truth. A deterministic C# domain service owns sessions, timers, books, captures, weekly progression, reminders, and idempotency in Nostos SQLite. The Angular application uses ordinary same-origin REST endpoints. The Nostos backend also exposes authenticated Streamable HTTP MCP tools that call the same service directly. An optional, thin Hermes connector forwards Telegram controls and verbatim captures to Nostos; it contains no training state or progression calculations.

**Tech Stack:** .NET 10 minimal API, EF Core 10 + SQLite, Angular 21 signals, Vitest, Playwright, official `ModelContextProtocol.AspNetCore` 2.1.0, optional Hermes plugin/skill connector.

---

## 1. Decisions and non-negotiable boundaries

### 1.1 Ownership

- **Nostos owns:** books, training assignments, active session, timer state, captures, history, progression state, weekly reviews, notification outbox, command idempotency, and import receipts.
- **Angular owns no domain state:** it renders server DTOs and issues commands.
- **MCP owns no domain state:** its tools call the same scoped `IReadingTrainingService` used by REST.
- **Hermes owns no domain state:** the optional connector only scopes Telegram routing, forwards exact text, formats validated replies, and optionally projects captures to external systems.
- The existing Python reading coach is a migration source and behaviour oracle during implementation, not a runtime dependency after cutover.

### 1.2 Standalone requirement

Nostos must pass its complete build, backend tests, frontend tests, and browser E2E suite with:

- no Hermes process running;
- no `HERMES_HOME` environment variable;
- no access to `/home/dev/.hermes`;
- MCP disabled in configuration;
- all reading operations available manually in the Nostos UI.

MCP and the Hermes connector are additive integrations. Disabling or deleting either must not disable Reading Training in Nostos.

### 1.2.1 Rejected bridge architecture

Do **not** make `Nostos.Backend` shell out to the Hermes Python virtualenv, import the installed `reading-coach` plugin, read `~/.hermes/data/reading`, or cache responses from that engine. That would make the Nostos UI appear standalone while retaining a hard runtime dependency on Hermes—the exact boundary this project is intended to remove. The Python engine is used only to produce parity fixtures and as a one-time import source. After cutover, deleting Hermes must leave Nostos Reading Training operational.

### 1.3 One source, many surfaces

```text
Angular UI ── REST ─┐
                    │
Hermes ── MCP ──────┼── IReadingTrainingService ── Nostos SQLite
                    │
Optional Telegram ──┘
raw-message gateway
```

There must be no REST logic, MCP logic, or Angular logic that independently calculates progression, elapsed time, ratings, or queue promotion.

### 1.4 Product rules preserved

- Objective: increase sustainable serious-reading capacity without sacrificing comprehension, curiosity, or enjoyment.
- Modes remain independent: Endurance 40→60, Deep 30→45, Recovery 20 by default.
- Progression is time + effort + focus; pages remain optional book progress, never the training target.
- Time-constrained sessions add volume but are neither failure nor progression evidence.
- High fatigue holds or reduces load; never increases it.
- Weekly-only adaptation: three qualifying sessions and completion threshold permit +5; 15% volume guard, deload, and consolidation remain deterministic.
- One open timed session globally; any number of books may be active across a period, and each completed session is linked to exactly one Nostos book.
- No streak, debt, catch-up, guilt, or compulsory reflection language.

---

## 2. Current repository and rollout guardrails

Canonical planning base: `origin/main` at `e2cc1dc` after fetch on 2026-08-09.

The current checkout must not be used for implementation:

- branch: `fix/align-audio-timestamps` with deleted upstream;
- local modification: `Nostos.Backend/Nostos.Backend.csproj`;
- untracked plan: `.hermes/plans/2026-06-25_align-audio-timestamps.md`.

### Task 0: Create an isolated issue worktree

**Objective:** Avoid overwriting unrelated local work and follow one-issue/one-branch/one-PR discipline.

**Steps:**

1. Create a GitHub issue describing the Nostos-owned Reading Training feature and link this plan.
2. Fetch `origin --prune` again.
3. Create an isolated worktree from `origin/main`, not from the current checkout:

```bash
git worktree add /home/dev/coding/projects/nostos-rebirth-reading-training \
  -b feature/issue-<N>-reading-training origin/main
```

4. Copy this plan into the worktree's `.hermes/plans/` directory as an untracked implementation contract.
5. Verify `git status --short` is empty in the new worktree before implementation.
6. Use a persistent OpenCode or agy TUI for implementation. State the harness choice before writing code.

**Do not:** switch, reset, clean, stash, or alter the current `fix/align-audio-timestamps` checkout.

---

## 3. Domain contract before code

### Task 1: Add the language-neutral Reading Training specification

**Objective:** Freeze behaviour before porting the Python engine.

**Create:**

- `docs/reading-training/README.md`
- `docs/reading-training/state-machine.md`
- `docs/reading-training/progression.md`
- `docs/reading-training/contracts.md`
- `docs/reading-training/fixtures/*.json`

**Specify:**

- states: `Idle → Planned → Active ↔ Paused → AwaitingFeedback → Completed`, plus cancellation;
- legal commands and transition errors;
- elapsed-time calculation excluding pauses;
- reported-minutes override while preserving measured seconds;
- Endurance/Deep/Recovery semantics;
- qualification, hold, deload, consolidation, and volume-guard rules;
- multiple books with one global open session;
- exact-once command and capture semantics;
- weekly review idempotency and downtime catch-up;
- notification outbox semantics;
- user-facing reply vocabulary.

**Fixtures:** Export representative, non-private expected-input/expected-output cases from the existing Python tests. Include baseline, constrained, pause/restart, concurrent command retry, capture retry, DST, corrupt/invalid command, queue selection, book completion, deload, consolidation, and 15% guard cases.

**Verification:** Review the specification independently against the existing 59-test Python implementation before porting.

**Commit:** `docs: define reading training domain contract`

---

## 4. Persistence model

### Task 2: Add shared enums and DTOs

**Create:**

- `Nostos.Shared/Enums/ReadingMode.cs`
- `Nostos.Shared/Enums/ReadingSessionStatus.cs`
- `Nostos.Shared/Enums/ReadingConstraint.cs`
- `Nostos.Shared/Enums/ReadingCaptureType.cs`
- `Nostos.Shared/Enums/ReadingAssignmentStatus.cs`
- `Nostos.Shared/Dtos/ReadingTrainingDtos.cs`

**DTO groups:**

- dashboard snapshot;
- current programme/targets;
- book assignment and queue;
- prescription request/result;
- session status and commands;
- completion/rating;
- weekly summary/review decision;
- capture/inbox;
- notification;
- gateway-dispatch result;
- import dry-run/result.

Every mutating command accepts `clientId` and `idempotencyKey`. Responses use one stable envelope:

```csharp
public sealed record ReadingCommandResultDto(
    string Reply,
    object? Data,
    string StateVersion,
    bool Duplicate = false
);
```

The MCP tools and REST endpoints return this same semantic result.

### Task 3: Add EF Core entities and invariants

**Create under** `Nostos.Backend/Data/Models/ReadingTraining/`:

- `ReadingProgramme.cs` — singleton phase, targets, established targets, consolidation counters, deload state, timezone, version;
- `ReadingBookAssignment.cs` — `BookId`, mode, status, queue order, `IsDefaultForMode`, started/completed timestamps;
- `ReadingSession.cs` — book, mode, state, targets, constraints, timestamps, accumulated seconds, measured/reported duration, effort/focus, notice state;
- `ReadingCapture.cs` — verbatim text, type, book/session, created time, inbox state, optional promoted `NoteId`;
- `ReadingWeeklyReview.cs` and `ReadingModeDecision.cs` — immutable committed decision and evidence;
- `ReadingNotification.cs` — transactional outbox item, lease/ack timestamps;
- `ReadingCommandReceipt.cs` — unique `(ClientId, IdempotencyKey)`, command kind, serialized response, created time;
- `ReadingImportReceipt.cs` — source fingerprint and import result.

**Modify:**

- `Nostos.Backend/Data/NostosDbContext.cs`
- `Nostos.Backend/Migrations/<timestamp>_AddReadingTraining.cs`
- `Nostos.Backend/Migrations/NostosDbContextModelSnapshot.cs`

**Database invariants:**

- one `ReadingProgramme` row;
- one globally open session using a filtered unique index over open states;
- one default active book per mode, while allowing other active/queued books;
- unique weekly review by completed ISO week;
- unique capture external/idempotency key;
- unique command receipt key;
- completed sessions and committed reviews are immutable through public commands;
- deleting a book with reading history is rejected or explicitly archives the assignment—never cascades away training history silently.

Use UTC for persistence and `TimeZoneInfo` for Stockholm week boundaries. Inject a clock; do not call `DateTime.UtcNow` inside domain decisions.

**Backup:** Because data lives in `nostos.db`, standard `.nostos` backups already contain it. Also add `metadata/reading-training.json` to `BackupService.BuildArchiveAsync` for inspectable recovery metadata.

**Commit:** `feat: add reading training persistence model`

---

## 5. Deterministic C# engine

### Task 4: Build the pure domain service test-first

**Create:**

- `Nostos.Backend/Services/ReadingTraining/IReadingTrainingService.cs`
- `Nostos.Backend/Services/ReadingTraining/ReadingTrainingService.cs`
- `Nostos.Backend/Services/ReadingTraining/ReadingProgressionPolicy.cs`
- `Nostos.Backend/Services/ReadingTraining/ReadingClock.cs`
- `Nostos.Backend/Services/ReadingTraining/ReadingCommandParser.cs`
- `Nostos.Backend/Services/ReadingTraining/ReadingReplyFormatter.cs`
- `Nostos.Backend/Configuration/ReadingTrainingOptions.cs`

**Create test project:**

- `Nostos.Backend.Tests/Nostos.Backend.Tests.csproj`
- `Nostos.Backend.Tests/ReadingTraining/*Tests.cs`

Add it to `Nostos.sln`. Use xUnit, FluentAssertions, EF Core SQLite with a real temporary SQLite file, and a mutable fake clock. Do not use the EF in-memory provider for transaction/concurrency tests.

**Service operations:**

```text
GetDashboard, GetStatus, GetWeek, GetHistory
PlanSession, StartSession, StartNewSession
PauseSession, ResumeSession, CompleteSession, RateSession
SkipRatings, CancelSession
AddBookAssignment, SetDefaultBook, CompleteBook, ReorderQueue
Capture, ListInbox, ResolveCapture, PromoteCaptureToNote
PreviewWeeklyReview, CommitWeeklyReview
CheckTargetNotice, LeaseNotifications, AckNotification
DispatchGatewayText
```

**Concurrency:** Use a process-local async command gate plus database constraints and one transaction per command. The database remains the final guard. A duplicate idempotency key returns the stored original response without re-running the command.

**TDD sequence:**

1. baseline and programme initialization;
2. plan/start/pause/resume/complete/rate;
3. restart-safe elapsed time;
4. reported-time override;
5. constrained and recovery sessions;
6. multiple books and mode-default selection;
7. verbatim captures and capture idempotency;
8. queue completion/promotion;
9. weekly qualification and hold;
10. deload/consolidation/volume guard;
11. ISO week and DST boundaries;
12. concurrent UI/MCP retries;
13. invalid state transitions;
14. stale session recovery;
15. exact-once target notification.

Run every language-neutral fixture against the C# service. The Python implementation and C# implementation must agree before UI work begins.

**Commit:** `feat: implement deterministic reading training engine`

---

## 6. Standalone REST API

### Task 5: Expose REST endpoints over the domain service

**Create:**

- `Nostos.Backend/Endpoints/ReadingTrainingEndpoints.cs`

**Modify:**

- `Nostos.Backend/Program.cs`
- `Nostos.Backend/_docs/endpoints.md`

**Endpoints:**

```text
GET    /api/reading/dashboard
GET    /api/reading/status
GET    /api/reading/week?week=YYYY-Www
GET    /api/reading/sessions?from=&to=&bookId=&mode=
POST   /api/reading/sessions/plan
POST   /api/reading/sessions/start
POST   /api/reading/sessions/start-new
POST   /api/reading/sessions/{id}/pause
POST   /api/reading/sessions/{id}/resume
POST   /api/reading/sessions/{id}/complete
POST   /api/reading/sessions/{id}/rate
POST   /api/reading/sessions/{id}/skip-ratings
DELETE /api/reading/sessions/{id}/open
GET    /api/reading/books
POST   /api/reading/books
PATCH  /api/reading/books/{assignmentId}
POST   /api/reading/books/{assignmentId}/finish
GET    /api/reading/inbox
POST   /api/reading/captures
PATCH  /api/reading/captures/{id}
POST   /api/reading/captures/{id}/promote-to-note
POST   /api/reading/reviews/preview
POST   /api/reading/reviews/commit
POST   /api/reading/gateway/dispatch
GET    /api/reading/notifications/lease
POST   /api/reading/notifications/{id}/ack
```

Use typed request records, `ProblemDetails`, validation, cancellation tokens, and explicit 404/409 responses. Add `/mcp` to maintenance-mode protection alongside `/api`.

**Integration tests:** Use `WebApplicationFactory<Program>` with a temporary SQLite database. Add `public partial class Program` if required. Verify REST and service results are equivalent and command retries are exact-once.

**Commit:** `feat: expose reading training REST API`

---

## 7. Standalone Nostos interface

### Design direction

Do not create a generic analytics dashboard. Keep Nostos's existing Lora/Inter typography, neutral surfaces, compact radii, and floating dock. The page's signature is a **three-lane capacity score** resembling parallel book spines: Endurance, Deep, and Recovery each show the active/default book, sustainable target, recent load, and current adaptation state. Use colour only to distinguish mode/state; do not introduce gradients, streak rings, achievement badges, or gamified progress.

### Task 6: Add Angular contracts, service, and state store

**Create:**

- `Nostos.Frontend/src/app/core/dtos/reading-training.dtos.ts`
- `Nostos.Frontend/src/app/core/services/reading-training.service.ts`
- `Nostos.Frontend/src/app/reading-training/reading-training.store.ts`
- corresponding `.spec.ts` files.

The store uses signals and one authoritative dashboard snapshot. After each command, replace or invalidate the snapshot from the server response; do not reproduce domain transitions client-side. Derive the visible timer from server timestamps and resynchronise on focus/reconnect.

While the route is visible, refresh the authoritative snapshot every 30 seconds, immediately after every mutation, on `visibilitychange`, and on window focus. The displayed seconds may tick locally between refreshes, anchored to the last server `elapsedSeconds`; the browser must never send a wall-clock-derived duration back as evidence. Use tabular numerals and `aria-live="off"` on the ticking value, with a separate polite status region for state changes.

### Task 7: Build the complete manual workflow

**Create:**

- `reading-training.component.{ts,html,css,spec.ts}`
- `components/today-session/*`
- `components/capacity-lanes/*`
- `components/active-books/*`
- `components/week-strip/*`
- `components/reading-inbox/*`
- `components/session-history/*`
- `components/session-rating-dialog/*`
- `components/book-assignment-dialog/*`

**Modify:**

- `Nostos.Frontend/src/app/app.routes.ts` — add lazy `/training` route inside `WorkspaceLayout`;
- `Nostos.Frontend/src/app/layout/app-dock/app-dock.component.ts` — add a Reading/Training destination and preserve mobile fit;
- `Nostos.Frontend/src/app/book-detail/book-detail.component.*` — add a small Reading Training section for assigning mode, making default, and viewing recent sessions for that book.

**Manual capabilities required before MCP work:**

- initialize/view programme;
- add several Nostos books to Endurance or Deep;
- choose default and explicit session book;
- set available time/fatigue and plan;
- start, pause, resume, cancel;
- capture thought/question/bookmark verbatim;
- finish and rate or skip ratings;
- resolve the stale-session flow by supplying actual minutes or discarding, without trapping the user in `AwaitingFeedback`;
- view current week and history;
- inspect the reason for the latest progression decision;
- manage inbox and promote a capture into an existing Nostos `NoteModel`;
- finish a training book without deleting the library book.

**Accessibility/responsiveness:**

- keyboard access and visible focus for every control;
- dialogs trap and restore focus;
- status changes use a restrained `aria-live` region;
- touch targets ≥44px on mobile;
- reduced motion respected;
- active timer is not colour-only;
- mobile dock remains usable with the fifth item;
- desktop and mobile screenshots reviewed at real Nostos dimensions.

**Commit:** `feat: add standalone reading training workspace`

---

## 8. Weekly adaptation and notifications

### Task 8: Add background workers with catch-up semantics

**Create:**

- `Nostos.Backend/Workers/ReadingWeeklyReviewWorker.cs`
- `Nostos.Backend/Workers/ReadingNotificationWorker.cs`

**Behaviour:**

- On startup and periodically, commit any missing previous completed ISO week exactly once.
- Default review schedule is Monday 07:00 in configured timezone, but correctness comes from the unique week key, not from the process being alive at exactly 07:00.
- Target-elapsed notices become outbox records exactly once.
- The Nostos UI displays pending notices and can acknowledge them.
- Standalone operation never requires Telegram delivery.

**Tests:** downtime across Monday 07:00, DST transition, duplicate workers, restart after committed review, duplicate target checks.

**Commit:** `feat: add reading review and notification workers`

---

## 9. Generic MCP surface owned by Nostos

### Task 9: Host MCP in the Nostos backend

**Package:** Pin official `ModelContextProtocol.AspNetCore` `2.1.0` after restore verification.

**Create:**

- `Nostos.Backend/Integrations/Mcp/ReadingTrainingMcpTools.cs`
- `Nostos.Backend/Integrations/Mcp/McpAuthenticationMiddleware.cs`
- `Nostos.Backend/Configuration/McpOptions.cs`

**Modify:**

- `Nostos.Backend/Nostos.Backend.csproj`
- `Nostos.Backend/Program.cs`
- `Nostos.Backend/appsettings.json`
- `README.md`

Expose Streamable HTTP at `/mcp`. MCP is generic and contains no Hermes references.

**Tools:**

```text
reading_get_dashboard
reading_get_status
reading_plan_session
reading_start_session
reading_pause_session
reading_resume_session
reading_complete_session
reading_rate_session
reading_cancel_session
reading_capture
reading_answer_now
reading_get_week
reading_list_history
reading_list_books
reading_add_book
reading_set_default_book
reading_finish_book
reading_list_inbox
reading_resolve_capture
reading_preview_review
reading_commit_review
```

Each mutating tool requires an idempotency key and delegates directly to `IReadingTrainingService`. Tool descriptions explain that pages are optional and that effort/focus are ratings, not achievements.

**Configuration/security:**

```json
"Mcp": {
  "Enabled": false,
  "Path": "/mcp",
  "ApiKeyEnvironmentVariable": "NOSTOS_MCP_TOKEN"
}
```

- Nostos works normally with MCP disabled.
- Enabling MCP without the required token fails closed at startup.
- Require `Authorization: Bearer …` on `/mcp`.
- Never expose internal EF entities or filesystem paths.
- Maintenance mode returns 503 for `/mcp`.

**Tests:** MCP tool discovery, JSON schema, auth rejection, each critical command, duplicate command retry, and REST↔MCP equivalence against the same database.

**Commit:** `feat: expose reading training MCP tools`

---

## 10. Optional Hermes gateway connector

### Task 10: Replace the Python owner with a thin Nostos client

Nostos is already complete before this task begins.

**Source optional connector in Nostos:**

- `integrations/hermes/reading-training/plugin.yaml`
- `integrations/hermes/reading-training/__init__.py`
- `integrations/hermes/reading-training/nostos_reading_connector/{client,hooks}.py`
- `integrations/hermes/reading-training/tests/*`
- `integrations/hermes/README.md`

**Deploy to Hermes only after connector tests pass:**

- `/home/dev/.hermes/plugins/reading-coach/`
- `/home/dev/.hermes/skills/productivity/reading-training/SKILL.md`

**Connector responsibilities only:**

1. Confirm owner, Telegram platform, and exact configured Reading thread ID.
2. Ignore every other chat/topic, every slash command except connector-specific commands, and synthetic async/cron deliveries.
3. Forward canonical controls and exact raw message text to Nostos `POST /api/reading/gateway/dispatch`.
4. For model-driven natural language, let Hermes call Nostos MCP tools.
5. Return Nostos's validated reply verbatim.
6. For `answer now`, pause through Nostos and inject only the returned saved question for normal model discussion.
7. Optionally deliver leased Nostos notification-outbox items to the Reading topic, acknowledging only after Telegram confirms delivery.
8. Fail open for ordinary Hermes work. If Nostos is unavailable, explicit reading controls receive a concise availability error; no local fallback state is created.

The connector must contain no progression constants, queue promotion, session timing, weekly calculations, or persistent reading files.

**Obsidian compatibility:** Treat Obsidian as an optional projection, not the source. If retained, mirror a thought only after Nostos has committed it, key the projection by Nostos capture ID, and acknowledge projection status back to Nostos. A capture made directly in Nostos remains valid even if no Obsidian adapter exists.

**Hermes MCP configuration:**

```yaml
mcp_servers:
  nostos:
    url: "http://127.0.0.1:5214/mcp"
    headers:
      Authorization: "Bearer ${NOSTOS_MCP_TOKEN}"
    timeout: 60
```

Use the actual supported Hermes secret-substitution mechanism during implementation; do not embed the token in a tracked file.

**Connector acceptance tests:**

- normal chat while a session runs is untouched;
- only exact Reading thread controls/captures;
- `/restart` and async agent results are never captured;
- duplicate Telegram message ID creates one command/capture;
- Nostos outage creates no divergent local state;
- UI sees MCP/Telegram changes immediately;
- connector deletion leaves standalone Nostos fully functional.

**Commit:** `feat: add optional Hermes reading connector`

---

## 11. Migration and cutover

### Task 11: Build an idempotent Hermes-data importer

**Create:**

- `Nostos.Backend/Services/ReadingTraining/Import/HermesReadingImportService.cs`
- `Nostos.Backend/Endpoints/ReadingTrainingImportEndpoints.cs` or a one-shot CLI command;
- `Nostos.Backend.Tests/ReadingTraining/HermesImportTests.cs`.

**Inputs:** `config.yaml`, `training-state.json`, `active-session.json`, `reading-queue.yaml`, `reading-log.jsonl`, `reading-inbox.jsonl`.

**Rules:**

- dry-run first;
- fingerprint all source files and record one import receipt;
- match books by normalized title + author, then require explicit mapping for ambiguity;
- create missing library books only with explicit confirmation during real cutover;
- preserve legitimate IDs, timestamps, ratings, constraints, and capture text;
- never import known incident pollution or cancelled accidental sessions;
- an open source session must be explicitly completed/cancelled before cutover;
- rerunning the same import is a no-op;
- create a `.nostos` backup before committing import;
- output count/checksum reconciliation.

**Current production note:** After the 2026-08-09 isolation incident was repaired, the Hermes source is idle with empty session/capture JSONL files, baseline 40/30/20, and Candide as the Endurance book. The importer must still be generic and fixture-tested for non-empty future sources.

### Task 12: Perform controlled cutover

1. Back up Nostos and Hermes reading data.
2. Run importer dry-run and inspect mappings/counts.
3. Run importer once and verify dashboard/book/target state.
4. Exercise a full session manually in Nostos.
5. Exercise a separate session through MCP.
6. Exercise Telegram via the thin connector.
7. Restart Nostos during a paused test session and verify elapsed time/persistence.
8. Verify UI, REST, and MCP show one identical state version.
9. Disable the old Hermes reading cron jobs and Python data-writing engine only after all checks pass.
10. Keep the old data read-only for a rollback window; do not dual-write.

**Rollback:** Re-enable the old connector/jobs only if no Nostos-side post-cutover session has been accepted. Once Nostos accepts new sessions, restore Nostos from its pre-cutover backup rather than attempting reverse synchronisation.

---

## 12. End-to-end test and release gate

### Task 13: Add browser E2E tests

**Add:** `@playwright/test` to frontend dev dependencies.

**Create:**

- `Nostos.Frontend/playwright.config.ts`
- `Nostos.Frontend/e2e/reading-training.spec.ts`
- `Nostos.Frontend/e2e/reading-training-mobile.spec.ts`

**Canonical E2E scenario:**

1. Start Nostos with a fresh temporary SQLite database and MCP disabled.
2. Create/import a literature book and a philosophy book.
3. Assign literature to Endurance and philosophy to Deep.
4. Plan and start Deep manually in the browser.
5. Pause, capture a verbatim thought, resume, finish, and rate.
6. Start Endurance later the same test day and complete it separately.
7. Verify history preserves two books, modes, durations, and ratings.
8. Verify capture appears under the correct book and can be promoted to a Nostos note.
9. Restart backend and verify state/history survives.
10. Verify mobile controls and dock at 390×844.

**Cross-surface scenario:**

1. Start session through MCP.
2. Observe active state in Angular.
3. Pause through REST/UI.
4. Capture through MCP with duplicate idempotency key.
5. Complete through UI.
6. Verify one session and one capture in database/history.

### Task 14: Run complete verification matrix

```bash
# Backend + shared + backend tests
dotnet build Nostos.sln --configuration Debug
dotnet test Nostos.sln --configuration Debug

# Frontend
cd Nostos.Frontend
npm ci
npx ng build --configuration development
npx ng test --watch=false
npx playwright test

# Production build
cd ..
dotnet build Nostos.sln --configuration Release
```

Also run:

- EF migration from a copy of the real pre-feature Nostos database;
- backup → restore fixture verification including training rows;
- MCP auth and tool-discovery smoke test with a generic MCP client;
- Nostos startup and manual workflow with Hermes unavailable;
- actual Hermes MCP discovery and one Telegram round trip;
- accessibility scan and keyboard-only pass;
- concurrent command/fault-injection suite;
- `git diff --check` and secret scan.

Record actual pass/fail counts. Existing unrelated Angular TestBed failures must be separated from new failures; new Reading Training tests must all pass.

---

## 13. Independent review, PR, and deployment

### Task 15: Two-stage independent audit

1. **Spec audit:** Compare implementation with this plan and `docs/reading-training/` fixtures. Reject any second state owner, missing manual path, or Hermes runtime dependency.
2. **Code-quality audit:** Review transactions, unique indexes, time/DST logic, endpoint validation, MCP auth, idempotency, backup/restore, UI accessibility, and mobile state.
3. Apply findings through a fresh persistent coding TUI, not through the authoring agent.
4. Re-run the entire verification matrix.
5. Re-audit actual branch HEAD.

### Task 16: Ship through one PR

- Commit in coherent phases listed above.
- Push `feature/issue-<N>-reading-training`.
- Open one PR linked to the issue.
- Do not auto-merge; Christian merges manually.
- PR description must include architecture boundary, schema/migration, MCP security, standalone proof, actual test counts, screenshots, cutover procedure, and rollback.

### Task 17: Deploy and verify live

- Pull merged `main` into the production checkout without disturbing unrelated work.
- Build Release.
- Back up before migration.
- Restart the PM2 process with `PM2_HOME=/home/dev/.pm2`.
- Verify `http://127.0.0.1:5214/api/reading/dashboard`, the Angular `/training` route, and `/mcp` auth/tool discovery.
- Run one reversible fixture session, then remove fixture data through supported test cleanup—not direct DB edits.
- Perform the controlled cutover in Task 12.

---

## 14. Explicit exclusions for the first release

- No social profiles, leaderboards, streaks, badges, or reading goals by pages.
- No cloud sync or multi-user accounts.
- No second database or event broker.
- No Redis, WebSockets, or separate MCP daemon unless measured latency/reliability later requires them.
- No LLM-generated progression decisions.
- No automatic interpretation or rewriting of captured thoughts.
- No direct Nostos dependency on Hermes code, directories, config, or availability.
- No dual-write period between Python and Nostos engines.
- No broad redesign of Nostos Home, Library, Brain, or Studio beyond the new route, dock entry, and book-detail integration.

---

## 15. Final acceptance criteria

The feature is complete only when all statements below are proven by real execution:

- Nostos can create, run, pause, resume, complete, rate, and review sessions entirely through its UI with Hermes absent.
- Two different books can be read in separate sessions on the same day, with correct book/mode history and captures.
- Restarting Nostos cannot lose or double-count an active/paused/completed session.
- REST, MCP, UI, and Telegram connector always report the same state version.
- Retried UI/MCP/Telegram commands create exactly one effect.
- Weekly progression is deterministic, independent by mode, idempotent, and explainable.
- Constrained and recovery sessions cannot count as failures or progression evidence.
- Captures remain verbatim and attach to the correct book.
- Nostos backup/restore includes all Reading Training data.
- MCP is authenticated, optional, generic, and removable without affecting the feature.
- Removing or disabling the Hermes connector leaves every Nostos Reading Training capability available manually.
- Ordinary Hermes chats, slash commands, and background deliveries remain untouched while a reading session is active.
- The old Hermes engine and cron jobs are disabled only after successful migration and cross-surface live verification.
