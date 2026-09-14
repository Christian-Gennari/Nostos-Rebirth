/**
 * Label-collision probe.
 *
 * Rendering every label (100% coverage) can crowd a dense cluster, so measure
 * what the label canvas actually looks like rather than guessing. Sigma's label
 * grid is controlled by `labelDensity` and `labelGridCellSize`; this script
 * counts how many labels the renderer reports as displayed, and how many ink
 * blobs the label canvas contains, for a few density settings.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/labels';
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
await page.waitForTimeout(3000);

const stage = page.locator('.sigma-container');
const results = [];

async function measure(density, cellSize) {
  await page.evaluate(({ d, c }) => {
    const sig = globalThis.__nostosSigma;
    sig.setSetting('labelDensity', d);
    sig.setSetting('labelGridCellSize', c);
    sig.refresh();
  }, { d: density, c: cellSize });
  await page.waitForTimeout(900);

  const displayed = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma;
    const g = globalThis.__nostosGraph;
    let set = null;
    try { set = sig.getNodeDisplayedLabels(); } catch { set = null; }
    return { displayedLabels: set ? set.size : null, totalNodes: g.order };
  });

  // Count connected ink blobs on the label canvas via a screenshot of only it.
  const buf = await (async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.sigma-container canvas').forEach((c) => (c.style.visibility = ''));
      document.querySelectorAll('.sigma-container canvas:not(.sigma-labels)').forEach((c) => (c.style.visibility = 'hidden'));
    });
    await page.waitForTimeout(400);
    const b = await stage.screenshot();
    await page.evaluate(() => document.querySelectorAll('.sigma-container canvas').forEach((c) => (c.style.visibility = '')));
    return b;
  })();
  writeFileSync(path.join(OUT, `labels-d${density}-c${cellSize}.png`), buf);

  const png = PNG.sync.read(buf);
  // Ink = pixels that differ from the modal (field) colour.
  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const k = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bgKey = 0, bgN = -1;
  for (const [k, n] of counts) if (n > bgN) { bgN = n; bgKey = k; }
  const bg = [(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255];
  const W = png.width, H = png.height;
  const ink = new Uint8Array(W * H);
  let inkCount = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const delta =
      Math.abs(png.data[i] - bg[0]) + Math.abs(png.data[i + 1] - bg[1]) + Math.abs(png.data[i + 2] - bg[2]);
    if (delta > 60) { ink[p] = 1; inkCount++; }
  }
  // Connected components (4-neighbour) => roughly one blob per label.
  const seen = new Uint8Array(W * H);
  let blobs = 0;
  const sizes = [];
  for (let p = 0; p < W * H; p++) {
    if (!ink[p] || seen[p]) continue;
    blobs++;
    let n = 0;
    const stack = [p];
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop();
      n++;
      const x = q % W, y = (q / W) | 0;
      if (x > 0 && ink[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
      if (x < W - 1 && ink[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
      if (y > 0 && ink[q - W] && !seen[q - W]) { seen[q - W] = 1; stack.push(q - W); }
      if (y < H - 1 && ink[q + W] && !seen[q + W]) { seen[q + W] = 1; stack.push(q + W); }
    }
    sizes.push(n);
  }
  sizes.sort((a, b) => b - a);
  return {
    labelDensity: density,
    labelGridCellSize: cellSize,
    ...displayed,
    inkPixels: inkCount,
    inkPct: +(100 * inkCount / (W * H)).toFixed(3),
    blobs,
    largestBlobs: sizes.slice(0, 5),
    // Very large blobs indicate merged/touching labels.
    mergedBlobs: sizes.filter((s) => s > 900).length,
  };
}

for (const [densitySetting, cellSetting] of [[1, 100], [1.6, 100], [2.2, 100], [1.6, 140]]) {
  results.push(await measure(densitySetting, cellSetting));
}

writeFileSync(path.join(OUT, 'labels.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
