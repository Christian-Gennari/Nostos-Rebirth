/**
 * Combined verification: PR #122 (touch drag lifecycle) + PR #134 (d3 physics).
 *
 * These two changes touch the same code and could regress each other in ways the
 * unit suites cannot see, so this drives a REAL touch viewport and asserts both
 * behaviours in one gesture:
 *
 *   #122 — a touch release must hand the camera back and clear the pin, or every
 *          camera control is dead for good after a single tap.
 *   #134 — a release must leave the graph SETTLING (inertia), then stop.
 *
 * It also re-checks #122's other two fixes (icon distinctness, tap-target gaps)
 * because they live in the same rail the physics change touches.
 *
 * Usage: node scripts/map-audit/combined-verify.mjs <url> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5341').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/combined';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};
const fail = [];

const openMap = async (page) => {
  await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3500);
};

const snapshot = (page) => page.evaluate(() => {
  const out = {};
  globalThis.__nostosGraph.forEachNode((n, a) => { out[n] = [a.x, a.y]; });
  return out;
});

/* ── 1. TOUCH viewport: a tap must not kill the camera (#122), and a drag must
       leave the graph settling (#134). ── */
{
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  })).newPage();
  await openMap(page);

  const target = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions();
    const rect = document.querySelector('.sigma-container').getBoundingClientRect();
    let best = null;
    g.forEachNode((id, a) => {
      const p = sig.graphToViewport({ x: a.x, y: a.y });
      const margin = Math.min(p.x, d.width - p.x, p.y, d.height - p.y);
      if (margin < 90) return;
      const deg = g.degree(id);
      if (!best || deg > best.deg) best = { id, deg, pageX: rect.left + p.x, pageY: rect.top + p.y };
    });
    return best;
  });
  results.touchTarget = target;

  // ── TAP (no travel): the #122 regression. ──
  await page.touchscreen.tap(target.pageX, target.pageY);
  await page.waitForTimeout(400);

  results.afterTap = await page.evaluate(() => {
    const layout = globalThis.__nostosLayout;
    const pinned = layout.nodes().filter((n) => n.fx != null || n.fy != null).length;
    const cam = globalThis.__nostosSigma.getCamera();
    return { pinned, cameraEnabled: cam.enabled, cameraRatio: +cam.ratio.toFixed(4) };
  });

  // The camera must still respond: Fit has to change the ratio.
  const before = results.afterTap.cameraRatio;
  await page.locator('[aria-label="Zoom in"]').click();
  await page.waitForTimeout(700);
  results.afterTap.zoomInChangedRatio = await page.evaluate((prev) => {
    const r = globalThis.__nostosSigma.getCamera().ratio;
    return Math.abs(r - prev) > 0.01;
  }, before);

  if (results.afterTap.pinned !== 0) fail.push(`tap left ${results.afterTap.pinned} node(s) pinned`);
  if (!results.afterTap.cameraEnabled) fail.push('tap left the camera disabled');
  if (!results.afterTap.zoomInChangedRatio) fail.push('zoom-in had no effect after a tap (stuck controls)');

  // ── TOUCH DRAG: both features in one gesture. ──
  //
  // Re-fit and RECOMPUTE the target first. The camera checks above zoomed in, so
  // the coordinates captured before them no longer point at that node — dragging
  // the stale point moves nothing and reads as a product bug when it is the probe.
  await page.locator('[aria-label="Fit to view"]').click();
  await page.waitForTimeout(1200);

  const dragTarget = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions();
    const rect = document.querySelector('.sigma-container').getBoundingClientRect();
    let best = null;
    g.forEachNode((id, a) => {
      const p = sig.graphToViewport({ x: a.x, y: a.y });
      const margin = Math.min(p.x, d.width - p.x, p.y, d.height - p.y);
      if (margin < 90) return;
      const deg = g.degree(id);
      if (!best || deg > best.deg) best = { id, deg, pageX: rect.left + p.x, pageY: rect.top + p.y };
    });
    return best;
  });
  results.dragTarget = dragTarget;
  target.pageX = dragTarget.pageX;
  target.pageY = dragTarget.pageY;

  const beforeDrag = await snapshot(page);
  await page.touchscreen.tap(target.pageX, target.pageY); // reset selection state
  await page.waitForTimeout(200);

  // Playwright's `touchscreen` has no drag primitive, so drive the real touch
  // protocol through CDP. Note `Input.dispatchTouchEvent` takes VIEWPORT
  // coordinates, and `page.touchscreen.tap` above used the same space — so the
  // container-relative `graphToViewport` result must have the container's page
  // offset added first (it is, in `target`). Dispatching synthetic `TouchEvent`s
  // from `page.evaluate` does NOT work here: Sigma's TouchCaptor listens on the
  // container, and a hand-built event is not trusted (and does not reproduce the
  // browser's real touch pipeline), so the drag silently never starts.
  const cdp = await page.context().newCDPSession(page);
  const touchPoint = (x, y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 }];

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(target.pageX, target.pageY) });
  for (let i = 1; i <= 18; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touchPoint(target.pageX + i * 9, target.pageY + i * 4),
    });
    await page.waitForTimeout(16);
  }
  const afterMove = await snapshot(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);

  results.afterTouchDrag = await page.evaluate(() => {
    const layout = globalThis.__nostosLayout;
    return {
      pinned: layout.nodes().filter((n) => n.fx != null || n.fy != null).length,
      alpha: +layout.alpha().toFixed(5),
      cameraEnabled: globalThis.__nostosSigma.getCamera().enabled,
    };
  });
  const midDrag = afterMove;
  let moved = 0; let furthest = 0;
  for (const k of Object.keys(midDrag)) {
    const d = Math.hypot(midDrag[k][0] - beforeDrag[k][0], midDrag[k][1] - beforeDrag[k][1]);
    if (d > 1) moved += 1;
    if (d > furthest) furthest = d;
  }
  results.touchDragMovement = { moved, furthest: +furthest.toFixed(1) };

  if (results.afterTouchDrag.pinned !== 0) fail.push(`touch drag left ${results.afterTouchDrag.pinned} node(s) pinned`);
  if (!results.afterTouchDrag.cameraEnabled) fail.push('touch drag left the camera disabled');
  if (results.touchDragMovement.moved < 2) fail.push(`touch drag moved only ${results.touchDragMovement.moved} nodes (neighbours did not follow)`);

  // Inertia: does it keep settling, then stop?
  const settling = [];
  let last = midDrag;
  for (const wait of [200, 400, 800]) {
    await page.waitForTimeout(wait);
    const now = await snapshot(page);
    let m = 0;
    for (const k of Object.keys(now)) {
      if (Math.hypot(now[k][0] - last[k][0], now[k][1] - last[k][1]) > 1) m += 1;
    }
    settling.push({ afterMs: wait, moved: m });
    last = now;
  }
  results.settling = settling;
  if (settling.every((s) => s.moved === 0)) fail.push('no inertia: 0 nodes moved after the touch release');

  // And it must stop.
  await page.waitForTimeout(9000);
  const a = await snapshot(page);
  await page.waitForTimeout(3000);
  const b = await snapshot(page);
  let idleMoved = 0;
  for (const k of Object.keys(a)) {
    if (Math.hypot(b[k][0] - a[k][0], b[k][1] - a[k][1]) > 0.01) idleMoved += 1;
  }
  results.idle = { moved: idleMoved, alpha: await page.evaluate(() => +globalThis.__nostosLayout.alpha().toFixed(6)) };
  if (idleMoved !== 0) fail.push(`layout still churning at idle: ${idleMoved} nodes moved`);

  await page.close();
}

