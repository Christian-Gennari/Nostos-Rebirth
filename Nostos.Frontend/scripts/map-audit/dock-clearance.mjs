/**
 * A/B: does shrinking the dock reserve from 96px to the dock's real height hide
 * content behind the dock on any page?
 *
 * Robustness matters more than cleverness here. Earlier attempts picked the wrong
 * scroll container and reported content "hidden" that was simply below the fold.
 * This version:
 *   1. scrolls EVERY scrollable element, its ancestors, and the document to max,
 *   2. waits for layout to settle,
 *   3. takes the bottom-most leaf element that carries text and is not fixed/hidden.
 * Run it on the old value and the new one and compare: the clearance should stay
 * non-negative (or keep whatever slack it had) if nothing was lost.
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5321';
const label = process.argv[3] ?? 'run';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const PAGES = ['/library', '/studio', '/settings', '/second-brain'];

const scrollAllToEnd = () => {
  const all = [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll('*')];
  for (const el of all) {
    if (!el) continue;
    try {
      if (el.scrollHeight > el.clientHeight + 2) el.scrollTop = el.scrollHeight;
      if (el.scrollWidth > el.clientWidth + 2) el.scrollLeft = el.scrollWidth;
    } catch { /* not scrollable */ }
  }
};

const measure = () => {
  const dock = document.querySelector('app-app-dock');
  const dockRect = dock ? dock.getBoundingClientRect() : null;
  let lowest = 0;
  let offender = null;
  let offendersBelowDock = 0;

  for (const el of document.querySelectorAll('.workspace-content *')) {
    if (el.closest('app-app-dock')) continue;
    if (el.children.length > 1) continue;              // leaf-ish only
    const text = (el.textContent ?? '').trim();
    if (!text) continue;                                // must carry content
    const b = el.getBoundingClientRect();
    if (b.height < 6 || b.width < 6) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (dockRect && b.bottom > dockRect.top) offendersBelowDock++;
    if (b.bottom > lowest) {
      lowest = b.bottom;
      offender = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || ''} "${text.slice(0, 18)}"`;
    }
  }

  return {
    dockTop: dockRect ? Math.round(dockRect.top) : null,
    reserve: getComputedStyle(document.querySelector('.workspace-content')).paddingBottom,
    lowestContent: Math.round(lowest),
    clearance: dockRect ? Math.round(dockRect.top - lowest) : null,
    offendersBelowDock,
    offender,
  };
};

console.log(`\n########## ${label} ##########`);
for (const [dn, w, h] of [['iphone-14', 390, 844], ['iphone-se', 375, 667], ['pixel-7', 412, 915]]) {
  console.log(`\n=== ${dn} ${w}x${h} ===`);
  for (const path of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.evaluate(scrollAllToEnd);
    await page.waitForTimeout(500);
    await page.evaluate(scrollAllToEnd);
    await page.waitForTimeout(500);
    const r = await page.evaluate(measure);
    console.log(
      `  ${path.padEnd(13)} reserve=${String(r.reserve).padEnd(7)} dockTop=${String(r.dockTop).padEnd(4)} ` +
      `lowestContent=${String(r.lowestContent).padEnd(5)} clearance=${String(r.clearance).padEnd(6)} ` +
      `belowDock=${r.offendersBelowDock}  ${r.offender ?? ''}`
    );
    await ctx.close();
  }
}
await browser.close();
