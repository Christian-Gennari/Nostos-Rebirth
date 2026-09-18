
import { chromium } from '@playwright/test';

const URL = 'http://127.0.0.1:8085/index.html';
const OUT = '/home/dev/coding/projects/nostos-rebirth-webpage/.qa/sections';

const SECTIONS = [
  ['header', 'header.site-header'],
  ['hero', 'section.hero'],
  ['problem', '#problem'],
  ['house', 'section.rooms:not(.formats)'],
  ['formats', 'section.rooms.formats'],
  ['loop', '#workflow'],
  ['ownership', '#ownership'],
  ['philosophy', '#philosophy'],
  ['principles', '#principles'],
  ['faq', '#faq'],
  ['cta', '#get-nostos'],
  ['footer', 'footer.site-footer'],
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('nostos_theme', 'light'));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

for (const [name, sel] of SECTIONS) {
  const el = page.locator(sel).first();
  const n = await el.count();
  if (!n) { console.log(`${name}: MISSING (${sel})`); continue; }
  await el.screenshot({ path: `${OUT}/${name}.png` });
  const box = await el.boundingBox();
  console.log(`${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
}
await browser.close();
