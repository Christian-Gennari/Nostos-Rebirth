
import { chromium } from '@playwright/test';

const URL = 'http://127.0.0.1:8085/index.html';
const OUT = '/home/dev/coding/projects/nostos-rebirth-webpage/.qa';

const VIEWS = [
  { name: 'landing-1440', width: 1440, height: 1000 },
  { name: 'landing-390', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
for (const v of VIEWS) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(t => {
      localStorage.setItem('nostos_theme', t);
    }, theme);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${v.name}-${theme}.png`, fullPage: true });
    if (errors.length) console.log(`${v.name} ${theme}: ${errors.join(' | ')}`);
    else console.log(`${v.name} ${theme}: no console errors`);
    await ctx.close();
  }
}
await browser.close();
