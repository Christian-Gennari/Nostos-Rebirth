/**
 * Evidence for the whole-surface map mode.
 *
 * Three behaviours are asserted here, all of them in a REAL browser, because
 * none of them can be settled by reading code:
 *
 *  1. Toggling into map view closes the index rail on desktop too, and the
 *     graph claims the track the rail gave up. Before this, the map rendered
 *     beside a fully visible index — a "toggle" between two states that were
 *     both on screen, with the graph confined to the column next to the list.
 *  2. The map's own toolbar carries a way back to the list. In map view the
 *     page-level view toggle lives inside the rail that is now closed, so
 *     without this control the mode would be a one-way door.
 *  3. Double-clicking a node opens that concept's detail — the same destination
 *     an index row click reaches — and leaves map view.
 *
 * Node ids are read from the live renderer (`__nostosGraph`), which is the only
 * reliable source of graph-space facts for a WebGL canvas, and the double-click
 * is dispatched as two real clicks at the node's screen position so Sigma's own
 * click counter (which is what decides a double-click) sees a genuine pair.
 */
import { expect, test } from '@playwright/test';
import { loadFixture } from './support/fixture';
import { cleanupBrain, seedBrain, type BrainSeed } from './support/brain-fixture';
import { capturePng, DESKTOP_VIEWPORT, MOBILE_VIEWPORT, newCapturePage } from './support/visual-capture';

/**
 * Number of top-level grid tracks in a computed `grid-template-columns`.
 *
 * Counting tracks rather than string-matching the source value is deliberate:
 * a real browser RESOLVES `minmax(280px, 320px)` to `320px`, so an assertion
 * written against the authored text passes in jsdom (which keeps it verbatim)
 * and fails in Chromium — the two environments disagree about the string, but
 * not about how many columns there are. Paren-aware because a `minmax()` track
 * contains a space.
 */
function gridTrackCount(computed: string): number {
  let depth = 0;
  let tracks = 0;
  let inTrack = false;
  for (const ch of computed) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (inTrack) tracks++;
      inTrack = false;
    } else {
      inTrack = true;
    }
  }
  return inTrack ? tracks + 1 : tracks;
}

test.describe.configure({ mode: 'serial' });

let seed: BrainSeed | null = null;

async function ensureSeed(fixture: ReturnType<typeof loadFixture>) {
  seed ??= await seedBrain(
    fixture.baseUrl,
    `Map Focus ${Date.now().toString(36)}`,
    [
      'On [[Attention]] and [[Memory]].',
      'On [[Attention]] and [[Practice]].',
      'On [[Memory]] and [[Practice]].',
      'On [[Solitude]] and [[Attention]].',
      'On [[Reading]] and [[Memory]].',
    ],
    ['Attention', 'Memory', 'Practice', 'Solitude', 'Reading']
  );
  return seed;
}

