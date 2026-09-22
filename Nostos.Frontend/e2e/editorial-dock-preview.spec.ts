import { expect, test, type Page } from '@playwright/test';

import { loadFixture } from './support/fixture';

let fixture: ReturnType<typeof loadFixture>;

test.beforeAll(() => {
  fixture = loadFixture();
});

async function prepare(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    localStorage.setItem('nostos.theme', 'light');
  });
  await page.goto(`${fixture.baseUrl}/library`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('app-app-dock')).toBeVisible();
  await expect(page.locator('app-app-dock .dock-item.active')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(350);
}

test('captures the editorial dock on desktop and mobile', async ({ page }) => {
  await prepare(page, 1280, 800);

  const desktopDock = page.locator('app-app-dock');
  await desktopDock.screenshot({
    path: 'e2e/test-results/editorial-dock-preview/desktop-dock.png',
  });
  await page.screenshot({
    path: 'e2e/test-results/editorial-dock-preview/desktop-full.png',
  });

  const desktop = await desktopDock.locator('.app-dock-container').boundingBox();
  expect(desktop).not.toBeNull();
  expect(desktop!.width).toBeGreaterThan(300);
  expect(desktop!.width).toBeLessThan(420);
  expect(desktop!.height).toBeGreaterThanOrEqual(70);

  await prepare(page, 390, 844);

  const mobileDock = page.locator('app-app-dock');
  await mobileDock.screenshot({
    path: 'e2e/test-results/editorial-dock-preview/mobile-dock.png',
  });
  await page.screenshot({
    path: 'e2e/test-results/editorial-dock-preview/mobile-full.png',
  });

  const mobile = await mobileDock.locator('.app-dock-container').boundingBox();
  expect(mobile).not.toBeNull();
  expect(mobile!.x).toBeLessThanOrEqual(1);
  expect(mobile!.width).toBeGreaterThanOrEqual(389);
  expect(mobile!.height).toBeGreaterThanOrEqual(59);
});
