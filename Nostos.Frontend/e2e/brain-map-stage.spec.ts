/**
 * Evidence that the concept map occupies the main stage and is framed sensibly.
 *
 * This spec targets the Sigma/Graphology renderer. It replaces the earlier
 * SVG-based version, whose selectors (`.map-svg`, `circle.map-node-visual`)
 * stopped existing when the map was rewritten onto Sigma — for a period those
 * assertions could not pass, so they guarded nothing.
 *
 * Node geometry is read from the live renderer via the component's diagnostic
 * handles (`__nostosGraph`, `__nostosSigma`), which is the only reliable source
 * of graph-space facts for a WebGL canvas.
 */
import { expect, test } from '@playwright/test';
import { loadFixture } from './support/fixture';
import { cleanupBrain, seedBrain, type BrainSeed } from './support/brain-fixture';
import { capturePng, DESKTOP_VIEWPORT, MOBILE_VIEWPORT, newCapturePage } from './support/visual-capture';

test.describe.configure({ mode: 'serial' });

let seed: BrainSeed | null = null;

async function ensureSeed(fixture: ReturnType<typeof loadFixture>) {
  seed ??= await seedBrain(
    fixture.baseUrl,
    `Map Stage ${Date.now().toString(36)}`,
    // A connected cluster so the graph has real edges to draw.
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
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

test('map fills the main stage on desktop', async ({ browser }) => {
  const fixture = loadFixture();
  await ensureSeed(fixture);
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await openMap(page, fixture.baseUrl);

    const geo = await page.evaluate(() => {
      const map = document.querySelector('app-concept-map') as HTMLElement;
      const stage = document.querySelector('app-concept-map .map-stage') as HTMLElement;
      const container = document.querySelector('app-concept-map .sigma-container') as HTMLElement;
      const index = document.querySelector('.index-col') as HTMLElement;
      const railWidth = index ? index.getBoundingClientRect().width : 0;

      const globals = globalThis as unknown as {
        __nostosSigma?: { getDimensions(): { width: number; height: number }; getCamera(): { ratio: number } };
        __nostosGraph?: { order: number; size: number };
      };
      const sigma = globals.__nostosSigma;
      const graph = globals.__nostosGraph;

      return {
        inContentCol: !!map.closest('.content-col'),
        inIndexCol: !!map.closest('.index-col'),
        mapWidth: Math.round(map.getBoundingClientRect().width),
        stageWidth: Math.round(stage.getBoundingClientRect().width),
        stageHeight: Math.round(stage.getBoundingClientRect().height),
        containerWidth: Math.round(container.getBoundingClientRect().width),
        containerHeight: Math.round(container.getBoundingClientRect().height),
        canvasCount: document.querySelectorAll('.sigma-container canvas').length,
        railWidth: Math.round(railWidth),
        indexStillVisible: !!index && index.getBoundingClientRect().width > 0,
        widerThanRail: container.getBoundingClientRect().width > railWidth * 2,
        graphOrder: graph?.order ?? 0,
        graphSize: graph?.size ?? 0,
        cameraRatio: sigma ? Number(sigma.getCamera().ratio.toFixed(4)) : null,
        rendererSize: sigma ? sigma.getDimensions() : null,
      };
    });

    console.log('MAP GEOMETRY:', JSON.stringify(geo, null, 1));
    await capturePng(page, 'brain-map-stage-desktop');

    expect(geo.inContentCol, 'map must be on the main stage').toBe(true);
    expect(geo.inIndexCol, 'map must not be in the index rail').toBe(false);
    expect(geo.indexStillVisible, 'index stays visible as the filter surface').toBe(true);
    expect(geo.widerThanRail, 'graph must be far wider than the old sidebar rail').toBe(true);
    expect(geo.containerHeight).toBeGreaterThanOrEqual(400);
    expect(geo.canvasCount, 'Sigma renders its layer canvases').toBeGreaterThan(0);

    // The seeded brain must actually be in the graph.
    expect(geo.graphOrder, 'seeded concepts must render as nodes').toBeGreaterThanOrEqual(5);
    expect(geo.graphSize, 'seeded notes must produce edges').toBeGreaterThan(0);
    expect(geo.cameraRatio, 'camera must have a real zoom ratio').toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('graph is framed and centred when the map opens', async ({ browser }) => {
  const fixture = loadFixture();
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await openMap(page, fixture.baseUrl);

    const framed = await page.evaluate(() => {
      const globals = globalThis as unknown as {
        __nostosSigma?: {
          getDimensions(): { width: number; height: number };
          graphToViewport(p: { x: number; y: number }): { x: number; y: number };
        };
        __nostosGraph?: { forEachNode(cb: (id: string, attrs: { x: number; y: number }) => void): void };
      };
      const sigma = globals.__nostosSigma;
      const graph = globals.__nostosGraph;
      if (!sigma || !graph) return null;

      const dims = sigma.getDimensions();
      const xs: number[] = [];
      const ys: number[] = [];
      let offscreen = 0;
      graph.forEachNode((_id, attrs) => {
        const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
        xs.push(p.x);
        ys.push(p.y);
        if (p.x < 0 || p.x > dims.width || p.y < 0 || p.y > dims.height) offscreen++;
      });
      if (!xs.length) return null;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        dims,
        nodes: xs.length,
        offscreen,
        fillW: Math.round((100 * (maxX - minX)) / dims.width),
        fillH: Math.round((100 * (maxY - minY)) / dims.height),
        centreOffsetX: Math.round((minX + maxX) / 2 - dims.width / 2),
        centreOffsetY: Math.round((minY + maxY) / 2 - dims.height / 2),
      };
    });

    console.log('FRAMING:', JSON.stringify(framed, null, 1));
    expect(framed, 'graph geometry must be measurable').not.toBeNull();

    // Nothing may be off-screen on open, and the graph must use the stage.
    //
    // Thresholds note: node positions come from a ForceAtlas2 seed and the graph
    // is normalized to fill 88% of the tighter axis, so the SHORTER axis reaches
    // ~88% and the other is proportionally smaller for an unsquare graph. 60 is
    // the honest floor for the wider axis; the tighter axis is held to 80.
    expect(framed!.offscreen, 'no nodes may open off-screen').toBe(0);
    expect(Math.max(framed!.fillW, framed!.fillH), 'graph must use the stage').toBeGreaterThanOrEqual(80);
    expect(Math.min(framed!.fillW, framed!.fillH), 'graph must not collapse').toBeGreaterThanOrEqual(15);
    expect(Math.abs(framed!.centreOffsetX), 'graph must be horizontally centred').toBeLessThanOrEqual(40);
    expect(Math.abs(framed!.centreOffsetY), 'graph must be vertically centred').toBeLessThanOrEqual(40);
  } finally {
    await context.close();
  }
});

test('graph has no overlapping nodes and uses the stage aspect', async ({ browser }) => {
  const fixture = loadFixture();
  // This test needs real concepts to measure, and it must not rely on the
  // serial ordering of the other tests (the fixture is shared and cleaned up
  // between spec files), so seed and tear down locally.
  const seed = await seedBrain(
    fixture.baseUrl,
    `Spacing ${Date.now().toString(36)}`,
    [
      'On [[Attention]] and [[Memory]].',
      'On [[Attention]] and [[Practice]].',
      'On [[Memory]] and [[Practice]].',
      'On [[Solitude]] and [[Attention]].',
      'On [[Reading]] and [[Memory]].',
      'On [[Practice]] and [[Solitude]].',
      'On [[Reading]] and [[Attention]].',
    ],
    ['Attention', 'Memory', 'Practice', 'Solitude', 'Reading']
  );
  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await openMap(page, fixture.baseUrl);

    const spacing = await page.evaluate(() => {
      const globals = globalThis as unknown as {
        __nostosSigma?: {
          getDimensions(): { width: number; height: number };
          graphToViewport(p: { x: number; y: number }): { x: number; y: number };
          scaleSize(s: number): number;
        };
        __nostosGraph?: {
          forEachNode(cb: (id: string, attrs: { x: number; y: number; size: number; label?: string }) => void): void;
        };
      };
      const sigma = globals.__nostosSigma;
      const graph = globals.__nostosGraph;
      if (!sigma || !graph) return null;

      const d = sigma.getDimensions();
      const pts: Array<{ label: string; x: number; y: number; r: number }> = [];
      graph.forEachNode((_id, attrs) => {
        const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
        pts.push({ label: attrs.label ?? '', x: p.x, y: p.y, r: sigma.scaleSize(attrs.size) });
      });

      let overlapping = 0;
      const overlaps: Array<{ a: string; b: string; dist: number; need: number }> = [];
      const nn: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        let best = Infinity;
        for (let j = 0; j < pts.length; j++) {
          if (i === j) continue;
          const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (dist < best) best = dist;
          if (j > i && dist < pts[i].r + pts[j].r) {
            overlapping++;
            if (overlaps.length < 5) overlaps.push({ a: pts[i].label, b: pts[j].label, dist: +dist.toFixed(1), need: +(pts[i].r + pts[j].r).toFixed(1) });
          }
        }
        nn.push(best);
      }
      nn.sort((a, b) => a - b);
      return {
        nodes: pts.length,
        overlappingPairs: overlapping,
        overlaps,
        minNN: +nn[0].toFixed(1),
        p25NN: +nn[Math.floor(nn.length * 0.25)].toFixed(1),
        medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
      };
    });

    console.log('NODE SPACING:', JSON.stringify(spacing, null, 1));
    expect(spacing, 'node geometry must be measurable').not.toBeNull();

    // Regression guard: at the original ForceAtlas2 repulsion (scalingRatio 18 /
    // gravity 0.4) 18 node pairs rendered closer than their combined radii, so
    // the centre of the map was an unreadable clump.
    expect(
      spacing!.overlappingPairs,
      `overlapping node pairs: ${JSON.stringify(spacing!.overlaps)}`
    ).toBe(0);

    // And nodes must not be so close that their labels collide either.
    expect(spacing!.p25NN, 'a quarter of nodes should have real breathing room').toBeGreaterThanOrEqual(12);
  } finally {
    await context.close();
    await cleanupBrain(fixture.baseUrl, seed);
  }
});

