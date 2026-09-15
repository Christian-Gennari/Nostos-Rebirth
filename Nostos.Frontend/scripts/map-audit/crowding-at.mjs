/**
 * Crowding + framing probe at an explicit viewport, so the SAME metric can be
 * compared across stage SHAPES. The existing crowding.mjs is desktop-only
 * (1440x900), and a landscape desktop viewport hides portrait-only defects.
 *
 * Usage: node scripts/map-audit/crowding-at.mjs <url> <outDir> <label> <W> <H>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/crowding-at';
const LABEL = process.argv[4] ?? 'current';
const W = Number(process.argv[5] ?? 1440);
const H = Number(process.argv[6] ?? 900);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
await page.addInitScript(() => {
  const drop = () => document.querySelectorAll('vite-error-overlay').forEach((n) => n.remove());
  const start = () => { drop(); if (document.documentElement) new MutationObserver(drop).observe(document.documentElement, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
});
await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
await page.locator('.view-mode-control .toggle-opt:last-child').click();
await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(3200);

const out = { label: LABEL, viewport: { W, H }, baseUrl: BASE };
out.metrics = await page.evaluate(() => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  const d = sig.getDimensions();
  const pts = [];
  g.forEachNode((id, a) => {
    const p = sig.graphToViewport({ x: a.x, y: a.y });
    pts.push({ label: a.label, x: p.x, y: p.y, r: sig.scaleSize(a.size) });
  });
  const nn = []; let overlapping = 0; const examples = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let offscreen = 0;
  for (const p of pts) {
    if (p.x < 0 || p.x > d.width || p.y < 0 || p.y > d.height) offscreen += 1;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (dist < best) best = dist;
      if (j > i && dist < pts[i].r + pts[j].r) {
        overlapping++;
        if (examples.length < 5) examples.push({ a: pts[i].label, b: pts[j].label, dist: +dist.toFixed(1), need: +(pts[i].r + pts[j].r).toFixed(1) });
      }
    }
    nn.push(best);
  }
  nn.sort((a, b) => a - b);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  return {
    nodes: pts.length,
    stage: { w: Math.round(d.width), h: Math.round(d.height) },
    minNN: +nn[0].toFixed(1),
    p25NN: +nn[Math.floor(nn.length * 0.25)].toFixed(1),
    medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
    meanNodeRadius: +mean(pts.map((p) => p.r)).toFixed(1),
    overlappingPairs: overlapping,
    offscreen,
    fillX: +(((maxX - minX) / d.width)).toFixed(3),
    fillY: +(((maxY - minY) / d.height)).toFixed(3),
    overlapExamples: examples,
  };
});
out.displayedLabels = await page.evaluate(() => {
  try { return globalThis.__nostosSigma.getNodeDisplayedLabels().size; } catch { return null; }
});

writeFileSync(`${OUT}/${LABEL}-${W}x${H}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
