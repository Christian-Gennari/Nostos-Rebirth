
import { chromium } from '@playwright/test';
const W = Number(process.argv[2] || 390);
const OUT = '/home/dev/coding/projects/nostos-rebirth-webpage/.qa/sections';
const SECTIONS = [
  ['m-problem', '#problem'],
  ['m-loop', '#workflow'],
  ['m-ownership', '#ownership'],
  ['m-principles', '#principles'],
  ['m-faq', '#faq'],
  ['m-cta', '#get-nostos'],
];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('nostos_theme', 'light'));
await page.goto('http://127.0.0.1:8085/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
for (const [name, sel] of SECTIONS) {
  const el = page.locator(sel).first();
  if (!(await el.count())) { console.log(name + ': MISSING'); continue; }
  await el.screenshot({ path: `${OUT}/${name}.png` });
  const b = await el.boundingBox();
  console.log(`${name}: ${Math.round(b.width)}x${Math.round(b.height)}`);
}
await browser.close();
