/**
 * Disambiguate what "dimming" actually dims.
 *
 * The patch-max probe cannot tell a dimmed node DOT from a dimmed LABEL, because
 * it reports only the strongest pixel within a 44px box — and it can also catch a
 * bright accent edge radiating from a hub. Sample the exact element instead:
 *   - the node centre pixel (the dot),
 *   - the label pixels below the node,
 * with the true theme tokens read from CSS so the expected contrast is computed
 * rather than assumed.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5214').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/dim2';
const THEME = process.argv[4] ?? 'light';
mkdirSync(OUT, { recursive: true });

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => {
  const La = lum(a), Lb = lum(b);
  const hi = Math.max(La, Lb), lo = Math.min(La, Lb);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(3);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
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

// The theme tokens the renderer actually reads.
const tokens = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return { node: g('--graph-node'), nodeHead: g('--graph-node-head'), label: g('--graph-label'), labelActive: g('--graph-label-active') };
});

const plan = await page.evaluate(() => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  const deg = new Map();
  g.forEachEdge((e, a, s, t) => { deg.set(s, (deg.get(s) ?? 0) + 1); deg.set(t, (deg.get(t) ?? 0) + 1); });
  let hub = null;
  g.forEachNode((id, a) => { const d = deg.get(id) ?? 0; if (!hub || d > hub.d) hub = { id, label: a.label, d }; });
  const nb = new Set(); g.forEachNeighbor(hub.id, (n) => nb.add(n));
  let other = null;
  g.forEachNode((id, a) => {
    if (id === hub.id || nb.has(id)) return;
    const d = deg.get(id) ?? 0;
    if (a.label && (!other || d < other.d)) other = { id, label: a.label, d, size: a.size };
  });
  const p = (id, dy = 0) => { const a = g.getNodeAttributes(id); const v = sig.graphToViewport({ x: a.x, y: a.y }); return { x: v.x, y: v.y + dy }; };
  return { hub: { ...hub, p: p(hub.id) }, other: { ...other, p: p(other.id), pLabel: p(other.id, 16) } };
});

/** Read one pixel from a fresh stage screenshot. */
async function pixelAt(pt) {
  const buf = await stage.screenshot();
  const png = PNG.sync.read(buf);
  const x = Math.round(pt.x), y = Math.round(pt.y);
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

const field = await pixelAt({ x: 6, y: 6 });

const out = { theme: THEME, tokens, hub: plan.hub.label, other: plan.other.label, otherSize: plan.other.size, field };

out.otherDotBefore = await pixelAt(plan.other.p);
out.otherLabelBefore = await pixelAt(plan.other.pLabel);

await page.mouse.click(box.x + plan.hub.p.x, box.y + plan.hub.p.y);
await page.waitForTimeout(1600);

out.otherDotAfter = await pixelAt(plan.other.p);
out.otherLabelAfter = await pixelAt(plan.other.pLabel);
out.hubDotAfter = await pixelAt(plan.hub.p);

out.derived = {
  dotContrastBefore: contrast(out.otherDotBefore, field),
  dotContrastAfter: contrast(out.otherDotAfter, field),
  dotRetainedPct: Math.round(100 * contrast(out.otherDotAfter, field) / Math.max(contrast(out.otherDotBefore, field), 0.01)),
  labelContrastBefore: contrast(out.otherLabelBefore, field),
  labelContrastAfter: contrast(out.otherLabelAfter, field),
  labelRetainedPct: Math.round(100 * contrast(out.otherLabelAfter, field) / Math.max(contrast(out.otherLabelBefore, field), 0.01)),
  hubContrastForReference: contrast(out.hubDotAfter, field),
};

writeFileSync(path.join(OUT, `dim2-${THEME}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
