/**
 * Task 13 — cross-surface E2E (desktop Chromium): UI lifecycle, backend
 * restart persistence, REST/UI/MCP state-version agreement, direct MCP wire
 * tail with exact-once idempotency replay, weekly review, and keyboard/focus/
 * aria checks. Runs serially (single worker, single shared backend fixture).
 *
 * Seeding always goes through the supported REST surface (never the live DB);
 * the only fixture control used mid-suite is `restart` (same temp DB + token,
 * new backend process) to prove persistence across a backend restart.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  apiGet,
  apiPost,
  loadFixture,
  newRunId,
  ReadingCaptureType,
  ReadingMode,
  ReadingSessionStatus,
  seedKey,
  seedTrainingState,
  SEED_CLIENT,
  type CommandEnvelope,
  type FixtureState,
  type ReadingBookAssignmentDto,
  type ReadingCaptureDto,
  type ReadingSessionDto,
} from './support/fixture';
import { McpSession, mcpCommand } from './support/mcp-client';

test.describe.configure({ mode: 'serial' });

const LAUNCHER = path.join(__dirname, 'support', 'launch-fixture.mjs');

let fixture: FixtureState;
let runId: string;
let candideAssignment: ReadingBookAssignmentDto;
let meditationsAssignment: ReadingBookAssignmentDto;
let meditationsBookId: string;

// --- shared UI helpers ------------------------------------------------------

const todayCard = (page: Page) => page.locator('section.today-session');
const statusBadge = (page: Page) => todayCard(page).locator('.status-badge');
const sessionBook = (page: Page) => todayCard(page).locator('.session-book');
const elapsed = (page: Page) => todayCard(page).locator('.elapsed');

function elapsedSeconds(page: Page): Promise<number> {
  return elapsed(page).textContent().then((text) => {
    const match = /(\d{2}):(\d{2})/.exec(text ?? '');
    if (!match) return -1;
    return Number(match[1]) * 60 + Number(match[2]);
  });
}

/** Refresh the dashboard from the toolbar (icon button, rendered once loaded). */
async function refreshDashboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Refresh reading training' }).click();
}

async function openPlanner(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Plan a session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan a session' })).toBeVisible();
}

async function planViaPlanner(
  page: Page,
  bookLabel: string,
  modeValue: string,
  targetMinutes: string
): Promise<void> {
  await openPlanner(page);
  await page.locator('#session-planner-book').selectOption({ label: bookLabel });
  await page.locator('#session-planner-mode').selectOption(modeValue);
  await page.locator('#session-planner-target').fill(targetMinutes);
  await page.getByRole('button', { name: 'Plan session', exact: true }).click();
}

/**
 * Completes the open session through the today-session card. The concurrent
 * UI repair exposes a Finish control on Active/Paused; where the card also
 * offers an actual-minutes input at that point it is filled first so the
 * server receives the reported minutes with the finish command.
 */
async function finishOpenSession(page: Page, minutes?: string): Promise<void> {
  const card = todayCard(page);
  const minutesInput = card.locator('input[aria-label="Actual minutes read"]');
  if (await minutesInput.count()) {
    await minutesInput.fill(minutes ?? '');
  }
  const finish = card.getByRole('button', { name: /^(Finish|Complete)$/ });
  await finish.click();
}

async function restartBackend(): Promise<void> {
  const result = spawnSync(process.execPath, [LAUNCHER, 'restart'], {
    stdio: 'inherit',
    timeout: 300_000,
  });
  expect(result.status, `fixture restart exited ${result.status}`).toBe(0);
  fixture = loadFixture(); // state file rewritten with the new pid
}

function statusReply(page: Page) {
  return todayCard(page).locator('.status-region');
}

async function openSessionViaRest(): Promise<ReadingSessionDto | null> {
  const envelope = await apiGet<CommandEnvelope<ReadingSessionDto | null>>(
    fixture.baseUrl,
    '/api/reading-training/status'
  );
  return envelope.data;
}

// --- suite ------------------------------------------------------------------

