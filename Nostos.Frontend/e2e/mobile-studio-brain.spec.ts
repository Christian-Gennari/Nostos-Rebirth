/**
 * Mobile polish geometry — Studio and Second Brain at phone width.
 *
 * Geometry-only assertions (no pixel snapshots), matching the approach in
 * `mobile-dock.spec.ts`: stable across styling work, loud when layout regresses.
 *
 * Each guard maps to a defect measured at 390x844 on the real build:
 *
 *  - The editor's formatting toolbar wrapped to FOUR rows (124px of the writing
 *    surface) because the Oxide skin's `flex-wrap: wrap` beat TinyMCE's
 *    `toolbar_mode: 'sliding'`, which only engages while the toolbar is a
 *    single row. The sliding overflow button therefore never rendered and every
 *    control stayed in the document.
 *  - The Studio's document tree is the only way to open a document, but its
 *    chevrons were 12x20px and its row actions 22x22px.
 *  - Brain's "Back to Index" is the only exit from the concept detail sheet
 *    (the index column is display:none while a concept is open) yet it was a
 *    static block at the top of the scrolling column, so it left the viewport
 *    permanently once the sheet was scrolled.
 *
 * The spec runs in the mobile-chromium project (playwright.config.ts matches
 * `mobile.*.spec.ts`).
 */
import { expect, test, type Page } from '@playwright/test';

import { apiPost, loadFixture } from './support/fixture';
import { apiPut } from './support/visual-capture';

const MIN_TAP_TARGET = 44; // CSS px, Apple HIG / Material minimum

let fixture: ReturnType<typeof loadFixture>;

test.beforeAll(() => {
  fixture = loadFixture();
});

/** Seed one document through the supported REST surface (as the visual matrix does). */
async function seedDocument(title: string): Promise<void> {
  const created = await apiPost<{ id: string }>(fixture.baseUrl, '/api/writings', {
    name: title,
    type: 'Document',
    parentId: null,
  });
  await apiPut(fixture.baseUrl, `/api/writings/${created.id}`, {
    name: title,
    content:
      '# Mobile Polish\n\nA paragraph of representative prose so the editor has a ' +
      'visible writing surface after the chrome is measured.',
  });
}

/** Seed a folder that has children. Returns the folder id (the row with a chevron). */
async function seedNestedFolder(): Promise<string> {
  const stamp = Date.now();
  const parent = await apiPost<{ id: string }>(fixture.baseUrl, '/api/writings', {
    name: `MobilePolishFolder-${stamp}`,
    type: 'Folder',
    parentId: null,
  });
  await apiPost(fixture.baseUrl, '/api/writings', {
    name: `MobilePolishChild-${stamp}`,
    type: 'Document',
    parentId: parent.id,
  });
  return parent.id;
}

/** Open the Studio at phone width, reveal the drawer, open the seeded document. */
async function openStudioDocument(page: Page, title: string): Promise<void> {
  await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
  // The tree lives in a drawer that is closed at rest at phone width.
  const openSidebar = page.getByRole('button', { name: 'Open Sidebar' });
  if (await openSidebar.isVisible().catch(() => false)) {
    await openSidebar.click();
  }
  const row = page.locator('.file-list .tree-row', { hasText: title }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.locator('.tox-tinymce').waitFor({ timeout: 45_000 });
  await page.waitForTimeout(600); // let TinyMCE finish laying the toolbar out
}

test('the editor formatting toolbar occupies a single row on a phone', async ({ page }) => {
  const title = `MobilePolishRow-${Date.now()}`;
  await seedDocument(title);
  await openStudioDocument(page, title);

  const tops = await page
    .locator('.tox-toolbar__primary .tox-toolbar__group')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => Math.round(el.getBoundingClientRect().top)),
    );
  expect(tops.length, 'the toolbar must render at least one group').toBeGreaterThan(0);

  const rows = new Set(tops);
  expect(
    rows.size,
    `the formatting toolbar must be a single row, found ${rows.size} ` +
      `(the Oxide skin's flex-wrap defeated toolbar_mode: sliding)`,
  ).toBe(1);

  const height = await page
    .locator('.tox-toolbar__primary')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(height, 'a single toolbar row must not exceed ~60px').toBeLessThanOrEqual(60);
});

test('every editor toolbar button meets the 44px touch contract', async ({ page }) => {
  const title = `MobilePolishTargets-${Date.now()}`;
  await seedDocument(title);
  await openStudioDocument(page, title);

  // Both rows: __primary is what is visible at rest, __overflow is where the
  // sliding mode parks the remaining controls. Most formatting tools live in
  // the overflow on a phone, so it must meet the same contract.
  const slivers = await page
    .locator('.tox-toolbar__primary .tox-tbtn, .tox-toolbar__overflow .tox-tbtn')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({
          label: el.getAttribute('aria-label') ?? '?',
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height),
        }))
        .filter((b) => b.width < 44 || b.height < 44),
    );

  expect(slivers, `toolbar buttons under 44px: ${JSON.stringify(slivers)}`).toEqual([]);
});

