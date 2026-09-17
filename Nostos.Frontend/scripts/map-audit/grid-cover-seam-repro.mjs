#!/usr/bin/env node
/**
 * Grid cover seam — reproduction and fix verification.
 *
 * The defect: on grids whose column width lands on a specific fraction (a
 * 1920x1080 desktop gets 195.2px columns from `minmax(180px, 1fr)`, a
 * 1280x800 one gets exactly 197px), the artwork's right edge falls one device
 * pixel short of the frame's inner edge, and that pixel shows the frame's own
 * `--surface-image-ground` — a bright 1px seam between the artwork and the
 * hairline border, down the whole right edge and around the dimmed corners.
 *
 * Cause: `.bloom-art.is-bloomed` used `animation-fill-mode: both`, so the
 * `bloom-in` keyframes stayed applied for the element's whole life. A finished
 * animation with an active `filter` keeps the image on its own composited layer,
 * whose edge snaps to a device pixel rather than covering the fractional layout
 * box. `styles.css` now fills `backwards` and declares the resting values on the
 * class instead.
 *
 * Two parts, because they answer different questions:
 *
 *   seam   measures the defect directly — the frame's ground is repainted
 *          magenta and any magenta column inside the card is counted. Exact, no
 *          colour-similarity guessing.
 *   sweep  runs `seam` across viewport widths x themes and prints a pass/fail
 *          line, so "fixed at 1920x1080" cannot be mistaken for "fixed".
 *
 * Usage:
 *   node scripts/map-audit/grid-cover-seam-repro.mjs [--base http://localhost:5214]
 *   node scripts/map-audit/grid-cover-seam-repro.mjs --quick      # 1920x1080 only
 *
 * `--base` must serve the build under test. The shipped CSS (before the fix)
 * reports 26 of 36 viewport-theme combinations dirty; the fixed CSS reports 0.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'Nostos.Frontend/.map-audit-out/grid-cover-seam';
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5214');
const QUICK = argv.includes('--quick');

const VIEWPORTS = QUICK
  ? [[1920, 1080]]
  : [
      [1920, 1080], [1920, 1200], [2560, 1440], [3840, 2160], [1600, 900], [1536, 864],
      [1440, 900], [1366, 768], [1280, 800], [1680, 1050], [1280, 1024], [1360, 768],
      [1512, 982], [1728, 1117], [1800, 1000], [2048, 1152], [2560, 1600], [1152, 864],
    ];
const THEMES = ['dark', 'light'];

const SENTINEL = `.cover-wrapper { background-color: rgb(255, 0, 255) !important; }`;
let dirty = 0;
let total = 0;

const browser = await chromium.launch();

for (const theme of THEMES) {
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((t) => localStorage.setItem('nostos.theme', t), theme);
    await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
    const gridBtn = await page.$('button[aria-label="Grid view"]');
    if (gridBtn) { await gridBtn.click().catch(() => {}); await page.waitForTimeout(400); }
    await page.waitForSelector('.book-grid .book-card .cover-image', { timeout: 20000 });
    await page.waitForTimeout(1500);

    const geom = await page.evaluate((s) => {
      let st = document.getElementById('__sentinel');
      if (!st) { st = document.createElement('style'); st.id = '__sentinel'; document.head.appendChild(st); }
      st.textContent = s;
      const grid = document.querySelector('.book-grid');
      const cards = [...grid.querySelectorAll('.book-card')];
      const rowTop = cards[0].querySelector('.cover-wrapper').getBoundingClientRect().top;
      return {
        cols: getComputedStyle(grid).gridTemplateColumns,
        cards: cards
          .filter((c) => Math.abs(c.querySelector('.cover-wrapper').getBoundingClientRect().top - rowTop) < 2)
          .map((c, i) => {
            const wr = c.querySelector('.cover-wrapper').getBoundingClientRect();
            return { col: i + 1, top: Math.round(wr.top), x: Math.floor(wr.left) - 3, w: Math.ceil(wr.right) - Math.floor(wr.left) + 3 };
          }),
      };
    }, SENTINEL);
    await page.waitForTimeout(600);

    const seams = [];
    for (const g of geom.cards) {
      const png = await page.screenshot({ clip: { x: g.x, y: g.top + 8, width: g.w, height: 40 } });
      // Decode here so the probe needs no PNG dependency: count pixels that are
      // distinctly magenta (the frame ground), which nothing else in the card is.
      const counted = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g2 = c.getContext('2d');
        g2.drawImage(img, 0, 0);
        const d = g2.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200) n++;
        return n;
      }, png.toString('base64'));
      if (counted > 0) seams.push(`c${g.col}(${counted}px)`);
    }

    total++;
    const clean = seams.length === 0;
    if (!clean) dirty++;
    console.log(`${clean ? '  ok  ' : ' FAIL '} ${theme.padEnd(5)} ${`${w}x${h}`.padEnd(10)} cols ${geom.cols}${clean ? '' : ` -> ${seams.join(', ')}`}`);
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${total - dirty}/${total} viewport-theme combinations clean.` +
  (dirty ? ` ${dirty} show the 1px cover seam.` : ' No seam anywhere.'));
process.exit(dirty ? 1 : 0);
