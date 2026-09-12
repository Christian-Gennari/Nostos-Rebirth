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

import { loadFixture, apiPost } from './support/fixture';

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

/**
 * The collections list is a SHARED tree (library sidebar + writing studio), and
 * the touch branch used to pin its row actions permanently on screen. With six
 * collections that renders three buttons per row — twelve icons of noise for a
 * list the user reads, and the count badge had to be hidden on every row to
 * make the slot fit.
 *
 * On touch the SELECTED row is the reveal (mirroring desktop's hover), because
 * `:hover` never fires there. This asserts the two halves that failure would
 * break: rows are clean at rest, and selecting a row brings its actions back.
 */
test('collection row actions are revealed by selection on touch, not always on', async ({ page }) => {
  const seeded: string[] = [];
  try {
    // Two collections so "clean" and "selected" are different rows.
    for (const name of ['ZZ Guard A', 'ZZ Guard B']) {
      const created = await apiPost<any>(fixture.baseUrl, '/api/collections', { name, parentId: null });
      if (created?.id) seeded.push(created.id);
    }

    await openLibrary(page);

    const actions = page.locator('.tree-row .node-actions');
    const rows = page.locator('.tree-row');
    await expect(rows.first()).toBeAttached();
    const rowCount = await rows.count();
    expect(rowCount, 'fixture must seed collection rows').toBeGreaterThan(0);

    // On mobile the sidebar is an off-canvas drawer, so its rows are off-screen
    // until the header toggle opens it.
    await page.locator('.floating-toggle').click();
    await expect(rows.first()).toBeVisible();

    const visibleCount = async (): Promise<number> =>
      await actions.evaluateAll((els) =>
        els.filter((el) => {
          const cs = getComputedStyle(el);
          return cs.opacity === '1' && cs.visibility === 'visible';
        }).length,
      );

    // At rest: no row shows its actions, so the list reads as names and counts.
    expect(await visibleCount(), 'no row actions should be pinned on at rest').toBe(0);

    // Select a row; its actions appear, and only its actions.
    await rows.first().click();
    await expect
      .poll(async () => await visibleCount(), { message: 'selecting a row must reveal its actions' })
      .toBe(1);
  } finally {
    for (const id of seeded) {
      await fetch(`${fixture.baseUrl}/api/collections/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
});

/**
 * The mobile header toggle sits on `--bg-surface`, so its glyph must take that
 * surface's foreground — not the accent. `--color-primary` is the INK role and
 * resolves to sage (#8FA89A) on dark, which rendered the hamburger green against
 * the porcelain header (measured 6.53:1 against 14.37:1 for the correct token).
 *
 * This is the third time the same ink/fill role slip has appeared on this
 * project (brand wordmark, active collection row, and this control), so it is
 * asserted rather than left to review.
 */
test('the mobile header toggle uses the surface foreground, not the accent', async ({ page }) => {
  await openLibrary(page);
  await page.locator('.floating-toggle').click(); // hide it again so it is on screen in its resting state
  await page.waitForTimeout(500);

  const measured = await page.evaluate(() => {
    const el = document.querySelector('.floating-toggle');
    if (!el) return null;
    const root = getComputedStyle(document.documentElement);
    return {
      color: getComputedStyle(el).color,
      accent: root.getPropertyValue('--color-primary').trim(),
      surfaceFg: root.getPropertyValue('--color-text-main').trim(),
    };
  });
  expect(measured, 'the header toggle must be rendered on mobile').not.toBeNull();

  // Resolve the expected token through the browser so both sides are compared in
  // the same form (computed rgb vs. a hex literal never matches textually).
  const expected = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-text-main)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });

  expect(measured!.color, 'header toggle must use the surface foreground').toBe(expected);
});
