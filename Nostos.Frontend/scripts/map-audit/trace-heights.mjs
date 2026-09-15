/**
 * Walk the ancestor chain of the map stage and print each element's resolved
 * height, display and flex properties. When a flex chain collapses to 0, the
 * break is always at whichever ancestor fails to resolve a height — guessing
 * which one wastes rounds, so read it.
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5321').replace(/\/+$/, '');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const drop = () => document.querySelectorAll('vite-error-overlay').forEach((n) => n.remove());
  const start = () => { drop(); if (document.documentElement) new MutationObserver(drop).observe(document.documentElement, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
});
await page.goto(`${BASE}/second-brain`, { waitUntil: 'domcontentloaded' });
await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
await page.locator('.view-mode-control .toggle-opt').last().click();
await page.waitForTimeout(3000);

const chain = await page.evaluate(() => {
  const start = document.querySelector('.sigma-container');
  const rows = [];
  let el = start;
  while (el && el !== document.documentElement.parentElement) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    rows.push({
      tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      h: Math.round(r.height),
      cssH: cs.height,
      minH: cs.minHeight,
      display: cs.display,
      flex: cs.flex,
      flexDir: cs.flexDirection,
      overflowY: cs.overflowY,
      position: cs.position,
    });
    el = el.parentElement;
  }
  return rows;
});

console.log('chain from .sigma-container upward:');
for (const [i, r] of chain.entries()) {
  console.log(`  ${String(i).padStart(2)} ${r.tag.slice(0, 44).padEnd(46)} h=${String(r.h).padStart(4)}  css-h=${r.cssH.padEnd(10)} min-h=${r.minH.padEnd(8)} disp=${r.display.padEnd(10)} flex=${r.flex.padEnd(14)} dir=${r.flexDir.padEnd(8)} ovf=${r.overflowY}`);
}

console.log('\nsiblings of .map-wrapper inside .content-col:');
const sib = await page.evaluate(() => {
  const col = document.querySelector('.content-col');
  if (!col) return 'no .content-col';
  return [...col.children].map((c) => {
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    return { tag: c.tagName.toLowerCase() + '.' + (typeof c.className === 'string' ? c.className.trim().split(/\s+/)[0] : ''), h: Math.round(r.height), disp: cs.display, flex: cs.flex };
  });
});
console.log(JSON.stringify(sib, null, 2));

await browser.close();
