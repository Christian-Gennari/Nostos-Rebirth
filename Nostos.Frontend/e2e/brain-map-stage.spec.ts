/**
 * Evidence that the concept map now occupies the main stage.
 *
 * Seeds a small connected brain, opens the map view, and records:
 *   - the map's rendered width and height (vs the old ~320px rail);
 *   - that it is inside .content-col and NOT inside .index-col;
 *   - the index list is still visible beside it;
 *   - screenshots at 1440x900 and 390x844.
 */
import { expect, test } from '@playwright/test';
import { apiPost, loadFixture } from './support/fixture';
import { capturePng, DESKTOP_VIEWPORT, MOBILE_VIEWPORT, newCapturePage } from './support/visual-capture';

test.describe.configure({ mode: 'serial' });

async function seed(fixture: ReturnType<typeof loadFixture>) {
  const suffix = Date.now().toString(36);
  const book = await apiPost<{ id: string }>(fixture.baseUrl, '/api/books', {
    type: 'physical',
    title: `Map Stage ${suffix}`,
    author: 'Nostos QA',
    categories: 'visual-qa',
  });
  // A connected cluster so the graph has real edges to draw.
  const notes = [
    'On [[Attention]] and [[Memory]].',
    'On [[Attention]] and [[Practice]].',
    'On [[Memory]] and [[Practice]].',
    'On [[Solitude]] and [[Attention]].',
    'On [[Reading]] and [[Memory]].',
  ];
  for (const content of notes) {
    await apiPost(fixture.baseUrl, `/api/books/${book.id}/notes`, { content });
  }
  return book.id;
}

async function openMap(page: import('@playwright/test').Page, baseUrl: string) {
  await page.goto(`${baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('app-concept-map .map-svg').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

test('map fills the main stage on desktop', async ({ browser }) => {
  const fixture = loadFixture();
  await seed(fixture);
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await openMap(page, fixture.baseUrl);

    const geo = await page.evaluate(() => {
      const map = document.querySelector('app-concept-map') as HTMLElement;
      const svg = document.querySelector('app-concept-map .map-svg') as HTMLElement;
      const stage = document.querySelector('app-concept-map .map-stage') as HTMLElement;
      const index = document.querySelector('.index-col') as HTMLElement;
      const railWidth = index ? index.getBoundingClientRect().width : 0;

      // Where do the drawn nodes actually sit inside the SVG's user space?
      const svgEl = document.querySelector('app-concept-map .map-svg') as SVGSVGElement;
      const circles = Array.from(svgEl.querySelectorAll('circle.map-node-visual')) as SVGCircleElement[];
      const pts = circles.map((c) => ({
        x: Number(c.getAttribute('cx')),
        y: Number(c.getAttribute('cy')),
      }));
      const vb = svgEl.viewBox.baseVal;
      let spread: Record<string, number> | null = null;
      if (pts.length > 0) {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        spread = {
          nodes: pts.length,
          widthPct: Math.round(((maxX - minX) / vb.width) * 100),
          heightPct: Math.round(((maxY - minY) / vb.height) * 100),
          centreOffsetX: Math.round((minX + maxX) / 2 - vb.width / 2),
          centreOffsetY: Math.round((minY + maxY) / 2 - vb.height / 2),
        };
      }

      return {
        inContentCol: !!map.closest('.content-col'),
        inIndexCol: !!map.closest('.index-col'),
        mapWidth: Math.round(map.getBoundingClientRect().width),
        svgWidth: Math.round(svg.getBoundingClientRect().width),
        svgHeight: Math.round(svg.getBoundingClientRect().height),
        stageWidth: Math.round(stage.getBoundingClientRect().width),
        railWidth: Math.round(railWidth),
        indexStillVisible: !!index && index.getBoundingClientRect().width > 0,
        widerThanRail: svg.getBoundingClientRect().width > railWidth * 2,
        viewBoxAspect: Math.round((vb.width / vb.height) * 100) / 100,
        stageAspect: Math.round((stage.getBoundingClientRect().width / stage.getBoundingClientRect().height) * 100) / 100,
        spread,
      };
    });

    console.log('MAP GEOMETRY:', JSON.stringify(geo, null, 1));
    await capturePng(page, 'brain-map-stage-desktop');

    expect(geo.inContentCol, 'map must be on the main stage').toBe(true);
    expect(geo.inIndexCol, 'map must not be in the index rail').toBe(false);
    expect(geo.indexStillVisible, 'index stays visible as the filter surface').toBe(true);
    expect(geo.widerThanRail, 'graph must be far wider than the old sidebar rail').toBe(true);
    expect(geo.svgHeight).toBeGreaterThanOrEqual(400);

    // The viewBox must match the stage's aspect, otherwise the default `meet`
    // scaling letterboxes the graph and it drifts in a wide, mostly-empty frame.
    expect(
      Math.abs(geo.viewBoxAspect - geo.stageAspect),
      `viewBox aspect ${geo.viewBoxAspect} must match stage aspect ${geo.stageAspect}`
    ).toBeLessThanOrEqual(0.12);

    // The graph must actually occupy the space it is given, and be centred in it.
    expect(geo.spread, 'node positions must be measurable').not.toBeNull();
    expect(geo.spread!.widthPct, 'cluster should span a good share of the width').toBeGreaterThanOrEqual(35);
    expect(
      geo.spread!.heightPct,
      'cluster should span a good share of the height, not huddle in the middle'
    ).toBeGreaterThanOrEqual(55);
    expect(Math.abs(geo.spread!.centreOffsetX), 'cluster should be horizontally centred').toBeLessThanOrEqual(80);
    expect(Math.abs(geo.spread!.centreOffsetY), 'cluster should be vertically centred').toBeLessThanOrEqual(80);
  } finally {
    await context.close();
  }
});

test('map fills the stage on mobile', async ({ browser }) => {
  const fixture = loadFixture();
  const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, true);
  try {
    await openMap(page, fixture.baseUrl);

    const geo = await page.evaluate(() => {
      const map = document.querySelector('app-concept-map') as HTMLElement;
      const svg = document.querySelector('app-concept-map .map-svg') as HTMLElement;
      return {
        inContentCol: !!map.closest('.content-col'),
        visible: svg.getBoundingClientRect().width > 0,
        svgWidth: Math.round(svg.getBoundingClientRect().width),
        svgHeight: Math.round(svg.getBoundingClientRect().height),
        docScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    console.log('MAP GEOMETRY (mobile):', JSON.stringify(geo, null, 1));
    await capturePng(page, 'brain-map-stage-mobile');

    expect(geo.inContentCol).toBe(true);
    expect(geo.visible, 'map must be visible on mobile in map view').toBe(true);
    expect(geo.docScrollWidth, 'no horizontal overflow on mobile').toBeLessThanOrEqual(geo.clientWidth);
  } finally {
    await context.close();
  }
});
