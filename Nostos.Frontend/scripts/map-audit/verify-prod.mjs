/**
 * Verify the DEPLOYED production instance (not the dev server).
 *
 * Confirms the merged fixes are live at the served origin by measuring the real
 * renderer through the running app, in both themes, and capturing screenshots.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5214').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/prod';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = { baseUrl: BASE, themes: {} };

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
  if (theme === 'dark') {
    await page.evaluate(() => localStorage.setItem('nostos.theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  // Wait for the open-time Fit animation to settle before measuring framing.
  // Measuring early, or after this script's own drag/fit steps have run, reads a
  // different fill (56% vs 64% width) and would misreport the shipped framing.
  await page.waitForTimeout(3200);

  await page.screenshot({ path: path.join(OUT, `prod-${theme}-page.png`) });
  await page.locator('.sigma-container').screenshot({ path: path.join(OUT, `prod-${theme}-stage.png`) });

  // On-open framing.
  const framing = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    if (!sig || !g) return { hooks: false };
    const d = sig.getDimensions();
    const xs = [], ys = [], off = [];
    g.forEachNode((id, a) => {
      const p = sig.graphToViewport({ x: a.x, y: a.y });
      xs.push(p.x); ys.push(p.y);
      if (p.x < 0 || p.x > d.width || p.y < 0 || p.y > d.height) off.push(a.label);
    });
    return {
      hooks: true,
      order: g.order,
      edges: g.size,
      offscreen: off.length,
      fillW: Math.round(100 * (Math.max(...xs) - Math.min(...xs)) / d.width),
      fillH: Math.round(100 * (Math.max(...ys) - Math.min(...ys)) / d.height),
      centreOffsetX: Math.round((Math.min(...xs) + Math.max(...xs)) / 2 - d.width / 2),
      centreOffsetY: Math.round((Math.min(...ys) + Math.max(...ys)) / 2 - d.height / 2),
      labelThreshold: sig.settings.labelRenderedSizeThreshold,
      labelDensity: sig.settings.labelDensity,
      autoRescale: sig.settings.autoRescale,
      displayedLabels: (() => { try { return sig.getNodeDisplayedLabels().size; } catch { return null; } })(),
      nodeSizes: (() => { const s = []; g.forEachNode((i, a) => s.push(a.size)); return { min: Math.min(...s), max: Math.max(...s) }; })(),
      edgeColors: (() => { const c = []; g.forEachEdge((e, a) => c.push(a.color)); return [...new Set(c)]; })(),
    };
  });

  // Edge contrast, by diffing the edge layer out of the composite.
  const stage = page.locator('.sigma-container');
  const withEdges = await stage.screenshot();
  await page.evaluate(() => document.querySelectorAll('.sigma-edges').forEach((c) => (c.style.visibility = 'hidden')));
  await page.waitForTimeout(500);
  const withoutEdges = await stage.screenshot();
  await page.evaluate(() => document.querySelectorAll('.sigma-edges').forEach((c) => (c.style.visibility = '')));
  await page.waitForTimeout(400);

  const A = PNG.sync.read(withEdges), B = PNG.sync.read(withoutEdges);
  let n = 0, maxD = 0, sumD = 0, strongest = null;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i+1] - B.data[i+1]) + Math.abs(A.data[i+2] - B.data[i+2]);
    if (d > 30) { n++; sumD += d; if (d > maxD) { maxD = d; strongest = { over: [A.data[i],A.data[i+1],A.data[i+2]], under: [B.data[i],B.data[i+1],B.data[i+2]] }; } }
  }
  const lum = (c) => { const f = (v) => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
  let edgeContrast = null;
  if (strongest) {
    const La = lum(strongest.over), Lb = lum(strongest.under);
    const hi = Math.max(La, Lb), lo = Math.min(La, Lb);
    edgeContrast = +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  }

  // Fit / Reset / Center behaviour on the live instance.
  const box = await stage.boundingBox();
  const t = await page.evaluate(() => {
    let best = null;
    globalThis.__nostosGraph.forEachNode((id, a) => { if (!best || a.size > best.size) best = { id, label: a.label, a }; });
    const p = globalThis.__nostosSigma.graphToViewport({ x: best.a.x, y: best.a.y });
    return { id: best.id, label: best.label, vp: p, home: { x: best.a.x, y: best.a.y } };
  });
  // Drag it.
  await page.mouse.move(box.x + t.vp.x, box.y + t.vp.y);
  await page.waitForTimeout(220);
  await page.mouse.down();
  await page.waitForTimeout(170);
  for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x + t.vp.x + i * 16, box.y + t.vp.y + i * 10); await page.waitForTimeout(50); }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const afterDrag = await page.evaluate((id) => {
    const a = globalThis.__nostosGraph.getNodeAttributes(id);
    return { x: +a.x.toFixed(2), y: +a.y.toFixed(2) };
  }, t.id);
  const dragWorked = Math.hypot(afterDrag.x - t.home.x, afterDrag.y - t.home.y) > 1;

  // Fit.
  await page.locator('.map-controls button', { hasText: 'Fit' }).first().click();
  await page.waitForTimeout(1700);
  const afterFit = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions(); const xs = [], ys = [], off = [];
    g.forEachNode((id, a) => { const p = sig.graphToViewport({ x: a.x, y: a.y }); xs.push(p.x); ys.push(p.y); if (p.x<0||p.x>d.width||p.y<0||p.y>d.height) off.push(a.label); });
    return { offscreen: off.length, fillW: Math.round(100*(Math.max(...xs)-Math.min(...xs))/d.width), cam: +sig.getCamera().ratio.toFixed(3) };
  });

  // Reset layout.
  await page.locator('.map-controls button', { hasText: 'Reset layout' }).first().click();
  await page.waitForTimeout(1700);
  const afterReset = await page.evaluate((id) => {
    const a = globalThis.__nostosGraph.getNodeAttributes(id);
    return { x: +a.x.toFixed(2), y: +a.y.toFixed(2) };
  }, t.id);
  const resetRestored = Math.hypot(afterReset.x - t.home.x, afterReset.y - t.home.y) < 0.5;

  // Center: click the node (must select), then Center.
  await page.mouse.click(box.x + t.vp.x, box.y + t.vp.y);
  await page.waitForTimeout(1400);
  const selected = await page.evaluate(() => document.querySelector('.map-selection-bar') !== null);
  let centered = null;
  if (selected) {
    await page.locator('.map-controls button', { hasText: 'Center' }).first().click();
    await page.waitForTimeout(1800);
    centered = await page.evaluate((id) => {
      const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
      const d = sig.getDimensions();
      const a = g.getNodeAttributes(id);
      const p = sig.graphToViewport({ x: a.x, y: a.y });
      return { offX: Math.round(p.x - d.width/2), offY: Math.round(p.y - d.height/2) };
    }, t.id);
  }

  out.themes[theme] = {
    framing,
    edgeLayer: { pixels: n, maxDelta: maxD, meanDelta: +(sumD / Math.max(1, n)).toFixed(1), strongest, contrast: edgeContrast },
    controls: { dragWorked, afterFit, resetRestored, clickSelects: selected, centered },
    consoleErrors: errors.slice(0, 10),
  };
  await ctx.close();
}

writeFileSync(path.join(OUT, 'prod.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