test('map fills the stage on mobile', async ({ browser }) => {
  const fixture = loadFixture();
  const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, true);
  try {
    await openMap(page, fixture.baseUrl);

    const geo = await page.evaluate(() => {
      const map = document.querySelector('app-concept-map') as HTMLElement;
      const stage = document.querySelector('app-concept-map .map-stage') as HTMLElement;
      const container = document.querySelector('app-concept-map .sigma-container') as HTMLElement;
      const index = document.querySelector('.index-col') as HTMLElement;
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Where the stage actually ends, and how much empty band follows it before
      // the dock. Measured rather than inferred from padding values.
      const dock = document.querySelector('app-app-dock, .app-dock, .bottom-dock') as HTMLElement | null;
      const dockTop = dock ? dock.getBoundingClientRect().top : viewportHeight;

      // Label clipping: Sigma draws labels into a 2D canvas sized to the stage,
      // so text past the edge is cut off with no DOM trace. Count ink touching
      // the canvas border — the only reliable symptom.
      let labelInkOnEdge = 0;
      const labelLayer = document.querySelector('app-concept-map .sigma-labels') as HTMLCanvasElement | null;
      if (labelLayer && labelLayer.width > 0 && labelLayer.height > 0) {
        const scratch = document.createElement('canvas');
        scratch.width = labelLayer.width;
        scratch.height = labelLayer.height;
        const ctx = scratch.getContext('2d');
        if (ctx) {
          ctx.drawImage(labelLayer, 0, 0);
          const img = ctx.getImageData(0, 0, scratch.width, scratch.height);
          const { data, width: W, height: H } = img;
          const inked = (x: number, y: number) => data[(y * W + x) * 4 + 3] > 24;
          for (let y = 0; y < H; y++) {
            if (inked(0, y)) labelInkOnEdge++;
            if (inked(W - 1, y)) labelInkOnEdge++;
          }
          for (let x = 0; x < W; x++) {
            if (inked(x, 0)) labelInkOnEdge++;
            if (inked(x, H - 1)) labelInkOnEdge++;
          }
        }
      }

      return {
        inContentCol: !!map.closest('.content-col'),
        rendered: rect.width > 0 && rect.height > 0,
        // Rendered is not enough: the bug this guards against was the map being
        // laid out *below* a full-height index rail, i.e. off-screen entirely.
        onScreen: rect.width > 0 && rect.height > 0 && rect.top < viewportHeight && rect.bottom > 0,
        visibleHeightPx: Math.round(Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0))),
        viewportHeight: Math.round(viewportHeight),
        indexHidden: !!index && getComputedStyle(index).display === 'none',
        stageHeight: Math.round(stage.getBoundingClientRect().height),
        docScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        gutterLeftPx: Math.round(rect.left),
        gutterRightPx: Math.round(window.innerWidth - rect.right),
        gapStageToDockPx: Math.round(Math.max(0, dockTop - rect.bottom)),
        labelInkOnEdge,
      };
    });

    console.log('MAP GEOMETRY (mobile):', JSON.stringify(geo, null, 1));
    await capturePng(page, 'brain-map-stage-mobile');

    expect(geo.inContentCol).toBe(true);
    expect(geo.rendered, 'map must render on mobile in map view').toBe(true);
    expect(geo.onScreen, 'map must be within the viewport, not pushed below the fold by the index rail').toBe(true);
    expect(geo.visibleHeightPx, 'map should occupy most of the visible viewport height').toBeGreaterThanOrEqual(
      Math.round(geo.viewportHeight * 0.5)
    );
    expect(geo.indexHidden, 'index rail must be hidden so the map owns the screen').toBe(true);
    expect(geo.docScrollWidth, 'no horizontal overflow on mobile').toBeLessThanOrEqual(geo.clientWidth);

    // The map used to inherit the concept-reading layout, which reserved 96px
    // below the card for the dock and 1.5rem of gutter each side. Both left the
    // graph squeezed into a band: 37px gutters and a stage ending 163px above the
    // dock. Assert the reclaimed space so a future reading-layout change cannot
    // silently take it back.
    expect(geo.gutterLeftPx, 'map should reach near the viewport edge, not sit inside reading gutters')
      .toBeLessThanOrEqual(16);
    expect(geo.gutterRightPx, 'map should reach near the viewport edge on both sides')
      .toBeLessThanOrEqual(16);
    expect(geo.gapStageToDockPx, 'the graph should not end in a wide empty band above the dock')
      .toBeLessThanOrEqual(Math.round(geo.viewportHeight * 0.16));

    // Labels are drawn by Sigma into a canvas, so a label that runs past the
    // edge is simply cut off — that produced truncated names like "pruder".
    // Ink touching the label layer's border is the measurable symptom.
    expect(geo.labelInkOnEdge, 'no label text may be drawn past the canvas edge and clipped')
      .toBe(0);
  } finally {
    await context.close();
    // Last test in this serial spec: restore the shared fixture so the visual
    // matrix's empty-state assertion (which runs later) still sees a clean DB.
    if (seed) await cleanupBrain(fixture.baseUrl, seed);
  }
});
