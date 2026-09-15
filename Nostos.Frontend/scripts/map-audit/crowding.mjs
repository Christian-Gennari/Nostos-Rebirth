/**
 * Crowding probe: how close are nodes to each other on screen?
 *
 * A vision read of "hairball" is only actionable if it is measurable. Reports,
 * for the fitted view: nearest-neighbour distance between node centres, and how
 * many node PAIRS overlap once their radii are accounted for.
 *
 * Run once per tuning; compare the JSON outputs.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/crowding';
const LABEL = process.argv[4] ?? 'current';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
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

const out = { label: LABEL, baseUrl: BASE };

out.crowding = await page.evaluate(() => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  const d = sig.getDimensions();
  const pts = [];
  g.forEachNode((id, a) => {
    const p = sig.graphToViewport({ x: a.x, y: a.y });
    pts.push({ label: a.label, x: p.x, y: p.y, r: sig.scaleSize(a.size) });
  });
  const nn = [];
  let overlapping = 0;
  const examples = [];
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (dist < best) best = dist;
      if (j > i && dist < pts[i].r + pts[j].r) {
        overlapping++;
        if (examples.length < 6) examples.push({ a: pts[i].label, b: pts[j].label, dist: +dist.toFixed(1), need: +(pts[i].r + pts[j].r).toFixed(1) });
      }
    }
    nn.push(best);
  }
  nn.sort((a, b) => a - b);
  return {
    nodes: pts.length,
    minNN: +nn[0].toFixed(1),
    p10NN: +nn[Math.floor(nn.length * 0.1)].toFixed(1),
    p25NN: +nn[Math.floor(nn.length * 0.25)].toFixed(1),
    medianNN: +nn[Math.floor(nn.length / 2)].toFixed(1),
    meanNN: +(nn.reduce((a, b) => a + b, 0) / nn.length).toFixed(1),
    overlappingPairs: overlapping,
    overlapExamples: examples,
    stage: { w: Math.round(d.width), h: Math.round(d.height) },
    settings: {
      labelThreshold: sig.settings.labelRenderedSizeThreshold,
      labelDensity: sig.settings.labelDensity,
      labelGridCellSize: sig.settings.labelGridCellSize,
    },
  };
});

out.displayedLabels = await page.evaluate(() => {
  try { return globalThis.__nostosSigma.getNodeDisplayedLabels().size; } catch { return null; }
});

writeFileSync(path.join(OUT, `crowd-${LABEL}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
