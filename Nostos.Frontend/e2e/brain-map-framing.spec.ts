/**
 * Decisive, pixel-space measurement of the map's framing.
 *
 * The earlier probe measured node centres in SVG *user* units. This measures the
 * drawn graph's bounding box in real *screen* pixels relative to the visible
 * canvas, which is the only thing that decides whether the graph looks centred
 * and whether it fills the frame. It also measures the label extents, because a
 * label can extend the visual bbox beyond the node positions.
 */
import { expect, test } from '@playwright/test';
import { apiPost, loadFixture } from './support/fixture';
import { DESKTOP_VIEWPORT, newCapturePage } from './support/visual-capture';

test('map cluster is centred and fills the canvas in screen pixels', async ({ browser }) => {
  const fixture = loadFixture();
  const book = await apiPost<{ id: string }>(fixture.baseUrl, '/api/books', {
    type: 'physical',
    title: `Framing ${Date.now().toString(36)}`,
    author: 'Nostos QA',
    categories: 'visual-qa',
  });
  for (const content of [
    'On [[Attention]] and [[Memory]].',
    'On [[Attention]] and [[Practice]].',
    'On [[Memory]] and [[Practice]].',
    'On [[Solitude]] and [[Attention]].',
    'On [[Reading]] and [[Memory]].',
  ]) {
    await apiPost(fixture.baseUrl, `/api/books/${book.id}/notes`, { content });
  }

  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
    await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
    await page.locator('.view-mode-control .toggle-opt:last-child').click();
    await page.locator('app-concept-map .map-svg').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);

    const px = await page.evaluate(() => {
      const svg = document.querySelector('app-concept-map .map-svg') as SVGSVGElement;
      const svgRect = svg.getBoundingClientRect();

      // Every drawn element that contributes to the visual footprint.
      const parts = Array.from(
        svg.querySelectorAll('circle.map-node-visual, text.map-node-label')
      ) as (SVGCircleElement | SVGTextElement)[];

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const el of parts) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        minX = Math.min(minX, r.left);
        maxX = Math.max(maxX, r.right);
        minY = Math.min(minY, r.top);
        maxY = Math.max(maxY, r.bottom);
      }

      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      return {
        canvas: { w: Math.round(svgRect.width), h: Math.round(svgRect.height) },
        inkW: Math.round(maxX - minX),
        inkH: Math.round(maxY - minY),
        // Fractions of the canvas the ink occupies.
        fillW: Math.round(clamp((maxX - minX) / svgRect.width) * 100),
        fillH: Math.round(clamp((maxY - minY) / svgRect.height) * 100),
        // Where the ink's centre sits relative to the canvas centre, in px.
        offsetX: Math.round((minX + maxX) / 2 - (svgRect.left + svgRect.width / 2)),
        offsetY: Math.round((minY + maxY) / 2 - (svgRect.top + svgRect.height / 2)),
      };
    });

    console.log('PIXEL FRAMING:', JSON.stringify(px, null, 1));

    // Centred: the ink centre must sit within ~6% of the canvas centre.
    const tolX = Math.round(px.canvas.w * 0.06);
    const tolY = Math.round(px.canvas.h * 0.06);
    expect(Math.abs(px.offsetX), `horizontal offset ${px.offsetX}px (tol ${tolX})`).toBeLessThanOrEqual(tolX);
    expect(Math.abs(px.offsetY), `vertical offset ${px.offsetY}px (tol ${tolY})`).toBeLessThanOrEqual(tolY);

    // Fills the frame: a 5-node cluster should not huddle.
    expect(px.fillH, `ink covers ${px.fillH}% of canvas height`).toBeGreaterThanOrEqual(45);
    expect(px.fillW, `ink covers ${px.fillW}% of canvas width`).toBeGreaterThanOrEqual(30);
  } finally {
    await context.close();
  }
});
