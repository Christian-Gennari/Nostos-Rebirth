import { expect, test } from '@playwright/test';

import { apiPost, loadFixture } from './support/fixture';
import { apiPut } from './support/visual-capture';

let fixture: ReturnType<typeof loadFixture>;
let documentTitle = '';

test.beforeAll(async () => {
  fixture = loadFixture();
  documentTitle = `Agent362 Mobile ${Date.now()}`;
  const created = await apiPost<{ id: string }>(fixture.baseUrl, '/api/writings', {
    name: documentTitle,
    type: 'Document',
    parentId: null,
  });
  await apiPut(fixture.baseUrl, `/api/writings/${created.id}`, {
    name: documentTitle,
    content: '# Mobile Studio UI kit\n\nDrawer, reference and zen verification.',
  });
});

test('mobile Studio drawers, reference modes and zen remain intact', async ({ page }) => {
  await page.goto(fixture.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('nostos.theme', 'light'));
  await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');

  const openSidebar = page.getByRole('button', { name: 'Open Sidebar' });
  await expect(openSidebar).toBeVisible();
  await expect(openSidebar).toHaveClass(/nostos-button/);
  await openSidebar.click();

  const left = page.locator('.sidebar-left');
  await expect(left).toHaveClass(/\bopen\b/);

  const row = page.locator('.file-list .tree-row', { hasText: documentTitle }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 45_000 });
  await expect(left).not.toHaveClass(/\bopen\b/);

  await page.getByRole('button', { name: 'Toggle reference sidebar' }).click();
  const right = page.locator('.sidebar-right');
  await expect(right).toHaveClass(/\bopen\b/);

  const conceptSearch = page.getByPlaceholder('Search concepts...');
  await expect(conceptSearch).toBeVisible();
  await expect(conceptSearch).toHaveClass(/nostos-form-control/);

  const tabs = page.locator('.sidebar-tabs [role="tab"]');
  await tabs.nth(1).click();
  await expect(page.getByPlaceholder('Search books...')).toBeVisible();
  await tabs.first().click();

  await page.screenshot({
    path: 'e2e/visual-evidence/agent-362-studio-mobile-light.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Close reference sidebar' }).click();
  await expect(right).not.toHaveClass(/\bopen\b/);

  await page.getByRole('button', { name: 'Toggle file sidebar' }).click();
  await expect(left).toHaveClass(/\bopen\b/);
  await page.getByRole('button', { name: 'Close sidebar' }).click();
  await expect(left).not.toHaveClass(/\bopen\b/);

  await page.locator('.editor-header .zen-toggle').click();
  await expect(page.locator('.zen-exit')).toBeVisible();
  await page.locator('.zen-exit').click();
  await expect(page.locator('.editor-header')).toBeVisible();

  await page.getByRole('button', { name: 'Toggle reference sidebar' }).click();
  await expect(right).toHaveClass(/\bopen\b/);
  const lightInputBg = await conceptSearch.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => localStorage.setItem('nostos.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkOpenSidebar = page.getByRole('button', { name: 'Open Sidebar' });
  await expect(darkOpenSidebar).toBeVisible();
  await darkOpenSidebar.click();
  const darkRow = page.locator('.file-list .tree-row', { hasText: documentTitle }).first();
  await expect(darkRow).toBeVisible({ timeout: 30_000 });
  await darkRow.click();
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Toggle reference sidebar' }).click();

  const darkConceptSearch = page.getByPlaceholder('Search concepts...');
  await expect(darkConceptSearch).toBeVisible();
  const darkInputBg = await darkConceptSearch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(darkInputBg).not.toBe(lightInputBg);

  await page.screenshot({
    path: 'e2e/visual-evidence/agent-362-studio-mobile-dark.png',
    fullPage: true,
  });
});