test('the sliding overflow control reveals the collapsed formatting buttons', async ({ page }) => {
  const title = `MobilePolishOverflow-${Date.now()}`;
  await seedDocument(title);
  await openStudioDocument(page, title);

  const overflow = page.locator('.tox-toolbar__primary .tox-tbtn[aria-label*="additional"]');
  await expect(
    overflow,
    'a single toolbar row must give TinyMCE an overflow chevron to slide into',
  ).toBeVisible();
  await overflow.click();
  await page.waitForTimeout(400);

  // The collapsed controls must actually be reachable, not merely listed.
  const revealed = page.locator('.tox-toolbar__overflow--open .tox-tbtn');
  await expect(revealed.first(), 'the overflow row must open').toBeVisible();
  const count = await revealed.count();
  expect(count, 'the overflow must expose the collapsed formatting controls').toBeGreaterThan(0);

  const overflowHeight = await page
    .locator('.tox-toolbar__overflow--open')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(overflowHeight, 'the overflow row must not be a zero-height stub').toBeGreaterThan(20);
});

test('the studio document tree exposes 44px expand chevrons', async ({ page }) => {
  // A chevron only exists on a row that HAS children, so seed a nested folder:
  // the folder row gets the expand control.
  const parentId = await seedNestedFolder();
  await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
  const openSidebar = page.getByRole('button', { name: 'Open Sidebar' });
  if (await openSidebar.isVisible().catch(() => false)) {
    await openSidebar.click();
  }

  const chevron = page.locator(`.file-list .tree-row[data-node-id="${parentId}"] .toggle-btn`);
  await expect(chevron).toBeVisible({ timeout: 30_000 });

  const box = await chevron.boundingBox();
  expect(box, 'the chevron must be measurable').toBeTruthy();
  expect(Math.round(box!.width), 'chevron tap width').toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(Math.round(box!.height), 'chevron tap height').toBeGreaterThanOrEqual(MIN_TAP_TARGET);

  // The rows themselves stay compact: the controls are out-of-flow overlays, so
  // enlarging them must not grow the list.
  const rowHeight = await page
    .locator(`.file-list .tree-row[data-node-id="${parentId}"]`)
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(rowHeight, 'rows must stay compact despite bigger tap targets').toBeLessThanOrEqual(44);
});

test('the Brain back control stays reachable after scrolling the detail sheet', async ({ page }) => {
  // Notes are created through a book (the app has no standalone POST /api/notes),
  // and a note's [[Concept]] reference is what materialises the concept.
  const concept = `MobilePolish${Date.now()}`;
  const book = await apiPost<{ id: string }>(fixture.baseUrl, '/api/books', {
    type: 'physical',
    title: `Mobile Polish Brain ${concept}`,
    author: 'Nostos Mobile QA',
    categories: 'mobile-polish',
  });
  await apiPost(fixture.baseUrl, `/api/books/${book.id}/notes`, {
    content:
      `A note referencing [[${concept}]] with enough surrounding text to push the ` +
      'detail sheet well past the fold. '.repeat(30),
  });

  await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
  const item = page.locator('.index-item', { hasText: concept }).first();
  await item.waitFor({ timeout: 30_000 });
  await item.click();

  const back = page.locator('.mobile-nav-header');
  await expect(back).toBeVisible();

  // Scroll far enough that a static control would be gone for good.
  await page.locator('.content-col').evaluate((el) => {
    el.scrollTop = 600;
  });
  await page.waitForTimeout(300);

  const box = await back.boundingBox();
  expect(box, 'the back control must still be rendered').toBeTruthy();
  expect(box!.y, 'the back control must stay pinned in the viewport').toBeGreaterThanOrEqual(0);
  expect(box!.y, 'the back control must remain in view').toBeLessThan(page.viewportSize()!.height);

  // Visible is not enough — it must still work.
  await back.click();
  await expect(page.locator('.index-item', { hasText: concept }).first()).toBeVisible();
});

test('the Brain index exposes 44px view-mode and search targets', async ({ page }) => {
  await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-header').waitFor({ timeout: 30_000 });

  const undersized = await page
    .locator('.index-header .toggle-opt, .index-header .search-box input')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            what: (el.className || '').toString().slice(0, 30),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .filter((b) => b.width < 44 || b.height < 44),
    );

  expect(
    undersized,
    `Brain index controls under ${MIN_TAP_TARGET}px: ${JSON.stringify(undersized)}`,
  ).toEqual([]);
});
