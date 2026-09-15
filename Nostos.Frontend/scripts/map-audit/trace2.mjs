/**
 * Robust edge-tracing measurement.
 *
 * The earlier probe sampled a 16px box at an edge midpoint and was confounded:
 * a hub's eight bright edges radiate across the graph, so a random midpoint
 * often coincides with a crossing edge. This classifies the WHOLE edge layer
 * instead — every pixel that belongs to the edge canvas — into "bright"
 * (accent-ink edges, i.e. ones touching the focused node) and "dim" (everything
 * else), and reports the balance before and after focusing.
 *
 * That is the question the user actually asked: when I pick a node, can I tell
 * which lines are its own?
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/trace2';
const THEME = process.argv[4] ?? 'light';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.addInitScript(() => {
  const drop = () => document.querySelectorAll('vite-error-overlay').forEach((n) => n.remove());
  const start = () => { drop(); if (document.documentElement) new MutationObserver(drop).observe(document.documentElement, { childList: true, targets: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
});
await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
if (THEME === 'dark') {
  await page.evaluate(() => localStorage.setItem('nostos.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
}
await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
await page.locator('.view-mode-control .toggle-opt:last-child').click();
await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(3000);

const stage = page.locator('.sigma-container');
const box = await stage.boundingBox();

/** Isolate the edge layer and classify its ink by luminance. */
async function classify(tag) {
  await page.evaluate(() => {
    document.querySelectorAll('.sigma-container canvas').forEach((c) => (c.style.visibility = ''));
    document.querySelectorAll('.sigma-container canvas:not(.sigma-edges)').forEach((c) => (c.style.visibility = 'hidden'));
  });
  await page.waitForTimeout(450);
  const withEdges = await stage.screenshot();
  await page.evaluate(() => document.querySelectorAll('.sigma-edges').forEach((c) => (c.style.visibility = 'hidden')));
  await page.waitForTimeout(400);
  const withoutEdges = await stage.screenshot();
  await page.evaluate(() => document.querySelectorAll('.sigma-container canvas').forEach((c) => (c.style.visibility = '')));
  await page.waitForTimeout(300);

  const A = PNG.sync.read(withEdges), B = PNG.sync.read(withoutEdges);
  // Only pixels the edge layer contributed.
  const lum = (r, g, b) => { const f = (v) => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };

  const samples = [];
  for (let i = 0; i < A.data.length; i += 4) {
    const delta = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
    if (delta > 30) {
      // The field colour is the "without edges" value; the ink is "with edges".
      const ink = lum(A.data[i], A.data[i+1], A.data[i+2]);
      const field = lum(B.data[i], B.data[i+1], B.data[i+2]);
      samples.push({ ink, field, ratio: (Math.max(ink, field) + 0.05) / (Math.min(ink, field) + 0.05) });
    }
  }
  samples.sort((a, b) => a.ratio - b.ratio);
  const mid = Math.floor(samples.length / 2);
  const fieldLum = samples.length ? samples[mid].field : 0;
  // "Bright" = clearly above the field (accent ink); "dim" = a modest lift.
  const bright = samples.filter((s) => s.ink > fieldLum + 0.12).length;
  const dim = samples.length - bright;

  return {
    tag,
    edgePixels: samples.length,
    brightPixels: bright,
    dimPixels: dim,
    brightSharePct: samples.length ? +(100 * bright / samples.length).toFixed(1) : 0,
    medianRatio: samples.length ? +samples[mid].ratio.toFixed(2) : 0,
    p25Ratio: samples.length ? +samples[Math.floor(samples.length * 0.25)].ratio.toFixed(2) : 0,
    p75Ratio: samples.length ? +samples[Math.floor(samples.length * 0.75)].ratio.toFixed(2) : 0,
    fieldLum: +fieldLum.toFixed(4),
  };
}

const out = { theme: THEME };

const plan = await page.evaluate(() => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  const deg = new Map();
  g.forEachEdge((e, a, s, t) => { deg.set(s, (deg.get(s) ?? 0) + 1); deg.set(t, (deg.get(t) ?? 0) + 1); });
  let hub = null;
  g.forEachNode((id, a) => { const d = deg.get(id) ?? 0; if (!hub || d > hub.d) hub = { id, label: a.label, d }; });
  const a = g.getNodeAttributes(hub.id);
  const p = sig.graphToViewport({ x: a.x, y: a.y });
  return { id: hub.id, label: hub.label, degree: hub.d, p };
});
out.hub = plan.label;
out.hubDegree = plan.degree;

out.unfocused = await classify('unfocused');

// Focus by hovering the hub.
await page.mouse.move(box.x + plan.p.x, box.y + plan.p.y);
await page.waitForTimeout(1500);
out.focused = await classify('focused');

// Clear the hover.
await page.mouse.move(box.x + 10, box.y + box.height - 10);
await page.waitForTimeout(1300);
out.afterClear = await classify('after-clear');

// And with a SELECTION rather than a hover.
await page.mouse.click(box.x + plan.p.x, box.y + plan.p.y);
await page.waitForTimeout(1600);
out.selected = await classify('selected');

writeFileSync(path.join(OUT, `trace2-${THEME}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
