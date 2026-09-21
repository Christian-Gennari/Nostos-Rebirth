import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { apiPost, loadFixture } from './support/fixture';

interface SeededBook {
  id: string;
  title: string;
}

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

let typical: SeededBook;
let physical: SeededBook;
let longMetadata: SeededBook;

async function uploadEpub(baseUrl: string, id: string): Promise<void> {
  const bytes = readFileSync(path.join(__dirname, 'assets', 'tiny.epub'));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/epub+zip' }), 'tiny.epub');

  const response = await fetch(`${baseUrl}/api/books/${id}/file`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`EPUB upload failed: ${response.status} ${await response.text()}`);
  }
}

async function openBook(
  browser: Browser,
  id: string,
  theme: 'light' | 'dark',
  mobile: boolean,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const { baseUrl } = loadFixture();
  const context = await browser.newContext({
    viewport: mobile ? MOBILE : DESKTOP,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });

  await context.addInitScript((selectedTheme) => {
    localStorage.setItem('nostos.theme', selectedTheme);
  }, theme);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/library/${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.book-title').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(250);

  return { page, close: () => context.close() };
}

async function assertCohesion(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const primaryButtons = page.locator('.primary-actions button');
  const buttonCount = await primaryButtons.count();
  expect(buttonCount).toBeGreaterThan(0);
  for (let i = 0; i < buttonCount; i++) {
    await expect(primaryButtons.nth(i)).toHaveClass(/nostos-button/);
  }

  const favorite = page.locator('.favorite-btn');
  await expect(favorite).toHaveClass(/icon-btn/);
  await expect(favorite).toHaveAttribute('aria-pressed', /true|false/);
  await expect(page.locator('.notes-header .nostos-badge')).toBeVisible();

  // Product-owned controls keep their distinct interaction contracts.
  await expect(page.locator('.status-chip-btn')).not.toHaveClass(/nostos-chip/);
  await expect(page.locator('.btn-back')).not.toHaveClass(/nostos-button/);
  await expect(page.locator('.cover-overlay-btn').first()).not.toHaveClass(/nostos-button/);

  const rootTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(rootTheme).toBe(theme === 'dark' ? 'dark' : null);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  const { baseUrl } = loadFixture();

  typical = await apiPost<SeededBook>(baseUrl, '/api/books', {
    type: 'ebook',
    title: 'UI Kit Verification Book',
    author: 'Nostos QA',
    description: 'A normal digital book used to verify the Book Detail control migration.',
    publisher: 'Nostos Press',
    publishedDate: '2026',
    pageCount: 240,
    language: 'en',
    categories: 'Philosophy, Essays',
  });
  await uploadEpub(baseUrl, typical.id);

  physical = await apiPost<SeededBook>(baseUrl, '/api/books', {
    type: 'physical',
    title: 'Physical Book Verification',
    author: 'Nostos QA',
    publisher: 'Paper House',
    pageCount: 320,
    language: 'en',
    categories: 'Classics',
  });

  longMetadata = await apiPost<SeededBook>(baseUrl, '/api/books', {
    type: 'physical',
    title:
      'A Deliberately Long Book Title for Verifying Book Detail Metadata Wrapping Without Horizontal Overflow on Narrow Screens',
    subtitle:
      'An equally long subtitle that should wrap naturally while the shared controls retain their intended geometry',
    author: 'A Very Long Author Name Used for Responsive Verification',
    editor: 'Editor With A Deliberately Long Name',
    translator: 'Translator With Another Deliberately Long Name',
    description:
      'Long metadata must not push the Book Detail layout wider than the viewport. '.repeat(12),
    publisher: 'The Extremely Long Named International Publishing Cooperative and Archive',
    placeOfPublication: 'A Very Long Place of Publication Name, Sweden',
    publishedDate: '2026-09-21',
    edition: 'Expanded annotated archival verification edition',
    isbn: '9781234567897',
    pageCount: 1234,
    language: 'en',
    categories:
      'Philosophy, Literary Criticism, Intellectual History, Essays, Reference, Long Metadata Verification',
    series: 'The Collected Verification Volumes With A Long Series Name',
    volumeNumber: '12',
  });
});

const cases = [
  { name: 'typical-epub-desktop-light', book: () => typical, theme: 'light' as const, mobile: false },
  { name: 'typical-epub-mobile-dark', book: () => typical, theme: 'dark' as const, mobile: true },
  { name: 'physical-desktop-dark', book: () => physical, theme: 'dark' as const, mobile: false },
  { name: 'physical-mobile-light', book: () => physical, theme: 'light' as const, mobile: true },
  { name: 'long-metadata-desktop-light', book: () => longMetadata, theme: 'light' as const, mobile: false },
  { name: 'long-metadata-mobile-dark', book: () => longMetadata, theme: 'dark' as const, mobile: true },
];

for (const entry of cases) {
  test(entry.name, async ({ browser }, testInfo) => {
    const { page, close } = await openBook(browser, entry.book().id, entry.theme, entry.mobile);
    try {
      await assertCohesion(page, entry.theme);

      if (entry.book().id === typical.id) {
        await expect(page.locator('.primary-actions')).toContainText('Read Book');
        await expect(page.locator('.primary-actions')).toContainText('Download');
        await expect(page.locator('.primary-actions')).toContainText('Edit');
      }

      if (entry.book().id === physical.id) {
        await expect(page.locator('.primary-actions')).not.toContainText('Upload File');
        await expect(page.locator('.primary-actions input[type="file"]')).toHaveCount(0);
      }

      if (entry.book().id === longMetadata.id) {
        await expect(page.locator('.book-title')).toContainText('Deliberately Long Book Title');
        const titleFits = await page.locator('.book-title').evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
        });
        expect(titleFits).toBe(true);
      }

      await page.screenshot({
        path: testInfo.outputPath(`${entry.name}.png`),
        fullPage: true,
      });
    } finally {
      await close();
    }
  });
}

test('ordinary status-confirm actions and editions search use the stable kit', async ({ browser }) => {
  const { page, close } = await openBook(browser, typical.id, 'light', false);
  try {
    await page.locator('.status-chip-btn').click();
    await page.locator('.status-dropdown-item.status-finished').click();

    const statusDialog = page.locator('.status-confirm-dialog');
    await expect(statusDialog).toBeVisible();
    await expect(statusDialog.locator('.nostos-dialog-actions--inset')).toBeVisible();
    await expect(statusDialog.locator('.nostos-button--ghost')).toContainText('Cancel');
    await expect(statusDialog.locator('.nostos-button--primary')).toContainText('Mark as Finished');
    await statusDialog.locator('.nostos-button--ghost').click();

    await page.locator('.edit-metadata-btn').click();
    await page.locator('.edit-menu-item', { hasText: 'Editions' }).click();

    const search = page.locator('.manage-link-search');
    await expect(search).toHaveClass(/nostos-form-control--input/);
    await expect(search).toHaveClass(/nostos-form-control--compact/);

    // Edition/work relationship controls remain product-owned by design.
    const memberAction = page.locator('.manage-member-action');
    if ((await memberAction.count()) > 0) {
      await expect(memberAction.first()).not.toHaveClass(/nostos-button/);
    }
    const candidate = page.locator('.manage-link-candidate');
    if ((await candidate.count()) > 0) {
      await expect(candidate.first()).not.toHaveClass(/nostos-button/);
    }
  } finally {
    await close();
  }
});
