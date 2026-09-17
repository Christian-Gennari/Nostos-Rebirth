#!/usr/bin/env node
/**
 * Was the seam only ever a rounding coincidence, or a real defect?
 *
 * The measured seam appears at a card whose layout box has a fractional x. This
 * probe walks the columns of every card in a row and asserts, for each, that the
 * artwork's rightmost painted column abuts the frame's border. It compares the
 * shipped code against the candidate fix, so "reproduces at this width only"
 * cannot be mistaken for "reproduces".
 *
 * Sanity control: the same measurement with the animation forced off — the fix
 * must not change the at-rest rendering at all.
 *
 * Usage: node scripts/map-audit/bloom-seam-sweep.mjs [base]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const BASE = process.argv[2] ?? 'http://localhost:5214';
const OUT = '/tmp/bloom-seam-sweep';
mkdirSync(OUT, { recursive: true });

const FIX = `.cover-image, .list-cover-img {
  width: calc(100% + 2px) !important;
  height: calc(100% + 2px) !important;
  margin: -1px !important;
  max-width: none !important;
  max-height: none !important;
}`;

/** RUNNING animation near the end of the scale-down, where the seam appears. */
const MID = `.bloom-art.is-bloomed {
  animation-duration: 10s !important;
  animation-delay: -4.5s !important;
  animation-play-state: running !important;
}`;
const REST = `.bloom-art.is-bloomed { animation: none !important; opacity: 1 !important; }`;

const VARIANTS = {
  'mid (no fix)': MID,
  'mid + fix': `${MID} ${FIX}`,
  'rest (no fix)': REST,
  'rest + fix': `${REST} ${FIX}`,
};

const VIEWPORTS = [
  [1920, 1080], [1920, 1200], [2560, 1440], [1600, 900], [1536, 864], [1680, 1050],
  [2048, 1152], [2560, 1600], [3840, 2160], [1512, 982], [1728, 1117], [1800, 1000],
  [1440, 900], [1366, 768], [1280, 800], [1280, 1024], [1360, 768], [1152, 864],
];

const browser = await chromium.launch();
const rows = [];

for (const theme of ['dark', 'light']) {
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      localStorage.setItem('nostos.theme', t);
      localStorage.setItem('nostos.library.viewMode', 'grid');
    }, theme);
    await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
    const gridBtn = await page.$('button[aria-label="Grid view"]');
    if (gridBtn) { await gridBtn.click().catch(() => {}); await page.waitForTimeout(400); }
    await page.waitForSelector('.book-grid .book-card .cover-image', { timeout: 25000 });
    await page.waitForTimeout(1000);

    for (const [tag, css] of Object.entries(VARIANTS)) {
      await page.evaluate((c) => {
        let s = document.getElementById('__probe');
        if (!s) { s = document.createElement('style'); s.id = '__probe'; document.head.appendChild(s); }
        s.textContent = c;
      }, css);
      // Restart so the negative-delay animation is genuinely running.
      await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('.book-grid .cover-image')];
        for (const i of imgs) i.classList.remove('is-bloomed');
        void document.body.offsetHeight;
        for (const i of imgs) i.classList.add('is-bloomed');
      });
      await page.waitForTimeout(90);

      const cards = await page.evaluate(() => {
        const grid = document.querySelector('.book-grid');
        const all = [...grid.querySelectorAll('.book-card')];
        const rowTop = all[0].querySelector('.cover-wrapper').getBoundingClientRect().top;
        const inRow = all.filter((c) => Math.abs(c.querySelector('.cover-wrapper').getBoundingClientRect().top - rowTop) < 2);
        return {
          ground: getComputedStyle(inRow[0].querySelector('.cover-wrapper')).backgroundColor,
          filter: getComputedStyle(inRow[2].querySelector('.cover-image')).filter,
          cols: getComputedStyle(grid).gridTemplateColumns,
          row: inRow.map((c, i) => {
            const wr = c.querySelector('.cover-wrapper').getBoundingClientRect();
            return { col: i + 1, left: +wr.left.toFixed(4), right: +wr.right.toFixed(4), top: Math.round(wr.top) };
          }),
        };
      });

      const ground = cards.ground.match(/\d+/g).map(Number);
      const bad = [];
      for (const c of cards.row) {
        const clip = { x: Math.floor(c.right) - 9, y: c.top + 20, width: 13, height: 24 };
        const p = join(OUT, `${theme}-${w}x${h}-${tag.replace(/[^a-z0-9+]/gi, '_')}-c${c.col}.png`);
        await page.screenshot({ path: p, clip });
        const png = PNG.sync.read(readFileSync(p));
        const y = png.height >> 1;
        const px = (i) => { const k = (png.width * y + i) << 2; return [png.data[k], png.data[k + 1], png.data[k + 2]]; };
        const isGround = (v) => Math.abs(v[0] - ground[0]) <= 2 && Math.abs(v[1] - ground[1]) <= 2 && Math.abs(v[2] - ground[2]) <= 2;
        const seam = [];
        for (let i = 0; i < 9; i++) if (isGround(px(i))) seam.push(i);
        if (seam.length) bad.push(`c${c.col}@${seam.join('/')}`);
      }
      rows.push({ theme, vp: `${w}x${h}`, cols: cards.cols, tag, filter: cards.filter, seam: bad.join(',') || 'clean' });
    }
    await ctx.close();
    process.stdout.write(`\r${theme} ${w}x${h}   `);
  }
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 1));
console.log('\n');
const by = {};
for (const r of rows) { by[r.tag] ??= { d: 0, t: 0, ex: [] }; by[r.tag].t++; if (r.seam !== 'clean') { by[r.tag].d++; if (by[r.tag].ex.length < 3) by[r.tag].ex.push(`${r.theme} ${r.vp}: ${r.seam}`); } }
for (const [k, v] of Object.entries(by)) console.log(`${String(v.d).padStart(2)}/${v.t} dirty   ${k.padEnd(16)} ${v.ex.join(' ; ')}`);
await browser.close();
