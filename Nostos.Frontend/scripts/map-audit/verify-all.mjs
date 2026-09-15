/**
 * Desktop regression + control-overlap check.
 *
 * The mobile work changed shared fit maths (per-axis scaling with an anisotropy
 * cap), so desktop framing must be re-measured rather than assumed unchanged.
 * Also checks the floating controls do not sit on top of nodes — on mobile they
 * overlay the bottom of the canvas.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5321').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/verify';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop-1440', w: 1440, h: 900, dsf: 1, mobile: false },
  { name: 'laptop-1280', w: 1280, h: 800, dsf: 1, mobile: false },
  { name: 'tablet-834', w: 834, h: 1112, dsf: 2, mobile: true },
  { name: 'iphone-14', w: 390, h: 844, dsf: 3, mobile: true },
  { name: 'iphone-se', w: 375, h: 667, dsf: 2, mobile: true },
  { name: 'landscape-844', w: 844, h: 390, dsf: 3, mobile: true },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const drop = () => document.querySelectorAll('vite-error-overlay').forEach((n) => n.remove());
    const start = () => { drop(); if (document.documentElement) new MutationObserver(drop).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  });

  await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt').last().click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3500);

  const r = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const dims = sig.getDimensions();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    g.forEachNode((id, a) => {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    });
    const a0 = sig.graphToViewport({ x: minX, y: minY });
    const a1 = sig.graphToViewport({ x: maxX, y: maxY });
    let off = 0;
    g.forEachNode((id, a) => {
      const v = sig.graphToViewport({ x: a.x, y: a.y });
      if (v.x < 0 || v.y < 0 || v.x > dims.width || v.y > dims.height) off++;
    });

    // Do floating controls sit on top of any node?
    const controls = [...document.querySelectorAll('.map-controls button')].map((b) => b.getBoundingClientRect());
    const covered = [];
    g.forEachNode((id, a) => {
      const v = sig.graphToViewport({ x: a.x, y: a.y });
      const r = a.size / 2 + 4;
      for (const c of controls) {
        if (v.x + r > c.left && v.x - r < c.right && v.y + r > c.top && v.y - r < c.bottom) {
          covered.push(String(a.label).slice(0, 20)); break;
        }
      }
    });

    // Touch-target sizes.
    const tiny = [...document.querySelectorAll('.map-controls button, .map-controls .map-control-label')]
      .map((b) => { const bb = b.getBoundingClientRect(); return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 18), w: Math.round(bb.width), h: Math.round(bb.height) }; })
      .filter((c) => c.w < 44 || c.h < 44);

    return {
      stage: { w: Math.round(dims.width), h: Math.round(dims.height) },
      fillX: Math.round(100 * Math.abs(a1.x - a0.x) / dims.width),
      fillY: Math.round(100 * Math.abs(a1.y - a0.y) / dims.height),
      spanX: Math.round(Math.abs(a1.x - a0.x)),
      spanY: Math.round(Math.abs(a1.y - a0.y)),
      offscreen: off,
      nodesCoveredByControls: covered.length,
      coveredLabels: covered.slice(0, 5),
      tinyTargets: tiny,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  await page.screenshot({ path: path.join(OUT, `${vp.name}.png`) });
  out.push({ viewport: vp.name, ...r, errors });
  await ctx.close();
}

writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(out, null, 2));
for (const r of out) {
  console.log(`${r.viewport.padEnd(15)} stage ${String(r.stage.w).padStart(4)}x${String(r.stage.h).padStart(4)}  fill ${String(r.fillX).padStart(2)}%x${String(r.fillY).padStart(2)}%  span ${String(r.spanX).padStart(3)}x${String(r.spanY).padStart(3)}  offscreen ${r.offscreen}  covered-by-controls ${r.nodesCoveredByControls}${r.coveredLabels.length ? ' ' + JSON.stringify(r.coveredLabels) : ''}  tiny ${r.tinyTargets.length}  hOverflow ${r.horizontalOverflow}  errors ${r.errors.length}`);
}
await browser.close();
