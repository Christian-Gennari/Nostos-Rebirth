/**
 * Drag-physics probe: what actually happens when a node is dragged?
 *
 * Measures the three claims that separate Obsidian-style physics from a static
 * snapshot layout:
 *   1. do neighbours MOVE while the pointer drags (live relaxation)?
 *   2. does the dragged node stay pinned exactly under the pointer?
 *   3. after release, does the graph continue to settle (inertia) and then STOP
 *      (no permanent idle churn)?
 *
 * Usage: node scripts/map-audit/drag-physics.mjs <url> <outDir> <label>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5331').replace(/\/+$/, '');
const OUT = process.argv[3] ?? '.map-audit-out/drag';
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
await page.waitForTimeout(3000);

const out = { label: LABEL, baseUrl: BASE };

// Pick the highest-degree node that is comfortably inside the stage.
//
// `graphToViewport` returns coordinates relative to the SIGMA CONTAINER, not the
// page, so the container's page offset must be added before any `page.mouse`
// call. Without it the pointer lands somewhere else entirely and the drag
// measures as a no-op that looks like a product bug.
const target = await page.evaluate(() => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  const d = sig.getDimensions();
  const rect = document.querySelector('.sigma-container').getBoundingClientRect();
  let best = null;
  g.forEachNode((id, a) => {
    const p = sig.graphToViewport({ x: a.x, y: a.y });
    const margin = Math.min(p.x, d.width - p.x, p.y, d.height - p.y);
    const deg = g.degree ? g.degree(id) : 0;
    if (margin < 120) return;
    if (!best || deg > best.deg) {
      best = { id, deg, margin: +margin.toFixed(0), pageX: +(rect.left + p.x).toFixed(1), pageY: +(rect.top + p.y).toFixed(1) };
    }
  });
  return best;
});
out.target = target;

const snapshot = () => page.evaluate((id) => {
  const sig = globalThis.__nostosSigma, g = globalThis.__nostosGraph;
  const out = {};
  g.forEachNode((n, a) => {
    const p = sig.graphToViewport({ x: a.x, y: a.y });
    out[n] = { x: +p.x.toFixed(2), y: +p.y.toFixed(2) };
  });
  return out;
}, target.id);

const before = await snapshot();

// ── Drag: press on the node, move in 20 steps, sampling mid-drag ──
await page.mouse.move(target.pageX, target.pageY);
await page.mouse.down();
let firstNeighbourMove = null;
let prev = before;
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(target.pageX + i * 8, target.pageY + i * 3);
  await page.waitForTimeout(24);
  const now = await snapshot();
  let moved = 0; let furthest = 0;
  for (const k of Object.keys(now)) {
    if (k === target.id) continue;
    const d = Math.hypot(now[k].x - before[k].x, now[k].y - before[k].y);
    if (d > 1) moved += 1;
    if (d > furthest) furthest = d;
  }
  if (i === 1) firstNeighbourMove = { afterSteps: 1, moved, furthest: +furthest.toFixed(1) };
  if (i === 20) {
    out.duringDrag = { afterSteps: 20, moved, furthest: +furthest.toFixed(1) };
    // how far did the dragged node itself travel vs the pointer?
    out.pinned = {
      pointerTravel: +(Math.hypot(160, 60)).toFixed(1),
      nodeTravel: +Math.hypot(now[target.id].x - before[target.id].x, now[target.id].y - before[target.id].y).toFixed(1),
    };
  }
  prev = now;
}
out.firstStepNeighbourMove = firstNeighbourMove;

const duringDrag = prev;
await page.mouse.up();

// ── After release: does it keep settling, then stop? ──
const settleSamples = [];
let last = duringDrag;
for (const wait of [150, 150, 300, 500, 1000]) {
  await page.waitForTimeout(wait);
  const now = await snapshot();
  let moved = 0; let furthest = 0;
  for (const k of Object.keys(now)) {
    const d = Math.hypot(now[k].x - last[k].x, now[k].y - last[k].y);
    if (d > 1) moved += 1;
    if (d > furthest) furthest = d;
  }
  settleSamples.push({ afterMs: wait, moved, furthest: +furthest.toFixed(1) });
  last = now;
}
out.afterRelease = settleSamples;

// ── Idle: nothing should move at all once settled ──
await page.waitForTimeout(1500);
const idleA = await snapshot();
await page.waitForTimeout(2000);
const idleB = await snapshot();
let idleMoved = 0; let idleFurthest = 0;
for (const k of Object.keys(idleA)) {
  const d = Math.hypot(idleB[k].x - idleA[k].x, idleB[k].y - idleA[k].y);
  if (d > 0.5) idleMoved += 1;
  if (d > idleFurthest) idleFurthest = d;
}
out.idle = { moved: idleMoved, furthest: +idleFurthest.toFixed(2) };

writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
