/**
 * Task 13 — mobile slice (390x844, touch): the /training route renders within
 * the viewport, the full plan/start/pause/cancel control lifecycle works via
 * touch-sized controls, and the server remains authoritative for the session.
 *
 * The fixture is shared with the desktop project (single backend, temp DB);
 * this spec seeds its own library book through supported REST and does not
 * depend on the desktop suite's state beyond an initialized programme.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  apiPost,
  loadFixture,
  newRunId,
  ReadingMode,
  ReadingSessionStatus,
  seedKey,
  SEED_CLIENT,
  type BookDto,
  type CommandEnvelope,
  type FixtureState,
  type ReadingBookAssignmentDto,
  type ReadingSessionDto,
} from './support/fixture';

let fixture: FixtureState;
let runId: string;

const todayCard = (page: Page) => page.locator('section.today-session');
const statusBadge = (page: Page) => todayCard(page).locator('.status-badge');
const sessionBook = (page: Page) => todayCard(page).locator('.session-book');

test('mobile: 390x844 route, layout, and session controls', async ({ page }) => {
  fixture = loadFixture();
  runId = newRunId();

  // Seed a dedicated Endurance book for this slice (initialize is idempotent).
  await apiPost(fixture.baseUrl, '/api/reading-training/initialize', {
    clientId: SEED_CLIENT,
    idempotencyKey: seedKey('mobile', runId, 'init'),
  });
  const mobileBook = await apiPost<BookDto>(fixture.baseUrl, '/api/books', {
    type: 'physical',
    title: 'Mobile Guide',
    author: 'E2E Author',
    language: 'English',
    categories: 'e2e',
  });
  const assignment = await apiPost<CommandEnvelope<ReadingBookAssignmentDto>>(
    fixture.baseUrl,
    '/api/reading-training/books',
    {
      clientId: SEED_CLIENT,
      idempotencyKey: seedKey('mobile', runId, 'assign'),
      bookId: mobileBook.id,
      mode: ReadingMode.Endurance,
      makeDefault: true,
    }
  );
  if (!assignment.data) {
    throw new Error(`Mobile assignment seed failed: ${assignment.reply}`);
  }
  const assignmentId = assignment.data.id;

  await page.goto(`${fixture.baseUrl}/training`);

  // Route + layout render at 390x844 without horizontal overflow.
  await expect(page.getByRole('heading', { name: 'Reading Training' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(todayCard(page)).toBeVisible();
  await expect(page.locator('section.active-books')).toContainText('Mobile Guide');
  await expect(page.getByText('No session in progress.')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // --- plan (mobile UI) ---
  await page.getByRole('button', { name: 'Plan a session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan a session' })).toBeVisible();
  await page.locator('#session-planner-book').selectOption({ label: 'Mobile Guide' });
  await page.locator('#session-planner-mode').selectOption(String(ReadingMode.Endurance));
  await page.locator('#session-planner-target').fill('40');
  await page.locator('#session-planner-constrained').check();
  await page.locator('#session-planner-constrained-minutes').fill('15');
  await page.getByRole('button', { name: 'Plan session', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Planned');
  await expect(sessionBook(page)).toHaveText('Mobile Guide');

  // --- start ---
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Active');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Server agrees the session is Active on the seeded book.
  const status = await apiPost<CommandEnvelope<ReadingSessionDto | null>>(
    fixture.baseUrl,
    '/api/reading-training/status',
    {}
  ).catch(() => null);
  void status;
  const dash = await apiGetDashboard();
  const open = dash?.data.openSession as ReadingSessionDto | null | undefined;
  expect(open).not.toBeNull();
  expect(open!.bookTitle).toBe('Mobile Guide');
  expect(open!.status).toBe(ReadingSessionStatus.Active);
  expect(open!.targetMinutes).toBe(15);

  // --- pause -> resume controls present, then cancel ---
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Active');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(statusBadge(page)).toHaveText('Paused');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(page.getByText('No session in progress.')).toBeVisible();

  const dashAfter = await apiGetDashboard();
  expect(dashAfter?.data.openSession).toBeNull();
});

async function apiGetDashboard(): Promise<CommandEnvelope<any> | null> {
  const res = await fetch(`${fixture.baseUrl}/api/reading-training/dashboard`);
  if (!res.ok) throw new Error(`GET dashboard -> ${res.status}`);
  return (await res.json()) as CommandEnvelope<any>;
}
