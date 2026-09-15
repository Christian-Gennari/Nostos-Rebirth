/**
 * In landscape, does the Index rail stay visible and squeeze the map?
 *
 * Clicking "Map" adds the `mobile-hidden` class to `.index-col`, but the rules
 * that act on that class may be width-keyed — and an 844x390 phone is wider than
 * the 768px breakpoint. If so the class is applied with no CSS honouring it, the
 * rail keeps ~40% of the screen, and the map is squeezed into what is left.
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5321';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

for (const [name, w, h] of [['landscape-844', 844, 390], ['landscape-932', 932, 430], ['portrait-390', 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/second-brain`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.removeItem('vite-error-overlay'); } catch {} });
  await page.waitForTimeout(2200);
  const toggle = page.locator('.view-mode-control .toggle-opt:last-child');
  if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(2200); }

  const m = await page.evaluate(() => {
    const box = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), display: getComputedStyle(el).display };
    };
    return {
      index: box('.index-col'),
      indexClasses: document.querySelector('.index-col')?.className ?? 'absent',
      content: box('.content-col'),
      stage: box('.sigma-container'),
      vw: window.innerWidth,
    };
  });
  const idx = m.index;
  const pct = idx ? Math.round((idx.w / m.vw) * 100) : 0;
  console.log(`\n=== ${name} (${m.vw}px) ===`);
  console.log(`  index-col : ${idx ? `${idx.w}x${idx.h} display=${idx.display}  classes="${m.indexClasses}"` : 'absent'}`);
  console.log(`  index share of viewport width: ${pct}%`);
  console.log(`  stage     : ${m.stage ? `${m.stage.w}x${m.stage.h}` : 'absent'}`);
  await ctx.close();
}
await browser.close();
