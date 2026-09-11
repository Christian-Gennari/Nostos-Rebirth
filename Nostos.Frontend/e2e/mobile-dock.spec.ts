/**
 * Mobile dock geometry — the bottom navigation must be a full-bleed, thumb
 * friendly rail on phones.
 *
 * Regression guard: the desktop dock is a floating pill sized to its content
 * (`.app-dock-container { width: max-content }`, added when the dock became a
 * floating rail). The `max-width: 768px` override reset its borders, shadow
 * and position but never its width, so on a phone the "full-width rail"
 * collapsed to a ~178px pill pinned to the left edge: 46% of the screen with
 * dead space beside it and tap targets under 40x50 CSS px.
 *
 * These assertions are geometry-only (no pixel snapshots), so they stay stable
 * across styling work while still failing loudly if the rail collapses again.
 * The spec runs in the mobile-chromium project (playwright.config.ts matches
 * `mobile.*.spec.ts`); the fixture already serves the real production build.
 */
import { expect, test, type Page } from '@playwright/test';

import { loadFixture } from './support/fixture';

const MIN_TAP_TARGET = 44; // CSS px, Apple HIG / Material minimum

let fixture: ReturnType<typeof loadFixture>;

test.beforeAll(() => {
  fixture = loadFixture();
});

async function openLibrary(page: Page): Promise<void> {
  await page.goto(`${fixture.baseUrl}/library`);
  await expect(page.locator('app-app-dock')).toBeVisible();
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

test('the dock is a full-width rail at the bottom edge', async ({ page }) => {
  await openLibrary(page);
  const viewport = page.viewportSize()!;

  const rail: Box = await page.locator('app-app-dock .app-dock-container').boundingBox() as Box;
  expect(rail, 'the dock container must be rendered').toBeTruthy();
  const railBottom = rail.y + rail.height;

  // Full bleed: the rail spans the viewport edge to edge.
  expect(rail.x, 'rail must start at the left edge').toBeLessThanOrEqual(1);
  expect(rail.width, 'rail must span the viewport width').toBeGreaterThanOrEqual(viewport.width - 1);

  // Anchored to the bottom edge (the host is position: fixed; bottom: 0).
  expect(viewport.height - railBottom, 'rail must sit on the bottom edge').toBeLessThanOrEqual(1);
});

test('every dock item is a comfortable tap target, not a sliver', async ({ page }) => {
  await openLibrary(page);
  const viewport = page.viewportSize()!;
  const boxes = await page.locator('app-app-dock .dock-item').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        label: (el.textContent ?? '').trim(),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        fontSize: parseFloat(cs.fontSize),
      };
    })
  );

  expect(boxes.length, 'the dock has four destinations').toBe(4);
  for (const box of boxes) {
    expect(box.width, `${box.label} tap width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    expect(box.height, `${box.label} tap height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  }

  // Distributed across the viewport instead of bunched into the left half:
  // the last item must reach into the right half of the screen.
  const last = boxes[boxes.length - 1];
  expect(last.x + last.width, 'the last item must reach the right half').toBeGreaterThan(viewport.width * 0.75);
});

test('the rail does not create horizontal overflow or illegible labels', async ({ page }) => {
  await openLibrary(page);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'no horizontal page overflow').toBeLessThanOrEqual(overflow.clientWidth + 1);

  const labelSizes = await page
    .locator('app-app-dock .dock-item .label')
    .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  for (const size of labelSizes) {
    // Below ~11px the labels stop being readable at arm's length.
    expect(size, 'dock label font size').toBeGreaterThanOrEqual(11);
  }
});
