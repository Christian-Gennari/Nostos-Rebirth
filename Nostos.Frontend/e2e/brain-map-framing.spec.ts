/**
 * Decisive framing check: measure the margins on all four sides, separately for
 * the node circles and for the labels, so "centred or not" is settled by
 * measurement rather than by eye (vision reads of spatial balance are unreliable
 * and have already disagreed with the pixel data twice).
 */
import { expect, test } from '@playwright/test';
import { loadFixture } from './support/fixture';
import { cleanupBrain, seedBrain } from './support/brain-fixture';
import { DESKTOP_VIEWPORT, newCapturePage } from './support/visual-capture';

test('map margins are symmetric and the cluster is centred', async ({ browser }) => {
  const fixture = loadFixture();
  const seed = await seedBrain(
    fixture.baseUrl,
    `Margins ${Date.now().toString(36)}`,
    [
      'On [[Attention]] and [[Memory]].',
      'On [[Attention]] and [[Practice]].',
      'On [[Memory]] and [[Practice]].',
      'On [[Solitude]] and [[Attention]].',
      'On [[Reading]] and [[Memory]].',
    ],
    ['Attention', 'Memory', 'Practice', 'Solitude', 'Reading']
  );

  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
    await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
    await page.locator('.view-mode-control .toggle-opt:last-child').click();
    await page.locator('app-concept-map .map-svg').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);

    const m = await page.evaluate(() => {
      const svg = document.querySelector('app-concept-map .map-svg') as SVGSVGElement;
      const c = svg.getBoundingClientRect();

      const boxOf = (sel: string) => {
        const els = Array.from(svg.querySelectorAll(sel)) as Element[];
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const el of els) {
          const q = el.getBoundingClientRect();
          if (!q.width && !q.height) continue;
          l = Math.min(l, q.left); t = Math.min(t, q.top);
          r = Math.max(r, q.right); b = Math.max(b, q.bottom);
        }
        if (!isFinite(l)) return null;
        return { left: Math.round(l - c.left), top: Math.round(t - c.top), right: Math.round(c.right - r), bottom: Math.round(c.bottom - b) };
      };

      const circles = boxOf('circle.map-node-visual');
      const labels = boxOf('text.map-node-label');
      const all = boxOf('circle.map-node-visual, text.map-node-label');

      return {
        canvas: { w: Math.round(c.width), h: Math.round(c.height) },
        // SVG user units -> screen px scale, so we can sanity-check the numbers.
        scale: Math.round((c.width / svg.viewBox.baseVal.width) * 1000) / 1000,
        circleMargins: circles,
        labelMargins: labels,
        allMargins: all,
      };
    });

    console.log('MARGINS (px):', JSON.stringify(m, null, 1));

    const all = m.allMargins!;
    console.log(
      `vertical balance: top margin ${all.top}px vs bottom ${all.bottom}px ` +
        `-> imbalance ${Math.abs(all.top - all.bottom)}px`
    );
    console.log(
      `horizontal balance: left ${all.left}px vs right ${all.right}px ` +
        `-> imbalance ${Math.abs(all.left - all.right)}px`
    );

    // Vertical imbalance must be small relative to the canvas. Labels hang below
    // their nodes, so a few px of asymmetry is expected and fine.
    const tolV = Math.round(m.canvas.h * 0.08);
    const tolH = Math.round(m.canvas.w * 0.08);
    expect(
      Math.abs(all.top - all.bottom),
      `vertical imbalance ${Math.abs(all.top - all.bottom)}px (tol ${tolV}); top=${all.top} bottom=${all.bottom}`
    ).toBeLessThanOrEqual(tolV);
    expect(
      Math.abs(all.left - all.right),
      `horizontal imbalance ${Math.abs(all.left - all.right)}px (tol ${tolH}); left=${all.left} right=${all.right}`
    ).toBeLessThanOrEqual(tolH);
  } finally {
    await context.close();
    await cleanupBrain(fixture.baseUrl, seed);
  }
});
