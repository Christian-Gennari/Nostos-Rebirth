/**
 * Verify two claims about the fixed mobile layout:
 *  1. are the map controls actually 44px (touch minimum) on a phone?
 *  2. does the bottom dock overlap the graph stage, i.e. is any part of the
 *     canvas hidden behind the dock?
 *
 * Both are measurable in CSS pixels, so neither needs a judgement call.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5321').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/claims';
mkdirSync(OUT, { recursive: true });

const DEVICES = [
  { name: 'iphone-14', w: 390, h: 844, dsf: 3 },
  { name: 'iphone-se', w: 375, h: 667, dsf: 2 },
  { name: 'pixel-7', w: 412, h: 915, dsf: 2.6 },
  { name: 'landscape-844', w: 844, h: 390, dsf: 3 },
  { name: 'ipad-mini', w: 744, h: 1133, dsf: 2 },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = [];

for (const dev of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dsf, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const drop = () => document.querySelectorAll('vite-error-overlay').forEach((n) => n.remove());
    const start = () => { drop(); if (document.documentElement) new MutationObserver(drop).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  });
  await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt').last().click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => {
    const rect = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    const stage = document.querySelector('.sigma-container');
    const dock = document.querySelector('app-app-dock');
    const strip = document.querySelector('.map-controls');
    const stripH = strip ? Math.round(strip.getBoundingClientRect().height) : -1;
    const controls = [...document.querySelectorAll('.map-controls button')].map((b) => ({
      label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 20),
      ...rect(b),
    }));
    const s = stage ? rect(stage) : null;
    const d = dock ? rect(dock) : null;
    // Overlap of the stage rectangle with the dock rectangle.
    let overlapPx = 0;
    if (s && d) overlapPx = Math.max(0, Math.min(s.bottom, d.bottom) - Math.max(s.top, d.top));
    // Also: how many graph NODES render inside the dock's band?
    let nodesBehindDock = 0;
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    if (sig && g && d) {
      const stageRect = stage.getBoundingClientRect();
      g.forEachNode((id, a) => {
        const v = sig.graphToViewport({ x: a.x, y: a.y });
        const screenY = stageRect.top + v.y;
        if (screenY > d.top && screenY < d.bottom) nodesBehindDock++;
      });
    }
    return {
      stripH,
      viewport: `${innerWidth}x${innerHeight}`,
      stage: s,
      dock: d,
      stageDockOverlapPx: overlapPx,
      nodesBehindDock,
      controls,
      controlsUnder44: controls.filter((c) => c.w < 44 || c.h < 44).map((c) => `${c.label} ${c.w}x${c.h}`),
    };
  });

  out.push({ device: dev.name, ...r });
  await ctx.close();
}

writeFileSync(path.join(OUT, 'claims.json'), JSON.stringify(out, null, 2));
for (const r of out) {
  console.log(`\n=== ${r.device} (${r.viewport}) ===`);
  console.log(`  stage ${JSON.stringify(r.stage)}`);
  console.log(`  dock  ${JSON.stringify(r.dock)}`);
  console.log(`  control strip height: ${r.stripH}px`);
console.log(`  STAGE/DOCK overlap: ${r.stageDockOverlapPx}px   nodes rendered in the dock band: ${r.nodesBehindDock}`);
  console.log(`  controls under 44px: ${r.controlsUnder44.length}${r.controlsUnder44.length ? ' -> ' + JSON.stringify(r.controlsUnder44) : ''}`);
  console.log(`  control sizes: ${r.controls.map((c) => `${c.w}x${c.h}`).join(', ')}`);
}
await browser.close();
