#!/usr/bin/env node
/**
 * Stress test for the list row's title/status relationship.
 *
 * The real library has no title long enough to hit the ellipsis, so the
 * failure mode cannot occur in current data — which means the live check
 * cannot prove it is handled. This injects progressively longer titles into a
 * real rendered row (and a 390px mobile row) and asserts, for each, that the
 * status pair stays put inside the title column and that the TITLE is the
 * element that yields (ellipsis), not the controls.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4352;
const server = spawn(
  process.execPath,
  ['tools/probe-server.mjs', 'dist/Nostos.Frontend/browser', String(PORT), 'http://127.0.0.1:5099'],
  { stdio: 'ignore' }
);
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();

const TITLES = [
  'Short',
  'A Reasonably Long Book Title That Fills Most Of The Column',
  'An Extremely Long Book Title That Absolutely Cannot Possibly Fit Inside This Column No Matter What We Do About It',
  'X'.repeat(400),
];

async function MEASURE(titles) {
  const row = document.querySelector('.table-row');
  const title = row.querySelector('.list-book-title');
  const status = row.querySelector('.list-row-status');
  const author = row.querySelector('.col.author');
  const cell = row.querySelector('.col.title');
  const out = [];
  for (const value of titles) {
    title.textContent = value;
    void title.offsetWidth;
    const t = title.getBoundingClientRect();
    const s = status.getBoundingClientRect();
    // A column hidden by the mobile breakpoint (display:none) reports a
    // degenerate rect at 0,0 — measuring it would invent an overlap. Treat a
    // hidden column as absent.
    const authorVisible = !!author && author.offsetParent !== null && author.getBoundingClientRect().width > 0;
    const a = authorVisible ? author.getBoundingClientRect() : null;
    const c = cell.getBoundingClientRect();
    const sStyle = getComputedStyle(status);
    out.push({
      len: value.length,
      titleClipped: title.scrollWidth > title.clientWidth + 1,
      titleOverflow: getComputedStyle(title).textOverflow,
      titleRight: Math.round(t.right),
      statusLeft: Math.round(s.left),
      statusRight: Math.round(s.right),
      statusWidth: Math.round(s.width),
      titleStatusOverlap: Math.round(Math.max(0, t.right - s.left)),
      statusAuthorOverlap: a ? Math.round(Math.max(0, s.right - a.left)) : null,
      authorVisible,
      statusInsideCell: s.right <= c.right + 0.5,
      // The cluster must not shrink or move: it is fixed furniture.
      clusterDisplay: sStyle.display,
      statusLeftStable: null,
    });
  }
  return out;
}

async function run(viewportWidth, mobile, label) {
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: mobile ? 844 : 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/library`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() =>
    localStorage.setItem(
      'nostos.library.preferences',
      JSON.stringify({ viewMode: 'list', sort: 'lastread', pageSize: 20, sidebarExpanded: false, groupByWork: true })
    )
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const rows = await page.evaluate(MEASURE, TITLES);
  await context.close();

  // Stability: the cluster's left edge must be identical across all title lengths.
  const lefts = new Set(rows.map((r) => r.statusLeft));
  const report = { label, viewportWidth, rows, clusterLeftStable: lefts.size === 1, clusterLefts: [...lefts] };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

const desktop = await run(1440, false, 'desktop 1440');
const mobile = await run(390, true, 'mobile 390');

const problems = [];
for (const r of [desktop, mobile]) {
  if (!r.clusterLeftStable) problems.push(`${r.label}: status cluster moved with title length`);
  for (const row of r.rows) {
    if (row.titleStatusOverlap > 0) problems.push(`${r.label} len=${row.len}: title overlaps status`);
    if (row.statusAuthorOverlap !== null && row.statusAuthorOverlap > 0)
      problems.push(`${r.label} len=${row.len}: status overlaps author`);
    if (!row.statusInsideCell) problems.push(`${r.label} len=${row.len}: status escaped the title column`);
    if (row.titleOverflow !== 'ellipsis') problems.push(`${r.label} len=${row.len}: title overflow is ${row.titleOverflow}`);
    if (row.len >= 400 && !row.titleClipped) problems.push(`${r.label} len=${row.len}: overlong title was not clipped`);
  }
}

console.log('\n=== VERDICT ===');
console.log(problems.length === 0 ? 'PASS — no collisions at any title length, on desktop or mobile.' : problems.join('\n'));

await browser.close();
server.kill();