async function openMap(page: import('@playwright/test').Page, baseUrl: string) {
  await page.goto(`${baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.view-mode-control .toggle-opt').last().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector('.concept-map')?.getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 30_000 }
  );
  await page.waitForTimeout(900);
}

/** Screen position of a rendered node, read from the live Sigma renderer. */
async function nodeScreenPosition(
  page: import('@playwright/test').Page,
  label: string
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((wanted) => {
    const globals = globalThis as unknown as {
      __nostosSigma?: { graphToViewport(p: { x: number; y: number }): { x: number; y: number } };
      __nostosGraph?: {
        forEachNode(
          cb: (id: string, attrs: { x: number; y: number; label?: string }) => void
        ): void;
      };
    };
    const sigma = globals.__nostosSigma;
    const graph = globals.__nostosGraph;
    const container = document.querySelector('app-concept-map .sigma-container');
    if (!sigma || !graph || !container) return null;

    const box = container.getBoundingClientRect();
    let found: { x: number; y: number } | null = null;
    graph.forEachNode((_id, attrs) => {
      if (found || attrs.label !== wanted) return;
      const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      found = { x: box.left + p.x, y: box.top + p.y };
    });
    return found;
  }, label);
}

test('map view closes the index rail and hands its space to the graph', async ({ browser }) => {
  const fixture = loadFixture();
  await ensureSeed(fixture);
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
    await page.locator('.index-item').first().waitFor({ timeout: 30_000 });

    // List view: the rail is on screen and holds a real track.
    const before = await page.evaluate(() => {
      const index = document.querySelector('.index-col') as HTMLElement | null;
      const layout = document.querySelector('.brain-layout') as HTMLElement | null;
      return {
        indexWidth: index ? Math.round(index.getBoundingClientRect().width) : 0,
        columns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
      };
    });
    expect(before.indexWidth, 'list view shows the index rail').toBeGreaterThan(200);

    await openMap(page, fixture.baseUrl);

    const after = await page.evaluate(() => {
      const index = document.querySelector('.index-col') as HTMLElement | null;
      const layout = document.querySelector('.brain-layout') as HTMLElement | null;
      const col = document.querySelector('.content-col') as HTMLElement | null;
      const toolbar = document.querySelector('.map-toolbar') as HTMLElement | null;
      return {
        indexDisplay: index ? getComputedStyle(index).display : 'absent',
        columns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
        colWidth: col ? Math.round(col.getBoundingClientRect().width) : 0,
        toolbarExists: !!toolbar,
        exitVisible: !!document.querySelector('.map-toolbar [aria-label="Concept view"]'),
      };
    });
    console.log('MAP FOCUS GEOMETRY:', JSON.stringify({ before, after }, null, 1));
    await capturePng(page, 'brain-map-focus-desktop');

    // The rail is CLOSED, and the grid track it occupied is gone with it.
    // Hiding the aside alone would leave an empty 280-320px column and the
    // graph would still sit in the remainder beside nothing.
    expect(after.indexDisplay, 'the index rail must close in map view').toBe('none');
    expect(
      gridTrackCount(after.columns),
      `the layout must collapse to ONE track (got "${after.columns}")`
    ).toBe(1);
    expect(
      after.colWidth,
      'the graph column must claim the width the rail gave up'
    ).toBeGreaterThan(before.indexWidth + 200);

    // And the mode is escapable from within the map itself.
    expect(after.toolbarExists, 'the map must carry its own toolbar').toBe(true);
    expect(after.exitVisible, 'map view must not be a one-way door').toBe(true);
  } finally {
    await context.close();
  }
});

test('the map\'s own control returns to the list view with the rail restored', async ({ browser }) => {
  const fixture = loadFixture();
  await ensureSeed(fixture);
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await openMap(page, fixture.baseUrl);
    // Scoped to the map's toolbar: the index rail's own view toggle carries the
    // same accessible name and only one of the two is on screen at a time.
    await page.locator('.map-toolbar [aria-label="Concept view"]').click();

    await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
    const restored = await page.evaluate(() => {
      const index = document.querySelector('.index-col') as HTMLElement | null;
      const layout = document.querySelector('.brain-layout') as HTMLElement | null;
      return {
        indexWidth: index ? Math.round(index.getBoundingClientRect().width) : 0,
        indexDisplay: index ? getComputedStyle(index).display : 'absent',
        columns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
        mapGone: !document.querySelector('app-concept-map'),
      };
    });
    console.log('MAP FOCUS RESTORED:', JSON.stringify(restored, null, 1));

    expect(restored.mapGone, 'the map must be gone in list view').toBe(true);
    expect(restored.indexDisplay, 'the rail must come back').not.toBe('none');
    expect(restored.indexWidth, 'the rail must reclaim its track').toBeGreaterThan(200);
    expect(
      gridTrackCount(restored.columns),
      `the two-column grid must be restored (got "${restored.columns}")`
    ).toBe(2);
  } finally {
    await context.close();
  }
});

test('the map\'s toolbar is reachable and its exit is tappable on a phone', async ({ browser }) => {
  const fixture = loadFixture();
  await ensureSeed(fixture);
  const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, true);
  try {
    await openMap(page, fixture.baseUrl);

    const measured = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        exit: box('.map-toolbar [aria-label="Concept view"]'),
        search: box('.map-toolbar input[type="search"]'),
        indexHidden:
          getComputedStyle(document.querySelector('.index-col') as HTMLElement).display === 'none',
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    console.log('MAP TOOLBAR (mobile):', JSON.stringify(measured, null, 1));

    // The exit is the ONLY way out of map view on a phone, so it takes the same
    // 44px tap contract as the rest of the app (measured 34px before this was
    // pinned, on the one control a thumb must not miss).
    expect(measured.exit, 'the exit must render on a phone').not.toBeNull();
    expect(measured.exit!.h, 'the exit must meet the 44px touch minimum').toBeGreaterThanOrEqual(44);
    expect(measured.exit!.w, 'the exit must meet the 44px touch minimum').toBeGreaterThanOrEqual(44);
    expect(measured.search, 'the map must carry its own search where the rail is closed').not.toBeNull();
    expect(measured.indexHidden, 'the rail must be closed on a phone too').toBe(true);
    expect(measured.overflowX, 'the toolbar must not overflow a 390px viewport').toBe(false);

    // And it actually works from this layout.
    await page.locator('.map-toolbar [aria-label="Concept view"]').click();
    await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
    expect(await page.locator('app-concept-map').count(), 'the map must be gone').toBe(0);
  } finally {
    await context.close();
  }
});

test('double-clicking a node opens that concept\'s notes', async ({ browser }) => {
  const fixture = loadFixture();
  await ensureSeed(fixture);
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await openMap(page, fixture.baseUrl);

    const target = 'Attention';
    const point = await nodeScreenPosition(page, target);
    expect(point, `the seeded concept "${target}" must be rendered on the map`).not.toBeNull();

    // Two real clicks at the node's screen position. Sigma counts clicks on its
    // own captor, so this is the gesture a user actually performs — a
    // programmatic `dblclick` event would not drive that counter.
    await page.mouse.click(point!.x, point!.y);
    await page.mouse.click(point!.x, point!.y);

    await page.locator('.concept-title').waitFor({ timeout: 30_000 });
    const result = await page.evaluate(() => ({
      title: document.querySelector('.concept-title')?.textContent?.trim() ?? '',
      mapGone: !document.querySelector('app-concept-map'),
      indexVisible: !!document.querySelector('.index-col') &&
        getComputedStyle(document.querySelector('.index-col') as HTMLElement).display !== 'none',
    }));
    console.log('MAP DOUBLE-CLICK:', JSON.stringify(result, null, 1));
    await capturePng(page, 'brain-map-focus-double-click');

    // The concept's notes are the destination — exactly where an index row
    // click lands, which is the parity the request asked for.
    expect(result.title, 'double-click must open the concept that was clicked').toBe(target);
    expect(result.mapGone, 'opening a concept leaves map view').toBe(true);
    expect(result.indexVisible, 'the list view is back behind the detail').toBe(true);
  } finally {
    await context.close();
    if (seed) await cleanupBrain(fixture.baseUrl, seed);
  }
});
