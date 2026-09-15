/**
 * Which element owns the blank band above the dock in the reading view?
 *
 * Walks the reading view's ancestor chain from the innermost content card up to
 * the shell, printing each element's box, padding, background and flex so it is
 * clear whether the gap is the shell's over-reserve or the column's own padding,
 * and which element's background the user sees in the gap.
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5321';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${base}/second-brain`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('.index-item').first().click();
await page.waitForTimeout(2200);

const r = await page.evaluate(() => {
  const out = [];
  const dock = document.querySelector('app-app-dock');
  const dockTop = dock ? Math.round(dock.getBoundingClientRect().top) : null;

  // Start from the element nearest the dock inside the content column.
  let el = document.querySelector('.content-col');
  const chain = [];
  while (el && el !== document.documentElement) {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''),
      top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
      padB: cs.paddingBottom, bg: cs.backgroundColor, display: cs.display, flex: cs.flexGrow,
    });
    el = el.parentElement;
  }

  // The visible children of the reading column, to find the white card.
  const kids = [...document.querySelectorAll('.content-col *')]
    .map((n) => {
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (b.height < 40) return null;
      const bg = cs.backgroundColor;
      const whiteish = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      if (!whiteish) return null;
      return {
        tag: n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ').slice(0, 2).join('.') : ''),
        top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), bg,
        gapToDock: dockTop !== null ? dockTop - Math.round(b.bottom) : null,
      };
    })
    .filter(Boolean);

  return { dockTop, chain, coloredChildren: kids.slice(-6) };
});

console.log('dock top:', r.dockTop);
console.log('\nchain from .content-col upward:');
for (const c of r.chain) {
  console.log(`  ${c.tag.padEnd(44)} h=${String(c.h).padEnd(5)} bottom=${String(c.bottom).padEnd(5)} padB=${c.padB.padEnd(8)} grow=${c.flex} bg=${c.bg}`);
}
console.log('\nbackground-ed descendants of the reading column (nearest the dock last):');
for (const k of r.coloredChildren) {
  console.log(`  ${k.tag.padEnd(44)} h=${String(k.h).padEnd(5)} bottom=${String(k.bottom).padEnd(5)} gapToDock=${String(k.gapToDock).padEnd(5)} bg=${k.bg}`);
}
await browser.close();
