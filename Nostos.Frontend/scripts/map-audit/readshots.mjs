/**
 * Capture the reading view at phone size, top and scrolled-to-bottom.
 *
 * The user reported dead space between the reading content and the dock, so this
 * is the surface to check: it prints the dock's top edge, the lowest line of text,
 * and the column's bottom, then writes two screenshots for visual review.
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5321';
const out = process.argv[3] ?? '/tmp/mob/readshots';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(`${base}/second-brain`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('.index-item').first().click();
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/read-top.png` });

await page.evaluate(() => {
  for (const el of document.querySelectorAll('.workspace-content, .content-col, .workspace-content *')) {
    try {
      if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
    } catch { /* not scrollable */ }
  }
});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/read-bottom.png` });

const r = await page.evaluate(() => {
  const dock = document.querySelector('app-app-dock');
  const col = document.querySelector('.content-col');
  const dockTop = Math.round(dock.getBoundingClientRect().top);

  // Lowest line of actual reading text.
  const leaves = [...document.querySelectorAll('.content-col *')].filter((n) => {
    if (n.children.length) return false;
    return (n.textContent ?? '').trim().length > 0;
  });
  const lowestText = leaves.length
    ? Math.max(...leaves.map((n) => n.getBoundingClientRect().bottom))
    : 0;

  // The last card is the visually meaningful edge of the content.
  const cards = document.querySelectorAll('.cards-grid > *');
  const lastCard = cards.length ? cards[cards.length - 1] : null;
  const lastCardBottom = lastCard ? Math.round(lastCard.getBoundingClientRect().bottom) : null;

  return {
    dockTop,
    lowestText: Math.round(lowestText),
    textToDock: Math.round(dockTop - lowestText),
    lastCardBottom,
    cardToDock: lastCardBottom === null ? null : dockTop - lastCardBottom,
    colPadBottom: getComputedStyle(col).paddingBottom,
    colBottom: Math.round(col.getBoundingClientRect().bottom),
    colAtScrollEnd: Math.abs(col.scrollHeight - col.clientHeight - col.scrollTop) < 2,
    colScroll: `${col.scrollHeight}/${col.clientHeight}+${Math.round(col.scrollTop)}`,
    shellPadBottom: getComputedStyle(document.querySelector('.workspace-content')).paddingBottom,
    vh: window.innerHeight,
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
