#!/usr/bin/env node
/**
 * Mobile list-view verification (asserting, not just reporting).
 *
 * The list collapses to two columns below 768px: title (+ format badge). This
 * fails loudly if any of the mobile contracts break:
 *
 *   1. the row's status cluster never collides with the format badge, the row
 *      box, or the title;
 *   2. a row carrying an active status RENDERS that toggle on touch (a phone has
 *      no hover, so hiding the active state would make it unreachable);
 *   3. an inactive toggle is hidden on touch, matching the grid's cards;
 *   4. rows keep a uniform height and the page never scrolls sideways;
 *   5. list rows do NOT get `content-visibility: auto` — a row's height is not
 *      constant on mobile, and the placeholder mismatch displaced the scroll
 *      position by up to 4421px (see the note in library.component.css).
 *
 * Usage: node tools/check-mobile-list.mjs <out-dir>
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = 4361;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(process.argv[2] ?? 'tools/probe-out/mobile');
mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.execPath,
  [path.join(import.meta.dirname, 'probe-server.mjs'), 'dist/Nostos.Frontend/browser', String(PORT), 'http://127.0.0.1:5099'],
  { stdio: 'ignore' }
);
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() =>
  localStorage.setItem(
    'nostos.library.preferences',
    JSON.stringify({ viewMode: 'list', sort: 'lastread', pageSize: 30, sidebarExpanded: false, groupByWork: true })
  )
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

/**
 * Prerequisite setup: this check asserts that a row with an ACTIVE status still
 * renders that toggle on touch, so it needs at least one active row. The real
 * library may have none, and a data-dependent hard failure is a flaky check, so
 * seed one through the app's own API when needed.
 *
 * This writes to the probe backend's database — which is a throwaway COPY
 * snapshotted out of the production checkout by tools/probe-backend.sh, never
 * the production file (see that script). Point PROBE_API elsewhere and this
 * would write there instead, so keep it on the probe origin.
 */
const PROBE_API = process.env.PROBE_API ?? 'http://127.0.0.1:5099';

async function hasActiveRow() {
  return page.evaluate(() => !!document.querySelector('.fav-btn-list.active, .finished-btn-list.active'));
}

let seeded = null;
if (!(await hasActiveRow())) {
  const first = await page.evaluate(() => {
    const link = document.querySelector('.table-row a[href], .table-row');
    return link ? link.getAttribute('href') : null;
  });
  const list = await (await fetch(`${PROBE_API}/api/books?pageSize=1&sort=lastread`)).json();
  const target = list.items?.[0];
  if (!target) throw new Error('probe library is empty: nothing to seed');
  const res = await fetch(`${PROBE_API}/api/books/${target.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isFavorite: true }),
  });
  if (!res.ok) throw new Error(`seeding favourite failed: ${res.status} ${await res.text()}`);
  seeded = { id: target.id, title: target.title, href: first };
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  if (!(await hasActiveRow())) throw new Error('seeded a favourite but no active row rendered');
}

const report = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.table-row')];
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const cv = [...new Set(rows.map((r) => getComputedStyle(r).contentVisibility))];
  const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;

  const perRow = rows.map((row, i) => {
    const rowBox = rect(row);
    const status = rect(row.querySelector('.list-row-status'));
    const format = rect(row.querySelector('.col.format'));
    const title = rect(row.querySelector('.list-book-title'));
    const toggles = [...row.querySelectorAll('.finished-btn-list, .fav-btn-list')];
    const active = toggles.filter((t) => t.classList.contains('active'));
    const inactive = toggles.filter((t) => !t.classList.contains('active'));

    // Interpenetration of two boxes, in px.
    const overlap = (a, b) =>
      a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
               Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;

    return {
      i,
      rowHeight: Math.round(rowBox.height),
      activeIsRendered: active.map((t) => ({
        cls: t.className.split(' ')[0],
        w: Math.round(t.getBoundingClientRect().width),
        h: Math.round(t.getBoundingClientRect().height),
        insideRow:
          t.getBoundingClientRect().left >= rowBox.left - 0.5 &&
          t.getBoundingClientRect().right <= rowBox.right + 0.5,
      })),
      inactiveHidden: inactive.map((t) => getComputedStyle(t).display === 'none'),
      statusFormatOverlapPx2: status && format ? overlap(status, format) : 0,
      titleStatusOverlapPx2: title && status ? overlap(title, status) : 0,
      statusInsideRow: status ? status.right <= rowBox.right + 0.5 : true,
    };
  });

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    rowCount: rows.length,
    rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
    contentVisibility: cv,
    overflowX,
    activeRows: perRow.filter((r) => r.activeIsRendered.length > 0),
    anyTitleStatusOverlap: perRow.filter((r) => r.titleStatusOverlapPx2 > 0).length,
    anyStatusFormatOverlap: perRow.filter((r) => r.statusFormatOverlapPx2 > 0).length,
    anyStatusOutsideRow: perRow.filter((r) => !r.statusInsideRow).length,
    anyInactiveVisible: perRow.filter((r) => r.inactiveHidden.some((hidden) => !hidden)).length,
    anyActiveNotRendered: perRow.filter((r) => r.activeIsRendered.some((a) => a.w === 0 || !a.insideRow)).length,
  };
});

await page.screenshot({ path: path.join(OUT, 'mobile-list-full.png') });
await page.locator('.results-stage').screenshot({ path: path.join(OUT, 'mobile-list.png') });

writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, seeded }, null, 2));
console.log(JSON.stringify(report, null, 2));

const failures = [];
if (report.contentVisibility.includes('auto'))
  failures.push(`list rows must not use content-visibility:auto on mobile (got ${report.contentVisibility})`);
if (report.rowHeights.length !== 1)
  failures.push(`row heights must be uniform, got ${report.rowHeights.join(', ')}`);
if (report.overflowX !== 0) failures.push(`page scrolls sideways by ${report.overflowX}px`);
if (report.anyTitleStatusOverlap > 0) failures.push(`${report.anyTitleStatusOverlap} row(s): title overlaps status`);
if (report.anyStatusFormatOverlap > 0) failures.push(`${report.anyStatusFormatOverlap} row(s): status overlaps the format badge`);
if (report.anyStatusOutsideRow > 0) failures.push(`${report.anyStatusOutsideRow} row(s): status escapes the row box`);
if (report.anyInactiveVisible > 0)
  failures.push(`${report.anyInactiveVisible} row(s): an inactive toggle is visible on touch`);
if (report.anyActiveNotRendered > 0)
  failures.push(`${report.anyActiveNotRendered} row(s): an active toggle is not rendered on touch`);
if (report.activeRows.length === 0)
  failures.push('no row carried an active status, so the active-on-mobile path was NOT exercised');

console.log('\n=== MOBILE VERDICT ===');
if (failures.length) {
  console.log('FAIL');
  for (const f of failures) console.log(' - ' + f);
} else {
  console.log(
    `PASS — ${report.rowCount} rows, uniform ${report.rowHeights[0]}px, no overflow, ` +
      `no collisions, inactive hidden and active rendered on ${report.activeRows.length} row(s).`
  );
}

await browser.close();
server.kill();
process.exit(failures.length ? 1 : 0);
