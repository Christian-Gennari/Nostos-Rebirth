import { expect, test } from '@playwright/test';

import { apiPost, loadFixture } from './support/fixture';
import { apiPut } from './support/visual-capture';

let fixture: ReturnType<typeof loadFixture>;
let documentTitle = '';

test.beforeAll(async () => {
  fixture = loadFixture();
  documentTitle = `Agent362 Studio ${Date.now()}`;
  const created = await apiPost<{ id: string }>(fixture.baseUrl, '/api/writings', {
    name: documentTitle,
    type: 'Document',
    parentId: null,
  });
  await apiPut(fixture.baseUrl, `/api/writings/${created.id}`, {
    name: documentTitle,
    content: '# Studio UI kit\n\nA real document used to verify the migrated workspace controls.',
  });
});

test('desktop Studio preserves workspace semantics while using canonical controls', async ({ page }) => {
  await page.goto(fixture.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('nostos.theme', 'light'));
  await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');

  await expect(page.locator('.sidebar-left')).toBeVisible();
  await expect(page.locator('.editor-pane')).toBeVisible();
  await expect(page.locator('.sidebar-right')).toBeVisible();

  const conceptSearch = page.getByPlaceholder('Search concepts...');
  await expect(conceptSearch).toBeVisible();
  await expect(conceptSearch).toHaveClass(/nostos-form-control/);
  await expect(conceptSearch).toHaveClass(/nostos-form-control--compact/);

  const tabs = page.locator('.sidebar-tabs [role="tab"]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).not.toHaveClass(/nostos-button/);

  const lightInputBg = await conceptSearch.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.screenshot({
    path: 'e2e/visual-evidence/agent-362-studio-desktop-light.png',
    fullPage: true,
  });

  const row = page.locator('.file-list .tree-row', { hasText: documentTitle }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.editor-header .zen-toggle')).toBeVisible();

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  const bookSearch = page.getByPlaceholder('Search books...');
  await expect(bookSearch).toBeVisible();
  await expect(bookSearch).toHaveClass(/nostos-form-control/);
  await tabs.first().click();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  const folderName = `Agent362 Folder ${Date.now()}`;
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(folderName);
  });
  await page.getByRole('button', { name: 'New folder' }).click();
  await expect(page.locator('.file-list .tree-row', { hasText: folderName }).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.locator('.editor-header .zen-toggle').click();
  await expect(page.locator('.zen-exit')).toBeVisible();
  await page.locator('.zen-exit').click();
  await expect(page.locator('.editor-header')).toBeVisible();

  await page.evaluate(() => localStorage.setItem('nostos.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkConceptSearch = page.getByPlaceholder('Search concepts...');
  await expect(darkConceptSearch).toBeVisible();
  const darkInputBg = await darkConceptSearch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(darkInputBg).not.toBe(lightInputBg);

  const darkRow = page.locator('.file-list .tree-row', { hasText: documentTitle }).first();
  await expect(darkRow).toBeVisible({ timeout: 30_000 });
  await darkRow.click();
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 45_000 });

  await page.screenshot({
    path: 'e2e/visual-evidence/agent-362-studio-desktop-dark.png',
    fullPage: true,
  });
});
