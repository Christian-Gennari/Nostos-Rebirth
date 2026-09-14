/**
 * Derive the correct fit ratio viewport-agnostically.
 *
 * `sigma.graphToViewport(point, { cameraState })` evaluates the mapping for a
 * SUPPLIED camera state without needing a re-render, which makes it an exact
 * oracle for the fit maths. Probe the graph extent at ratio 1 with the override,
 * then solve the ratio that brings it inside the padded stage.
 *
 * Validated on both a desktop and a portrait viewport, since the previous
 * max(W,H) formula silently under-fitted whenever W < H.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5214').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/fit-oracle';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];

for (const vp of [
  { name: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { name: 'portrait', width: 390, height: 844, dsf: 2, mobile: true },
  { name: 'square', width: 700, height: 700, dsf: 1, mobile: false },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2800);

  const r = await page.evaluate((occupancy) => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    g.forEachNode((id, a) => {
      minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
      minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
    });
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

    // Oracle: evaluate the mapping at ratio 1 with an explicit camera state.
    const base = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
    const a = sig.graphToViewport({ x: minX, y: minY }, { cameraState: base });
    const b = sig.graphToViewport({ x: maxX, y: maxY }, { cameraState: base });
    const spanAt1 = { w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };

    // screenSpan scales as 1/ratio, so this is the ratio that just fits.
    const ratio = Math.max(spanAt1.w / (d.width * occupancy), spanAt1.h / (d.height * occupancy));

    // Verify against the oracle at that ratio.
    const cs = { x: 0.5, y: 0.5, angle: 0, ratio };
    const c = sig.graphToViewport({ x: minX, y: minY }, { cameraState: cs });
    const e = sig.graphToViewport({ x: maxX, y: maxY }, { cameraState: cs });
    const spanAtRatio = { w: Math.abs(e.x - c.x), h: Math.abs(e.y - c.y) };

    return {
      dims: d,
      extent: { spanX: +(maxX - minX).toFixed(2), spanY: +(maxY - minY).toFixed(2) },
      spanAt1: { w: +spanAt1.w.toFixed(1), h: +spanAt1.h.toFixed(1) },
      derivedRatio: +ratio.toFixed(4),
      predictedSpan: { w: +spanAtRatio.w.toFixed(1), h: +spanAtRatio.h.toFixed(1) },
      paddedStage: { w: +(d.width * occupancy).toFixed(1), h: +(d.height * occupancy).toFixed(1) },
      fits: spanAtRatio.w <= d.width * occupancy + 0.5 && spanAtRatio.h <= d.height * occupancy + 0.5,
      cameraRatioCurrentlyShipped: +sig.getCamera().ratio.toFixed(4),
    };
  }, 0.88);

  // Falsification: set the ORACLE-derived ratio and count off-screen nodes after
  // a render, then do the same with the value the shipped build currently uses.
  const verify = await page.evaluate(async ({ ratio }) => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions();
    const count = () => {
      let off = 0;
      g.forEachNode((id, a) => { const p = sig.graphToViewport({ x: a.x, y: a.y }); if (p.x < 0 || p.x > d.width || p.y < 0 || p.y > d.height) off++; });
      return off;
    };
    const shipped = count();
    sig.getCamera().setState({ x: 0.5, y: 0.5, ratio });
    sig.refresh();
    await new Promise((r) => setTimeout(r, 500));
    return { offscreenWithShippedRatio: shipped, offscreenWithOracleRatio: count() };
  }, { ratio: r.derivedRatio });

  results.push({ viewport: vp.name, ...r, ...verify });
  await ctx.close();
}

writeFileSync(path.join(OUT, 'fit-oracle.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