test('desktop: setup panel initializes the programme; REST seeds two books', async ({ page }) => {
  fixture = loadFixture();
  runId = newRunId();

  await page.goto(`${fixture.baseUrl}/training`);

  // Not-initialized state renders the setup panel.
  await expect(
    page.getByRole('heading', { name: 'Reading training is not set up yet' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Set up reading training' }).click();

  // Dashboard renders after initialize.
  await expect(page.getByRole('heading', { name: 'Reading Training' })).toBeVisible();
  await expect(page.getByText('No session in progress.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active books' })).toBeVisible();
  await expect(page.getByText('No training books yet.')).toBeVisible();

  // The single mutation so far is initialize -> stateVersion "1".
  const dash = await apiGet<CommandEnvelope<any>>(fixture.baseUrl, '/api/reading-training/dashboard');
  expect(dash.stateVersion).toBe('1');
  expect(dash.data.programme).toBeTruthy();
  await expect(page.locator('.reading-training-page')).toHaveAttribute('data-state-version', '1');

  // Seed two library books + mode assignments through supported REST.
  const seed = await seedTrainingState(fixture.baseUrl, runId);
  candideAssignment = seed.candideAssignment;
  meditationsAssignment = seed.meditationsAssignment;
  meditationsBookId = seed.meditations.id;

  // The UI picks them up on refresh.
  await refreshDashboard(page);
  await expect(page.locator('section.active-books')).toContainText('Candide');
  await expect(page.locator('section.active-books')).toContainText('Meditations');
  await expect(page.locator('section.active-books')).toContainText('Default');
  const capacityLanes = page.getByLabel('Reading capacity lanes');
  await expect(capacityLanes.getByRole('heading', { name: 'Endurance' })).toBeVisible();
  await expect(capacityLanes.getByRole('heading', { name: 'Deep' })).toBeVisible();
  await expect(capacityLanes.getByRole('heading', { name: 'Recovery' })).toBeVisible();
});

test('desktop: finishing a book is reversible and the planner opens as a dialog', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/training`);

  await page.getByRole('button', { name: 'Finish training book: Candide' }).click();
  const finishedCandide = page.locator('.finished-item').filter({ hasText: 'Candide' });
  await expect(finishedCandide).toContainText('Finished');
  await expect(finishedCandide.getByRole('button', { name: /Return Candide to the Deep queue/ })).toBeVisible();

  await finishedCandide.getByRole('button', { name: /Return Candide to the Deep queue/ }).click();
  await expect(page.locator('.queue-item').filter({ hasText: 'Candide' })).toBeVisible();

  await openPlanner(page);
  const planner = page.getByRole('dialog', { name: 'Plan a session' });
  await expect(planner).toBeVisible();
  await expect(planner).toBeFocused();
  await expect(page.locator('#session-planner-book option', { hasText: 'Candide' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(planner).toBeHidden();
});

test('desktop: full session lifecycle survives a backend restart', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/training`);
  await expect(page.locator('section.active-books')).toContainText('Candide');

  // --- plan (UI) ---
  await planViaPlanner(page, 'Candide', String(ReadingMode.Deep), '30');
  await expect(statusBadge(page)).toHaveText('Planned');
  await expect(todayCard(page)).toContainText('30 min');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(statusReply(page)).not.toBeEmpty();

  let rest = await openSessionViaRest();
  expect(rest).not.toBeNull();
  expect(rest!.bookTitle).toBe('Candide');
  expect(rest!.mode).toBe(ReadingMode.Deep);
  expect(rest!.status).toBe(ReadingSessionStatus.Planned);
  expect(rest!.targetMinutes).toBe(30);
  const plannedId = rest!.id;

  // --- start (UI) ---
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Active');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Elapsed ticks locally while Active.
  await expect.poll(() => elapsedSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  const t1 = await elapsedSeconds(page);
  await page.waitForTimeout(2_100);
  const t2 = await elapsedSeconds(page);
  expect(t2).toBeGreaterThanOrEqual(t1 + 1);

  // --- pause (UI) ---
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();

  rest = await openSessionViaRest();
  expect(rest!.id).toBe(plannedId);
  expect(rest!.status).toBe(ReadingSessionStatus.Paused);
  expect(rest!.accumulatedSeconds).toBeGreaterThanOrEqual(1);

  // --- backend restart: same temp DB, new process ---
  await restartBackend();

  // --- recover (UI): the paused session must have persisted ---
  await page.reload();
  await expect(sessionBook(page)).toHaveText('Candide');
  await expect(statusBadge(page)).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();

  // --- resume (UI) ---
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Active');

  // --- finish (UI): Active -> AwaitingFeedback ---
  await finishOpenSession(page, '44');
  await expect(page.getByRole('heading', { name: 'Session feedback' })).toBeVisible();

  rest = await openSessionViaRest();
  expect(rest!.id).toBe(plannedId);
  expect(rest!.status).toBe(ReadingSessionStatus.AwaitingFeedback);

  // --- rate (UI): AwaitingFeedback -> Completed ---
  await page.locator('#session-feedback-minutes').fill('44');
  await page.locator('#session-feedback-effort').fill('7');
  await page.locator('#session-feedback-focus').fill('6');
  await page.getByRole('button', { name: 'Log ratings', exact: true }).click();

  await expect(page.getByText('No session in progress.')).toBeVisible();

  // --- exact history row (book / mode / status / ratings) ---
  const firstRow = page.locator('ul.session-list li.session-item').first();
  await expect(firstRow.locator('.session-book')).toHaveText('Candide');
  await expect(firstRow.locator('.mode-tag')).toHaveText('Deep');
  await expect(firstRow.locator('.status-tag')).toHaveText('Completed');
  await expect(firstRow).toContainText('Effort 7 · Focus 6');

  const history = await apiGet<CommandEnvelope<ReadingSessionDto[]>>(
    fixture.baseUrl,
    '/api/reading-training/history'
  );
  expect(history.data!.length).toBe(1);
  const done = history.data![0];
  expect(done.id).toBe(plannedId);
  expect(done.bookTitle).toBe('Candide');
  expect(done.mode).toBe(ReadingMode.Deep);
  expect(done.status).toBe(ReadingSessionStatus.Completed);
  expect(done.effort).toBe(7);
  expect(done.focus).toBe(6);
  expect(done.ratingsSkipped).toBe(false);
});

test('desktop: second-book session same day with verbatim capture', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/training`);

  // --- plan + start a second session on the other book (same day) ---
  await planViaPlanner(page, 'Meditations', String(ReadingMode.Endurance), '25');
  await expect(statusBadge(page)).toHaveText('Planned');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Active');
  await expect(sessionBook(page)).toHaveText('Meditations');

  const active = await openSessionViaRest();
  expect(active).not.toBeNull();
  expect(active!.bookTitle).toBe('Meditations');
  expect(active!.mode).toBe(ReadingMode.Endurance);

  // --- verbatim capture through the UI while the session is open ---
  const verbatim = '  Why   so   brief?  ';
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
  await page.locator('#capture-form-type').selectOption(String(ReadingCaptureType.Question));
  await page.locator('#capture-form-text').fill(verbatim);
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Capture' })).toBeHidden();

  // Server inbox: exact text, type, book and session attachment.
  const inbox = await apiGet<CommandEnvelope<ReadingCaptureDto[]>>(
    fixture.baseUrl,
    '/api/reading-training/inbox'
  );
  expect(inbox.data!.length).toBe(1);
  const capture = inbox.data![0];
  expect(capture.text).toBe(verbatim);
  expect(capture.type).toBe(ReadingCaptureType.Question);
  expect(capture.bookId).toBe(meditationsBookId);
  expect(capture.sessionId).toBe(active!.id);
  expect(capture.resolved).toBe(false);

  // UI inbox renders the exact text with the book title.
  await refreshDashboard(page);
  await expect(page.locator('section.reading-inbox')).toContainText(verbatim);
  await expect(page.locator('section.reading-inbox')).toContainText('Meditations');

  // --- finish + skip ratings ---
  await finishOpenSession(page);
  await expect(page.getByRole('heading', { name: 'Session feedback' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip ratings', exact: true }).click();
  await expect(page.getByText('No session in progress.')).toBeVisible();

  // --- history now has both sessions ---
  const history = await apiGet<CommandEnvelope<ReadingSessionDto[]>>(
    fixture.baseUrl,
    '/api/reading-training/history'
  );
  expect(history.data!.length).toBe(2);
  const newest = history.data![0];
  expect(newest.bookTitle).toBe('Meditations');
  expect(newest.mode).toBe(ReadingMode.Endurance);
  expect(newest.status).toBe(ReadingSessionStatus.Completed);
  expect(newest.ratingsSkipped).toBe(true);
  const first = history.data![1];
  expect(first.bookTitle).toBe('Candide');
  expect(first.status).toBe(ReadingSessionStatus.Completed);

  const row = page.locator('ul.session-list li.session-item').first();
  await expect(row.locator('.session-book')).toHaveText('Meditations');
  await expect(row.locator('.mode-tag')).toHaveText('Endurance');
  await expect(row).toContainText('Ratings skipped');
});

test('desktop: weekly review preview then commit from the UI', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/training`);

  const dashBefore = await apiGet<CommandEnvelope<any>>(
    fixture.baseUrl,
    '/api/reading-training/dashboard'
  );
  const weekKey = dashBefore.data.currentWeek.weekKey as string;
  expect(dashBefore.data.currentWeek.reviewCommitted).toBe(false);
  expect(dashBefore.data.currentWeek.completedSessions).toBe(2);

  await page.getByRole('button', { name: 'Review week', exact: true }).click();
  const dialog = page.locator('section.dialog[aria-labelledby="weekly-review-title"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(weekKey);
  await expect(dialog).toContainText('min this week');
  await expect(dialog.getByRole('heading', { name: 'Endurance' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Deep' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Recovery' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Commit weekly review', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Strip flips to the committed note; the server confirms reviewCommitted.
  await expect(page.locator('section.week-strip')).toContainText('Weekly review committed');
  await expect
    .poll(async () => {
      const dash = await apiGet<CommandEnvelope<any>>(
        fixture.baseUrl,
        '/api/reading-training/dashboard'
      );
      return dash.data.currentWeek.reviewCommitted as boolean;
    })
    .toBe(true);
});

test('desktop: REST, UI, and MCP agree on stateVersion after mutations', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/training`);

  const dash0 = await apiGet<CommandEnvelope<any>>(fixture.baseUrl, '/api/reading-training/dashboard');
  const v0 = dash0.stateVersion as string;
  expect(v0).toBeTruthy();
  await expect(page.locator('.reading-training-page')).toHaveAttribute('data-state-version', v0);

  // Read-only MCP surfaces agree with REST on the same envelope version.
  const mcpDash = await mcpCommand(fixture, 'reading_get_dashboard', {});
  expect(mcpDash.stateVersion).toBe(v0);
  const mcpStatus = await mcpCommand(fixture, 'reading_get_status', {});
  expect(mcpStatus.stateVersion).toBe(v0);
  expect(mcpStatus.data ?? null).toBeNull();

  // One UI mutation: plan a session.
  await planViaPlanner(page, 'Candide', String(ReadingMode.Deep), '30');
  await expect(statusBadge(page)).toHaveText('Planned');

  const dash1 = await apiGet<CommandEnvelope<any>>(fixture.baseUrl, '/api/reading-training/dashboard');
  const v1 = dash1.stateVersion as string;
  expect(v1).toBe((Number(v0) + 1).toString());
  await expect(page.locator('.reading-training-page')).toHaveAttribute('data-state-version', v1);

  // REST and MCP report the identical open session and version.
  const restStatus = await openSessionViaRest();
  expect(restStatus).not.toBeNull();
  const mcpStatus2 = await mcpCommand(fixture, 'reading_get_status', {});
  expect(mcpStatus2.stateVersion).toBe(v1);
  expect(mcpStatus2.data.id).toBe(restStatus!.id);
  const mcpDash2 = await mcpCommand(fixture, 'reading_get_dashboard', {});
  expect(mcpDash2.stateVersion).toBe(v1);
  expect(mcpDash2.data.openSession.id).toBe(restStatus!.id);

  // The UI is showing the same server session (book + mode + status).
  await expect(sessionBook(page)).toHaveText('Candide');
  await expect(statusBadge(page)).toHaveText('Planned');
  expect(restStatus!.bookTitle).toBe('Candide');
  expect(restStatus!.mode).toBe(ReadingMode.Deep);
  expect(restStatus!.status).toBe(ReadingSessionStatus.Planned);

  // Clean up the planned session (cancel from Planned is valid server-side).
  const cancelled = await apiPost<CommandEnvelope<ReadingSessionDto>>(
    fixture.baseUrl,
    '/api/reading-training/sessions/cancel',
    { clientId: SEED_CLIENT, idempotencyKey: seedKey('cleanup', runId, 'cancel-planned') }
  );
  expect(cancelled.data!.status).toBe(ReadingSessionStatus.Cancelled);
});

test('desktop: direct MCP wire tail (complete -> rate -> cancel) with exact-once replay', async () => {
  const historyBefore = await apiGet<CommandEnvelope<ReadingSessionDto[]>>(
    fixture.baseUrl,
    '/api/reading-training/history'
  );
  const initialHistoryCount = historyBefore.data!.length;

  const session = new McpSession(fixture);
  await session.connect();
  try {
    // --- complete -> rate tail on Candide ---
    const plan = await session.command('reading_plan_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire-plan'),
      bookAssignmentId: candideAssignment.id,
      mode: ReadingMode.Deep,
      targetMinutes: 30,
    });
    expect(plan.data.status).toBe('Planned');
    const wireSessionId = plan.data.id as string;

    const started = await session.command('reading_start_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire-start'),
    });
    expect(started.data.status).toBe('Active');
    expect(started.data.id).toBe(wireSessionId);

    const completed = await session.command('reading_complete_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire-complete'),
    });
    expect(completed.data.status).toBe('AwaitingFeedback');

    const rated = await session.command('reading_rate_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire-rate'),
      effort: 8,
      focus: 7,
      rating: 4,
    });
    expect(rated.data.status).toBe('Completed');
    expect(rated.data.id).toBe(wireSessionId);

    // History now carries the MCP-completed session with its ratings.
    const history = await apiGet<CommandEnvelope<ReadingSessionDto[]>>(
      fixture.baseUrl,
      '/api/reading-training/history'
    );
    expect(history.data!.length).toBe(initialHistoryCount + 1);
    const newest = history.data![0];
    expect(newest.id).toBe(wireSessionId);
    expect(newest.bookTitle).toBe('Candide');
    expect(newest.mode).toBe(ReadingMode.Deep);
    expect(newest.status).toBe(ReadingSessionStatus.Completed);
    expect(newest.effort).toBe(8);
    expect(newest.focus).toBe(7);
    expect(newest.rating).toBe(4);

    // --- exact-once replay: same key, same envelope, no second effect ---
    const replay = await session.command('reading_rate_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire-rate'),
      effort: 8,
      focus: 7,
      rating: 4,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.data.id).toBe(rated.data.id);
    expect(replay.stateVersion).toBe(rated.stateVersion);
    expect(replay.data.status).toBe('Completed');

    const historyAfterReplay = await apiGet<CommandEnvelope<ReadingSessionDto[]>>(
      fixture.baseUrl,
      '/api/reading-training/history'
    );
    expect(historyAfterReplay.data!.length).toBe(initialHistoryCount + 1);

    // --- cancel tail on Meditations ---
    const plan2 = await session.command('reading_plan_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire2-plan'),
      bookAssignmentId: meditationsAssignment.id,
      mode: ReadingMode.Endurance,
      targetMinutes: 20,
    });
    expect(plan2.data.status).toBe('Planned');
    const cancelSessionId = plan2.data.id as string;

    await session.command('reading_start_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire2-start'),
    });
    const cancelled = await session.command('reading_cancel_session', {
      idempotencyKey: seedKey('mcp', runId, 'wire2-cancel'),
    });
    expect(cancelled.data.status).toBe('Cancelled');
    expect(cancelled.data.id).toBe(cancelSessionId);

    const history2 = await apiGet<CommandEnvelope<ReadingSessionDto[]>>(
      fixture.baseUrl,
      '/api/reading-training/history'
    );
    expect(history2.data!.length).toBe(initialHistoryCount + 2);
    expect(history2.data![0].id).toBe(cancelSessionId);
    expect(history2.data![0].status).toBe(ReadingSessionStatus.Cancelled);
  } finally {
    await session.close();
  }

  // --- REST-side exact-once replay on the same shared service ---
  const restPlan = await apiPost<CommandEnvelope<ReadingSessionDto>>(
    fixture.baseUrl,
    '/api/reading-training/sessions/plan',
    {
      clientId: SEED_CLIENT,
      idempotencyKey: seedKey('rest', runId, 'replay-plan'),
      bookAssignmentId: candideAssignment.id,
      mode: ReadingMode.Deep,
      targetMinutes: 30,
    }
  );
  expect(restPlan.data.status).toBe(ReadingSessionStatus.Planned);
  expect(restPlan.duplicate).toBe(false);
  const restPlanId = restPlan.data?.id ?? (() => {
    throw new Error(`REST plan returned no data: ${JSON.stringify(restPlan)}`);
  })();

  const restPlanReplay = await apiPost<CommandEnvelope<ReadingSessionDto>>(
    fixture.baseUrl,
    '/api/reading-training/sessions/plan',
    {
      clientId: SEED_CLIENT,
      idempotencyKey: seedKey('rest', runId, 'replay-plan'),
      bookAssignmentId: candideAssignment.id,
      mode: ReadingMode.Deep,
      targetMinutes: 30,
    }
  );
  expect(restPlanReplay.duplicate).toBe(true);
  expect(restPlanReplay.data?.id).toBe(restPlanId);
  expect(restPlanReplay.stateVersion).toBe(restPlan.stateVersion);

  // Exactly one open session on the server after the replay.
  const status = await openSessionViaRest();
  expect(status).not.toBeNull();
  expect(status!.id).toBe(restPlanId);
  const dash = await apiGet<CommandEnvelope<any>>(fixture.baseUrl, '/api/reading-training/dashboard');
  expect(dash.data.openSession.id).toBe(restPlanId);

  const restCancel = await apiPost<CommandEnvelope<ReadingSessionDto>>(
    fixture.baseUrl,
    '/api/reading-training/sessions/cancel',
    { clientId: SEED_CLIENT, idempotencyKey: seedKey('rest', runId, 'replay-cancel') }
  );
  expect(restCancel.data!.status).toBe(ReadingSessionStatus.Cancelled);
});

test('desktop: keyboard, focus, and aria on dialogs and controls', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/training`);
  await expect(page.locator('section.active-books')).toContainText('Candide');

  // --- capture dialog: focus, roles, tab wrap, escape restore ---
  const captureTrigger = page.getByRole('button', { name: 'Capture', exact: true });
  await captureTrigger.click();
  const dialog = page.locator('section.dialog[aria-labelledby="capture-dialog-title"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toBeFocused();

  const closeButton = dialog.getByRole('button', { name: 'Close capture dialog' });
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  // Tab through select -> textarea -> save, then wrap back to close.
  await page.keyboard.press('Tab');
  await expect(dialog.locator('#capture-form-type')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('#capture-form-text')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Save capture', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(captureTrigger).toBeFocused();

  // --- planner validation surfaces a labelled alert ---
  await openPlanner(page);
  await page.locator('#session-planner-target').fill('');
  await page.getByRole('button', { name: 'Plan session', exact: true }).click();
  const targetError = page.locator('#session-planner-target-error');
  await expect(targetError).toBeVisible();
  await expect(targetError).toHaveAttribute('role', 'alert');
  await expect(page.locator('#session-planner-target')).toHaveAttribute(
    'aria-describedby',
    'session-planner-target-error'
  );

  // A successful command creates the conditional polite reply region.
  await page.locator('#session-planner-target').fill('30');
  await page.getByRole('button', { name: 'Plan session', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Planned');
  await expect(statusReply(page)).toHaveAttribute('aria-live', 'polite');
  await apiPost<CommandEnvelope<ReadingSessionDto>>(
    fixture.baseUrl,
    '/api/reading-training/sessions/cancel',
    { clientId: SEED_CLIENT, idempotencyKey: seedKey('cleanup', runId, 'cancel-a11y-plan') }
  );

  // --- active-books control labels and disabled reorder edges ---
  await expect(page.getByRole('button', { name: 'Move Candide up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Candide down' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Meditations up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Meditations down' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finish training book: Candide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh reading training' })).toBeVisible();

  // --- reduced motion: the dashboard honors prefers-reduced-motion ---
  const refreshButton = page.getByRole('button', { name: 'Refresh reading training' });
  const dashboardRoute = '**/api/reading/dashboard';
  const delayedDashboard = async (route: import('@playwright/test').Route): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  };

  // Baseline: inspect the actual spinner rendered during a delayed refresh.
  await page.route(dashboardRoute, delayedDashboard);
  await refreshButton.click();
  const refreshSpinner = refreshButton.locator('.refresh-spinner');
  await expect(refreshSpinner).toBeVisible();
  expect(
    await refreshSpinner.evaluate((spinner) => getComputedStyle(spinner, '::after').animationName)
  ).toContain('rt-spin');
  await expect(refreshSpinner).toBeHidden();
  await page.unroute(dashboardRoute, delayedDashboard);

  // With the media query active the same real affordance must not animate.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  ).toBe(true);
  await page.route(dashboardRoute, delayedDashboard);
  await refreshButton.click();
  await expect(refreshSpinner).toBeVisible();
  expect(
    await refreshSpinner.evaluate((spinner) => getComputedStyle(spinner, '::after').animationName)
  ).toBe('none');
  await expect(refreshSpinner).toBeHidden();
  await page.unroute(dashboardRoute, delayedDashboard);

});
