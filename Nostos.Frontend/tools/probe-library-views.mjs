#!/usr/bin/env node
/**
 * Library view probe (development tooling, not part of the app build).
 *
 * Boots a freshly built bundle on a static server and drives it with Playwright
 * to report, for BOTH view modes on the SAME filter and row set:
 *
 *   - a 1:1 screenshot of the results region (before/after evidence),
 *   - a geometry report of one row/card (column boxes, button boxes, computed
 *     styles), and
 *   - a list-vs-grid cost comparison: per-view live `backdrop-filter` layers
 *     (a hardware-independent proxy for GPU surfaces) plus the format badge's
 *     resolved filter.
 *
 * Reading the numbers honestly: the rAF frame-interval figures this emits are
 * NOT a measure of real scrolling. A headless renderer drives the loop itself,
 * so the interval is capped by the harness's own frame budget and looks the
 * same for both views. Compare the layer counts and the geometry, and treat the
 * frame numbers as a sanity bound only.
 *
 * Usage:
 *   node tools/probe-library-views.mjs <dist-browser-dir> <out-dir> [api-origin]
 *
 * The API origin is optional. Point it at tools/probe-backend.sh to render the
 * real library; without it the shell still boots with an empty library, which
 * is enough for chrome/geometry work but not for judging the list.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.argv[2] ?? 'dist/Nostos.Frontend/browser');
const outDir = path.resolve(process.argv[3] ?? 'tools/probe-out');
const apiOrigin = process.argv[4] ?? '';
const PORT = 4317;
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(outDir, { recursive: true });

const server = spawn(
  process.execPath,
  [path.join(import.meta.dirname, 'probe-server.mjs'), distDir, String(PORT), apiOrigin],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('probe server never came up');
}

/**
 * Scrolls a fixed distance in even steps and records every frame interval, so
 * the two view modes are compared over an identical workload. The scroll
 * container is resolved from the results block upward (desktop scrolls the
 * document; mobile scrolls its own root).
 */
async function jankProbe({ selector, steps, deltaY }) {
  const target = document.querySelector(selector);
  const root = (() => {
    let node = target?.parentElement ?? null;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  })();

  root.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const frames = [];
  let last = performance.now();
  for (let i = 0; i < steps; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frames.push(now - last);
    last = now;
    root.scrollTop += deltaY;
  }

  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    container: root === document.scrollingElement ? 'document' : String(root.className),
    frames: frames.length,
    meanMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
    medianMs: +pct(0.5).toFixed(2),
    p95Ms: +pct(0.95).toFixed(2),
    maxMs: +Math.max(...frames).toFixed(2),
    over33ms: frames.filter((f) => f > 33.4).length,
    over60ms: frames.filter((f) => f > 60).length,
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
  };
}

/** Box + computed-style dump for the row and each column, for parity work. */
function geometryProbe({ rowSel }) {
  const row = document.querySelector(rowSel);
  if (!row) return null;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const cs = (el) => {
    const s = getComputedStyle(el);
    return {
      display: s.display,
      position: s.position,
      opacity: s.opacity,
      color: s.color,
      background: s.backgroundColor,
      transition: s.transitionProperty,
    };
  };
  const out = { row: box(row), rowComputed: cs(row), cells: {}, buttons: [] };
  for (const [name, sel] of [
    ['title', '.col.title'],
    ['author', '.col.author'],
    ['rating', '.col.rating'],
    ['format', '.col.format'],
    ['date', '.col.date'],
    ['actions', '.actions-cell'],
  ]) {
    const el = row.querySelector(sel);
    out.cells[name] = el ? { ...box(el), computed: cs(el) } : null;
  }
  for (const b of row.querySelectorAll('button')) {
    const svg = b.querySelector('svg');
    out.buttons.push({
      cls: String(b.className),
      ...box(b),
      title: b.getAttribute('title'),
      svgStroke: svg ? getComputedStyle(svg).stroke : null,
    });
  }
  const cover = row.querySelector('.list-cover-frame');
  out.cover = cover ? box(cover) : null;
  return out;
}

async function main() {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const report = { apiOrigin: apiOrigin || null, views: {} };

  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  for (const mode of ['list', 'grid']) {
    await page.evaluate(
      (m) =>
        localStorage.setItem(
          'nostos.library.preferences',
          JSON.stringify({
            viewMode: m,
            sort: 'lastread',
            pageSize: 60,
            sidebarExpanded: false,
            groupByWork: true,
          })
        ),
      mode
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const rootSel = mode === 'list' ? '.table-view' : '.book-grid';
    const rowSel = mode === 'list' ? '.table-row' : '.book-card';
    const entry = {
      present: await page.locator(rootSel).count(),
      rowCount: await page.locator(rowSel).count(),
    };
    if (entry.present > 0) {
      entry.cost = await page.evaluate((sel) => {
        const all = [...document.querySelectorAll('*')];
        const blurred = all.filter((el) => {
          const s = getComputedStyle(el);
          return s.backdropFilter && s.backdropFilter !== 'none' && s.display !== 'none' && s.opacity !== '0';
        });
        const badge = document.querySelector('.format-badge');
        return {
          liveBlurLayers: blurred.length,
          blurSamples: blurred.slice(0, 5).map((el) => `${el.tagName}.${String(el.className).split(' ')[0]}`),
          formatBadgeFilter: badge ? getComputedStyle(badge).backdropFilter : null,
          domNodes: all.length,
        };
      }, rootSel);
      entry.rowsWithoutLiveBlur = await page.evaluate((sel) => {
        const containers = [...document.querySelectorAll(sel)];
        return containers.filter((el) =>
          [...el.querySelectorAll('*')].every((child) => {
            const f = getComputedStyle(child).backdropFilter;
            return !f || f === 'none';
          })
        ).length;
      }, rowSel);
      entry.frameBudget = await page.evaluate(jankProbe, { selector: rootSel, steps: 150, deltaY: 80 });
      entry.geometry = await page.evaluate(geometryProbe, { rowSel });
    }
    await page.locator('.results-stage').screenshot({ path: path.join(outDir, `library-${mode}-desktop.png`) });
    report.views[mode] = entry;
    console.log(`--- ${mode} ---`);
    console.log(JSON.stringify(entry, null, 1));
  }

  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`report -> ${path.join(outDir, 'report.json')}`);
  await browser.close();
  server.kill();
}

main().catch(async (error) => {
  console.error(error);
  server.kill();
  process.exit(1);
});