/* ── 2. Rail geometry (#122) at phone width. ── */
{
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  })).newPage();
  await openMap(page);

  results.rail = await page.evaluate(() => {
    const rail = document.querySelector('[role="toolbar"][aria-label="Map actions"]');
    const buttons = [...rail.querySelectorAll('button')];
    const rects = buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
    });
    // Smallest horizontal gap between any two targets.
    const sorted = [...rects].sort((a, b) => a.left - b.left);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].left - sorted[i - 1].right;
      if (gap >= 0 && gap < minGap) minGap = gap;
    }
    // Distinct SVG ink per button = distinct glyph.
    const glyphs = buttons.map((b) => (b.querySelector('svg')?.innerHTML ?? '').length);
    return {
      targets: rects.length,
      minSize: Math.min(...rects.map((r) => Math.min(r.w, r.h))),
      minGapPx: minGap === Infinity ? null : Math.round(minGap),
      distinctGlyphs: new Set(glyphs).size,
      labels: rects.map((r) => r.label),
      railHeight: Math.round(rail.getBoundingClientRect().height),
    };
  });

  if (results.rail.minGapPx !== null && results.rail.minGapPx < 4) fail.push(`tap targets only ${results.rail.minGapPx}px apart`);
  if (results.rail.minSize < 44) fail.push(`a tap target is only ${results.rail.minSize}px`);
  if (results.rail.distinctGlyphs !== results.rail.targets) fail.push(`only ${results.rail.distinctGlyphs} distinct glyphs for ${results.rail.targets} buttons`);

  await page.close();
}

/* ── 3. Desktop: framing + labels still good (#134). ── */
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await openMap(page);
  results.desktop = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions();
    const pts = [];
    g.forEachNode((id, a) => {
      const p = sig.graphToViewport({ x: a.x, y: a.y });
      pts.push({ x: p.x, y: p.y, r: sig.scaleSize(a.size) });
    });
    let overlaps = 0; const nn = [];
    for (let i = 0; i < pts.length; i += 1) {
      let best = Infinity;
      for (let j = 0; j < pts.length; j += 1) {
        if (i === j) continue;
        const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (dist < best) best = dist;
        if (j > i && dist < pts[i].r + pts[j].r) overlaps += 1;
      }
      nn.push(best);
    }
    nn.sort((x, y) => x - y);
    let offscreen = pts.filter((p) => p.x < 0 || p.x > d.width || p.y < 0 || p.y > d.height).length;
    return {
      nodes: pts.length,
      overlaps,
      offscreen,
      medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
      labels: (() => { try { return sig.getNodeDisplayedLabels().size; } catch { return null; } })(),
    };
  });
  if (results.desktop.overlaps !== 0) fail.push(`${results.desktop.overlaps} overlapping node pairs on desktop`);
  if (results.desktop.offscreen !== 0) fail.push(`${results.desktop.offscreen} nodes off screen on desktop`);
  await page.close();
}

results.failures = fail;
results.pass = fail.length === 0;
writeFileSync(`${OUT}/combined-verify.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
console.log(fail.length === 0 ? '\nCOMBINED: PASS' : `\nCOMBINED: FAIL (${fail.length})\n  - ` + fail.join('\n  - '));
await browser.close();
process.exit(fail.length === 0 ? 0 : 1);
