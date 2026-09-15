/**
 * Selection-dimming probe.
 *
 * User report: "if i highlight one node, all non connected nodes melt into the
 * background because they become so light".
 *
 * Measures the composite contrast of a NON-connected node while another node is
 * selected, versus its contrast with nothing selected. A node that is dimmed to
 * near-invisibility shows up as a large drop in contrast; a legible dim shows a
 * modest one.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/dim';
const THEME = process.argv[4] ?? 'light';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.addInitScript(() => {
  const drop = () => document.querySelectorAll('vite-error-overlay').forEach((n) => n.remove());
  const start = () => { drop(); if (document.documentElement) new MutationObserver(drop).observe(document.documentElement, { childList: true, subtree: true }); };
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

/** Sample a small patch around a screen point and return its strongest ink contrast. */
async function patchContrast(p, label) {
  const buf = await stage.screenshot();
  writeFileSync(path.join(OUT, `dim-${THEME}-${label}.png`), buf);
  const png = PNG.sync.read(buf);
  const W = png.width, H = png.height;
  // Modal colour = field.
  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const k = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bgKey = 0, bgN = -1;
  for (const [k, n] of counts) if (n > bgN) { bgN = n; bgKey = k; }
  const bg = [(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255];

  // Patch around the node (allow for its radius).
  const R = 22;
  let best = { d: 0, rgb: null };
  let ink = 0;
  for (let y = Math.max(0, Math.round(p.y - R)); y < Math.min(H, Math.round(p.y + R)); y++) {
    for (let x = Math.max(0, Math.round(p.x - R)); x < Math.min(W, Math.round(p.x + R)); x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(png.data[i] - bg[0]) + Math.abs(png.data[i + 1] - bg[1]) + Math.abs(png.data[i + 2] - bg[2]);
      if (d > 60) ink++;
      if (d > best.d) best = { d, rgb: [png.data[i], png.data[i + 1], png.data[i + 2]] };
    }
  }
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const La = lum(best.rgb ?? bg), Lb = lum(bg);
  const hi = Math.max(La, Lb), lo = Math.min(La, Lb);
  return { bg, strongest: best, inkPixels: ink, contrast: +((hi + 0.05) / (lo + 0.05)).toFixed(3) };
}

// Find: (a) the node we will select, (b) a node NOT connected to it.
const plan = await page.evaluate(() => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  let hub = null;
  const deg = new Map();
  g.forEachEdge((e, a, s, t) => { deg.set(s, (deg.get(s) ?? 0) + 1); deg.set(t, (deg.get(t) ?? 0) + 1); });
  g.forEachNode((id, a) => { const d = deg.get(id) ?? 0; if (!hub || d > hub.d) hub = { id, label: a.label, d }; });
  const neighbors = new Set();
  g.forEachNeighbor(hub.id, (n) => neighbors.add(n));
  // A disconnected-ish node with a label, ideally a leaf.
  let other = null;
  g.forEachNode((id, a) => {
    if (id === hub.id || neighbors.has(id)) return;
    const d = deg.get(id) ?? 0;
    if (a.label && (!other || d < other.d)) other = { id, label: a.label, d };
  });
  const pOf = (id) => { const a = g.getNodeAttributes(id); return sig.graphToViewport({ x: a.x, y: a.y }); };
  return { hub: { ...hub, p: pOf(hub.id) }, other: other ? { ...other, p: pOf(other.id) } : null };
});

const out = { theme: THEME, hub: plan.hub.label, other: plan.other ? plan.other.label : null };

out.beforeSelection = await patchContrast(plan.other.p, 'before-other');

// Select the hub.
await page.mouse.click(box.x + plan.hub.p.x, box.y + plan.hub.p.y);
await page.waitForTimeout(1600);
out.afterSelection = await patchContrast(plan.other.p, 'after-other');
out.hubAfterSelection = await patchContrast(plan.hub.p, 'after-hub');

out.contrastRetainedPct = Math.round(
  (100 * out.afterSelection.contrast) / Math.max(out.beforeSelection.contrast, 0.01)
);

writeFileSync(path.join(OUT, `dim-${THEME}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
