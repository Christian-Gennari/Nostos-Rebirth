/**
 * Read the dimmed node's colour from the REDUCER, not from pixels.
 *
 * Pixel sampling of a small node is unreliable: the node is only a few px across,
 * `graphToViewport` returns fractional coordinates, and rounding lands on an
 * anti-aliased edge — so a "centre pixel" reads a blend of node and field and
 * understates the node's real ink. An earlier box-max probe had the opposite
 * error and caught a distant dark edge.
 *
 * The reducer is the source of truth: after selecting a node for real, ask Sigma
 * what colour it would give a node that is not in the neighbourhood, then compute
 * the composite and its contrast analytically.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5214').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/reducer';
const THEME = process.argv[4] ?? 'light';
mkdirSync(OUT, { recursive: true });

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

// Pick the hub we will select, and a node outside its neighbourhood.
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
  const v = sig.graphToViewport({ x: g.getNodeAttributes(hub.id).x, y: g.getNodeAttributes(hub.id).y });
  return { hub: { ...hub, p: v }, other };
});

// The field colour the canvas shows behind the graph.
const field = [253, 248, 246];
const fieldDark = [21, 24, 31];
const bg = THEME === 'dark' ? fieldDark : field;

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => {
  const La = lum(a), Lb = lum(b), hi = Math.max(La, Lb), lo = Math.min(La, Lb);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(3);
};

/** Call the live nodeReducer for one node and return what it produces. */
async function reducedColor(nodeId) {
  return page.evaluate((id) => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const fn = sig.settings.nodeReducer;
    const data = { ...g.getNodeAttributes(id) };
    const out = fn(id, data);
    return { id, label: data.label, size: data.size, color: out.color, labelColor: out.labelColor, forceLabel: out.forceLabel ?? null };
  }, nodeId);
}

/**
 * Parse either a hex (`#rrggbb`) or an `rgb()` / `rgba()` string.
 *
 * Both forms occur: a node's base `color` attribute is hex, while the reducer
 * overwrites it with `rgba(...)`. Handling only one silently yields null and the
 * analysis block is skipped — which is how an earlier version of this probe
 * reported an empty result rather than a wrong number.
 */
const parseRgba = (s) => {
  const str = String(s ?? '').trim();
  const hex = str.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return {
      rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255],
      a: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
    };
  }
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  if (p.some((v) => !Number.isFinite(v))) return null;
  return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
};

/** Composite an rgba ink over an opaque field. */
const over = (ink, a, f) => ink.map((c, i) => Math.round(a * c + (1 - a) * f[i]));

const out = { theme: THEME, hub: plan.hub.label, other: plan.other.label, field: bg };

out.otherIdle = await reducedColor(plan.other.id);

// Select the hub for real, then re-ask the reducer.
await page.mouse.click(box.x + plan.hub.p.x, box.y + plan.hub.p.y);
await page.waitForTimeout(1600);
out.selectedNode = await page.evaluate(() => {
  const el = document.querySelector('.map-selection-name, .map-selection-bar');
  return el ? el.textContent.trim().slice(0, 60) : null;
});

out.otherDimmed = await reducedColor(plan.other.id);
out.hubActive = await reducedColor(plan.hub.id);

const idle = parseRgba(out.otherIdle.color);
const dim = parseRgba(out.otherDimmed.color);
out.analysis = {};
if (idle && dim) {
  const idleComposite = over(idle.rgb, idle.a, bg);
  const dimComposite = over(dim.rgb, dim.a, bg);
  out.analysis = {
    idleColor: out.otherIdle.color,
    dimmedColor: out.otherDimmed.color,
    dimAlpha: dim.a,
    idleComposite,
    dimComposite,
    idleContrast: contrast(idleComposite, bg),
    dimmedContrast: contrast(dimComposite, bg),
    retainedPct: Math.round(100 * contrast(dimComposite, bg) / Math.max(contrast(idleComposite, bg), 0.01)),
    meetsNonTextMinimum3to1: contrast(dimComposite, bg) >= 3,
    dimmedLabelPresent: out.otherDimmed.labelColor !== '' && out.otherDimmed.labelColor != null,
    dimmedLabelColor: out.otherDimmed.labelColor,
  };
}

writeFileSync(path.join(OUT, `reducer-${THEME}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
