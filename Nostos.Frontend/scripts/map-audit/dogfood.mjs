/**
 * Exploratory hunt for remaining concept-map bugs.
 *
 * The user reported the map as "still rather buggy" and asked for a second look,
 * so exercise every surface and report what is actually broken rather than
 * asserting what should work. Each probe records the observed state; anything
 * flagged FAIL is a finding.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5214').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/dogfood';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const findings = [];
const record = (area, name, ok, detail) => {
  findings.push({ area, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ' :: ' + detail : ''}`);
};

async function openMap(page, baseUrl, wait = 3000) {
  await page.goto(`${baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
  await page.locator('.view-mode-control .toggle-opt:last-child').click();
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(wait);
}

// ---------------------------------------------------------------- desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await openMap(page, BASE);

  // 1. Repeated Fit is idempotent.
  const fit1 = await page.evaluate(() => globalThis.__nostosSigma.getCamera().getState());
  await page.locator('.map-controls button', { hasText: 'Fit' }).first().click();
  await page.waitForTimeout(1400);
  const fit2 = await page.evaluate(() => globalThis.__nostosSigma.getCamera().getState());
  record('controls', 'repeated Fit is idempotent',
    Math.abs(fit1.ratio - fit2.ratio) < 1e-6 && Math.abs(fit1.x - fit2.x) < 1e-6,
    `ratio ${fit1.ratio.toFixed(4)} -> ${fit2.ratio.toFixed(4)}`);

  // 2. Zoom in then Fit returns to the same framing.
  await page.locator('.map-controls button[aria-label="Zoom in"]').click();
  await page.waitForTimeout(900);
  const zoomed = await page.evaluate(() => globalThis.__nostosSigma.getCamera().ratio);
  await page.locator('.map-controls button', { hasText: 'Fit' }).first().click();
  await page.waitForTimeout(1400);
  const refit = await page.evaluate(() => globalThis.__nostosSigma.getCamera().ratio);
  record('controls', 'Fit recovers framing after zoom',
    Math.abs(refit - fit1.ratio) < 1e-3,
    `zoomed to ${zoomed.toFixed(3)}, refit ${refit.toFixed(4)} vs original ${fit1.ratio.toFixed(4)}`);

  // 3. Center is disabled with no selection, enabled with one.
  const disabledNoSel = await page.locator('.map-controls button', { hasText: 'Center' }).first().isDisabled();
  record('controls', 'Center disabled without a selection', disabledNoSel === true, `disabled=${disabledNoSel}`);

  // 4. Fullscreen / focus mode.
  await page.locator('.map-controls button', { hasText: 'Focus mode' }).first().click();
  await page.waitForTimeout(1600);
  const fs = await page.evaluate(() => ({
    fullscreen: !!document.fullscreenElement,
    label: [...document.querySelectorAll('.map-controls button')].map((b) => b.textContent.trim()).join('|'),
    searchPresent: !!document.querySelector('.map-search input'),
    canvasH: document.querySelector('.sigma-container')?.clientHeight,
    viewportH: window.innerHeight,
  }));
  record('focus', 'focus mode enters fullscreen', fs.fullscreen === true, JSON.stringify(fs));
  record('focus', 'search appears only in focus mode', fs.searchPresent === true, `present=${fs.searchPresent}`);
  record('focus', 'graph fills the viewport in focus mode',
    (fs.canvasH ?? 0) >= fs.viewportH * 0.9, `canvas ${fs.canvasH}px of ${fs.viewportH}px`);

  // 5. Search in focus mode finds and selects a concept.
  if (fs.searchPresent) {
    await page.locator('.map-search input').fill('virtue');
    await page.waitForTimeout(800);
    const results = await page.locator('.map-search-results button').count();
    record('focus', 'search returns results', results > 0, `${results} result(s)`);
    if (results > 0) {
      await page.locator('.map-search-results button').first().click();
      await page.waitForTimeout(1600);
      const sel = await page.evaluate(() => document.querySelector('.map-selection-bar')?.textContent?.trim() ?? null);
      record('focus', 'choosing a search result selects it', !!sel && /virtue/i.test(sel), `selection='${sel}'`);
    }
  }

  // 6. Escape exits focus mode.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1600);
  const afterEsc = await page.evaluate(() => !!document.fullscreenElement);
  record('focus', 'Escape exits focus mode', afterEsc === false, `fullscreen=${afterEsc}`);

  // 7. Theme switch keeps the graph rendered.
  await page.evaluate(() => localStorage.setItem('nostos.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.sigma-container canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2600);
  const themed = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const edge = []; g.forEachEdge((e, a) => edge.push(a.color));
    return { theme: document.documentElement.getAttribute('data-theme'), order: g.order, sampleEdge: edge[0] };
  });
  record('theme', 'graph renders after theme change',
    themed.order > 0 && /rgba?\(123/.test(String(themed.sampleEdge)),
    JSON.stringify(themed));

  // 8. Rapid node clicks do not throw.
  const before = errors.length;
  const box = await page.locator('.sigma-container').boundingBox();
  const pts = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const out = [];
    g.forEachNode((id, a) => { if (out.length < 6) { const p = sig.graphToViewport({ x: a.x, y: a.y }); out.push(p); } });
    return out;
  });
  for (const p of pts) {
    await page.mouse.click(box.x + p.x, box.y + p.y);
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(900);
  record('robustness', 'rapid node clicks raise no errors', errors.length === before,
    errors.slice(before, before + 3).join(' | ') || 'none');

  // 9. Reset layout restores after many drags.
  const target = await page.evaluate(() => {
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const id = g.nodes()[0];
    const a = g.getNodeAttributes(id);
    const p = sig.graphToViewport({ x: a.x, y: a.y });
    return { id, p, home: { x: a.x, y: a.y } };
  });
  for (let round = 0; round < 3; round++) {
    const sx = box.x + target.p.x + round * 8, sy = box.y + target.p.y + round * 6;
    await page.mouse.move(sx, sy);
    await page.waitForTimeout(180);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(sx + i * 14, sy + i * 9); await page.waitForTimeout(45); }
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  await page.locator('.map-controls button', { hasText: 'Reset layout' }).first().click();
  await page.waitForTimeout(1800);
  const restored = await page.evaluate((id) => {
    const a = globalThis.__nostosGraph.getNodeAttributes(id);
    return { x: +a.x.toFixed(2), y: +a.y.toFixed(2) };
  }, target.id);
  record('controls', 'Reset layout restores after repeated drags',
    Math.hypot(restored.x - target.home.x, restored.y - target.home.y) < 1,
    `home (${target.home.x.toFixed(1)},${target.home.y.toFixed(1)}) -> (${restored.x},${restored.y})`);

  record('robustness', 'no console errors across the whole pass', errors.length === 0,
    errors.slice(0, 3).join(' | ') || 'none');

  await page.screenshot({ path: path.join(OUT, 'desktop-end.png') });
  await ctx.close();
}

// ---------------------------------------------------------------- mobile
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openMap(page, BASE, 2600);

  const m = await page.evaluate(() => {
    const cont = document.querySelector('.sigma-container').getBoundingClientRect();
    const controls = document.querySelector('.map-controls');
    const cr = controls ? controls.getBoundingClientRect() : null;
    const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
    const d = sig.getDimensions();
    const off = [];
    g.forEachNode((id, a) => { const p = sig.graphToViewport({ x: a.x, y: a.y }); if (p.x < 0 || p.x > d.width || p.y < 0 || p.y > d.height) off.push(a.label); });
    return {
      containerOnScreen: cont.top < window.innerHeight && cont.bottom > 0,
      containerVisibleH: Math.round(Math.max(0, Math.min(cont.bottom, window.innerHeight) - Math.max(cont.top, 0))),
      viewportH: window.innerHeight,
      controlsWithinViewport: cr ? (cr.top >= 0 && cr.left >= 0 && cr.right <= window.innerWidth && cr.bottom <= window.innerHeight) : null,
      controlsRect: cr ? { t: Math.round(cr.top), l: Math.round(cr.left), r: Math.round(cr.right), b: Math.round(cr.bottom) } : null,
      touchTargets: [...document.querySelectorAll('.map-controls button')].map((b) => Math.round(b.getBoundingClientRect().height)),
      offscreenNodes: off.length,
      docScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      errorsSoFar: 0,
    };
  });
  record('mobile', 'graph is on screen and fills most of the viewport',
    m.containerOnScreen && m.containerVisibleH >= m.viewportH * 0.5,
    `${m.containerVisibleH}px of ${m.viewportH}px`);
  record('mobile', 'no horizontal overflow', m.docScrollWidth <= m.clientWidth,
    `scrollWidth ${m.docScrollWidth} vs client ${m.clientWidth}`);
  record('mobile', 'all map controls are within the viewport', m.controlsWithinViewport === true,
    JSON.stringify(m.controlsRect));
  record('mobile', 'touch targets are at least 40px tall',
    m.touchTargets.every((h) => h >= 40), `heights ${m.touchTargets.join(',')}`);
  record('mobile', 'no nodes open off screen', m.offscreenNodes === 0, `${m.offscreenNodes} off screen`);
  record('mobile', 'no console errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');

  await page.screenshot({ path: path.join(OUT, 'mobile-end.png') });
  await ctx.close();
}

const failed = findings.filter((f) => !f.ok);
writeFileSync(path.join(OUT, 'dogfood.json'), JSON.stringify({ findings, failedCount: failed.length }, null, 2));
console.log('');
console.log(`SUMMARY: ${findings.length - failed.length}/${findings.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  FAIL [${f.area}] ${f.name} :: ${f.detail}`);
await browser.close();
