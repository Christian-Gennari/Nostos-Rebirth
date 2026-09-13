/**
 * Brain ↔ Library parity gate.
 *
 * The Brain page is not a separate design; it is the same app. This spec measures
 * the Brain's controls against the Library's, which is the source of truth, and
 * fails when they drift. It exists because several Brain controls were built as
 * bespoke versions of controls the Library already had (different radii, a
 * bordered wrapper around a bordered select, a bespoke equal-weight button row),
 * and "does it look like the same app" only holds if it is enforced.
 *
 * See docs/brain-library-parity.md for the extracted values.
 */
import { expect, test } from '@playwright/test';
import { loadFixture } from './support/fixture';
import { cleanupBrain, seedBrain, type BrainSeed } from './support/brain-fixture';
import { DESKTOP_VIEWPORT, newCapturePage } from './support/visual-capture';

/** Computed geometry for one control, in CSS pixels. */
interface Box {
  height: number;
  padding: string;
  borderRadius: string;
  borderWidth: string;
  outlineWidth: string;
}

async function measure(
  page: import('@playwright/test').Page,
  selector: string
): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = getComputedStyle(el);
    return {
      height: Math.round(el.getBoundingClientRect().height * 10) / 10,
      padding: c.padding,
      borderRadius: c.borderRadius,
      borderWidth: c.borderTopWidth,
      outlineWidth: c.outlineWidth,
    };
  }, selector);
}

test('brain controls match the library controls', async ({ browser }) => {
  const fixture = loadFixture();

  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    // --- Library: the source of truth -------------------------------------
    await page.goto(`${fixture.baseUrl}/library`, { waitUntil: 'domcontentloaded' });
    await page.locator('header.toolbar').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);

    const libSearch = await measure(page, '.search-input');
    const libSelect = await measure(page, '.sort-select');
    const libToggleGroup = await measure(page, '.control-group');
    // ACTIVE on both sides: the active option carries the outline/shadow that the
    // inactive one does not, so comparing active-to-inactive is a false failure.
    const libToggleOpt = await measure(page, '.toggle-opt.active');

    expect(
      libSearch && libSelect && libToggleGroup && libToggleOpt,
      'library controls present'
    ).toBeTruthy();

    // --- Brain ------------------------------------------------------------
    await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
    await page.locator('.search-box input').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);

    const brainSearch = await measure(page, '.search-box');
    const brainSelect = await measure(page, '.sort-select');
    const brainToggleGroup = await measure(page, '.view-mode-control');
    const brainToggleOpt = await measure(page, '.view-mode-control .toggle-opt.active');

    expect(
      brainSearch && brainSelect && brainToggleGroup && brainToggleOpt,
      'brain controls present'
    ).toBeTruthy();

    console.log(
      'SEARCH  library:', JSON.stringify(libSearch), '\n        brain  :', JSON.stringify(brainSearch)
    );
    console.log(
      'SELECT  library:', JSON.stringify(libSelect), '\n        brain  :', JSON.stringify(brainSelect)
    );
    console.log(
      'TOGGLE-GROUP library:', JSON.stringify(libToggleGroup), '\n             brain  :', JSON.stringify(brainToggleGroup)
    );
    console.log(
      'TOGGLE-OPT   library:', JSON.stringify(libToggleOpt), '\n             brain  :', JSON.stringify(brainToggleOpt)
    );

    // Radii are the most visible divergence and the one explicitly called out.
    expect(brainSearch!.borderRadius, 'search radius').toBe(libSearch!.borderRadius);
    expect(brainSelect!.borderRadius, 'select radius').toBe(libSelect!.borderRadius);
    expect(brainToggleGroup!.borderRadius, 'toggle container radius').toBe(libToggleGroup!.borderRadius);
    expect(brainToggleOpt!.borderRadius, 'toggle option radius').toBe(libToggleOpt!.borderRadius);

    // The search and select must be the same height as the Library's, so the two
    // toolbars read at the same rhythm.
    expect(Math.abs(brainSearch!.height - libSearch!.height), 'search height').toBeLessThanOrEqual(2);
    expect(Math.abs(brainSelect!.height - libSelect!.height), 'select height').toBeLessThanOrEqual(2);
    expect(Math.abs(brainToggleGroup!.height - libToggleGroup!.height), 'toggle group height').toBeLessThanOrEqual(2);
    expect(Math.abs(brainToggleOpt!.height - libToggleOpt!.height), 'toggle option height').toBeLessThanOrEqual(2);
  } finally {
    await context.close();
  }
});

let seed: BrainSeed | null = null;

test('brain sidebar row matches the library sidebar row', async ({ browser }) => {
  const fixture = loadFixture();
  // The Brain index only renders rows when concepts exist, and the shared fixture
  // starts empty — so seed (and clean up) rather than assuming data.
  seed = await seedBrain(
    fixture.baseUrl,
    `Parity ${Date.now().toString(36)}`,
    [
      'A note about [[Attention]] and [[Memory]].',
      'Another on [[Attention]] and [[Practice]].',
    ],
    ['Attention', 'Memory', 'Practice']
  );

  const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
  try {
    await page.goto(`${fixture.baseUrl}/library`, { waitUntil: 'domcontentloaded' });
    await page.locator('.nav-item').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const libRow = await measure(page, '.nav-item');
    const libBadge = await measure(page, '.nav-item .count-badge');

    await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
    await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const brainRow = await measure(page, '.index-item');
    const brainBadge = await measure(page, '.index-item .count');

    expect(libRow && brainRow && libBadge && brainBadge, 'sidebar rows present').toBeTruthy();

    console.log('ROW   library:', JSON.stringify(libRow), '\n      brain  :', JSON.stringify(brainRow));
    console.log('BADGE library:', JSON.stringify(libBadge), '\n      brain  :', JSON.stringify(brainBadge));

    // Row geometry: the selected pill, radii and rhythm must be identical. A
    // 46px Brain row next to a 34px Library row was the visible mismatch.
    expect(brainRow!.borderRadius, 'row radius').toBe(libRow!.borderRadius);
    expect(brainRow!.padding, 'row padding').toBe(libRow!.padding);
    expect(
      Math.abs(brainRow!.height - libRow!.height),
      `row height: brain ${brainRow!.height} vs library ${libRow!.height}`
    ).toBeLessThanOrEqual(2);

    // The count badge is a deliberate 20px pill in both, not plain text.
    expect(brainBadge!.height, 'badge height').toBe(libBadge!.height);
    expect(brainBadge!.borderRadius, 'badge radius').toBe(libBadge!.borderRadius);
  } finally {
    await context.close();
    if (seed) await cleanupBrain(fixture.baseUrl, seed);
  }
});
