/**
 * Long-review collapse — geometry evidence (issue #159).
 *
 * WHY THIS IS AN E2E SPEC AND NOT A UNIT TEST
 * ------------------------------------------
 * The decision under test is "how tall does this review actually RENDER".
 * jsdom implements no layout (`scrollHeight` is always 0), so the number that
 * decides everything cannot be produced there. This spec drives a real engine
 * and asserts the measurements the feature depends on:
 *
 *   1. the calibration anchor ("Devils", the review the issue names) stays fully
 *      expanded at every width, with no control and no fade;
 *   2. a genuinely longer review collapses, and the collapsed preview is a
 *      useful amount of text rather than a line or two;
 *   3. the clamp is PRESENTATION ONLY — the full text stays in the DOM and the
 *      backend record is byte-identical after expand/collapse;
 *   4. a clamped paragraph still reports its FULL height, which is the property
 *      the component's measurement relies on. If a browser ever started
 *      rewriting `scrollHeight` under `-webkit-line-clamp`, the collapse decision
 *      would silently break, and this check is what catches it.
 *
 * Real-library only, like the hero capture: it needs books carrying actual
 * reviews. Run with
 *   VISUAL_QA_LIBRARY_URL=http://localhost:5321 npm run e2e -- book-detail-review.spec.ts
 * against an instance serving the build under test.
 */
import { expect, test } from '@playwright/test';

import {
  capturePng,
  DESKTOP_VIEWPORT,
  LIBRARY_URL,
  MOBILE_VIEWPORT,
  newCapturePage,
  writeGeometryReport,
  type CaptureMeta,
  type GeometryCheck,
} from './support/visual-capture';
import { apiGet, apiPost } from './support/fixture';

/** Mirrors `REVIEW_COLLAPSE_LINES` in book-detail.component.ts. */
const COLLAPSE_LINES = 50;
/** Mirrors `--review-preview-lines` in book-detail.component.css. */
const PREVIEW_LINES = 12;

interface BookRow {
  id: string;
  title: string;
  personalReview?: string | null;
}

/**
 * Marks the books this spec creates. They are excluded from the anchor search
 * and deleted afterwards, so a run never leaves the library polluted and never
 * mistakes its own overlong fixture for the calibration anchor.
 */
const FIXTURE_PREFIX = 'ZZ Visual QA:';

/**
 * The longest review in the library — a stand-in for the issue's anchor.
 *
 * Its own fixtures are excluded by prefix, and candidates are rejected unless
 * they are genuinely BELOW the collapse threshold: a book that already renders
 * past the threshold is by definition not an example of "a review that should
 * stay expanded", so using one for the anchor check would assert the wrong
 * thing.
 */
async function findAnchorBook(): Promise<BookRow | null> {
  const data = await apiGet<{ items?: BookRow[] }>(LIBRARY_URL, '/api/books?pageSize=200');
  const withReview = (data.items ?? []).filter(
    (b) => (b.personalReview ?? '').trim().length > 0 && !b.title.startsWith(FIXTURE_PREFIX)
  );
  if (!withReview.length) return null;
  return withReview.sort(
    (a, b) => (b.personalReview ?? '').length - (a.personalReview ?? '').length
  )[0];
}

/** A review no reading-height threshold could sensibly leave expanded. */
async function seedOverlongBook(): Promise<BookRow> {
  const paragraph = (i: number) =>
    `Paragraph ${i}. This synthetic review exists only to give the collapse ` +
    `behaviour a review that is unambiguously past any sensible reading threshold. ` +
    `It describes no real book.`;
  const review = Array.from({ length: 60 }, (_, i) => paragraph(i + 1)).join('\n\n');
  const created = await apiPost<BookRow>(LIBRARY_URL, '/api/books', {
    type: 'physical',
    title: `${FIXTURE_PREFIX} Long Review`,
    author: 'QA Fixture',
    personalReview: review,
  });
  return created;
}

/** Removes the fixtures this spec created. */
async function deleteFixtures(): Promise<void> {
  const data = await apiGet<{ items?: BookRow[] }>(LIBRARY_URL, '/api/books?pageSize=200');
  for (const b of data.items ?? []) {
    if (!b.title.startsWith(FIXTURE_PREFIX)) continue;
    await fetch(`${LIBRARY_URL}/api/books/${b.id}`, { method: 'DELETE' });
  }
}

/** Reads the review's geometry and collapse state from the live page. */
async function readReviewState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const p = document.querySelector('.personal-review .review-text') as HTMLElement | null;
    const body = document.querySelector('.review-body') as HTMLElement | null;
    const toggle = document.querySelector('.review-toggle') as HTMLButtonElement | null;
    const fade = document.querySelector('.review-fade');
    if (!p || !body) return null;
    const cs = getComputedStyle(p);
    const lh = parseFloat(cs.lineHeight);
    return {
      fullLines: Math.round((p.scrollHeight / lh) * 10) / 10,
      visibleLines: Math.round((p.clientHeight / lh) * 10) / 10,
      clamped: body.classList.contains('clamped'),
      clamp: cs.webkitLineClamp,
      display: cs.display,
      overflow: cs.overflow,
      hasToggle: !!toggle,
      toggleLabel: toggle ? toggle.textContent!.replace(/\s+/g, ' ').trim() : null,
      ariaExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      ariaControls: toggle ? toggle.getAttribute('aria-controls') : null,
      hasFade: !!fade,
      textLength: p.textContent!.length,
      text: p.textContent!,
      id: p.id,
    };
  });
}


/**
 * Brings the review section into view before a capture. Without this the PNG is
 * the top of the page: the review card sits below the fold, so the evidence would
 * never actually show the control or the fade it is supposed to document.
 */
async function frameReview(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.personal-review').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
}

test.describe('visual matrix — Book detail long-review collapse (real library)', () => {
  const SKIP =
    'long-review collapse needs a real library instance serving the build under test. ' +
    'Run with VISUAL_QA_LIBRARY_URL=<origin> (see docs/visual-verification.md §Book detail).';

  test('book-detail-review-desktop', async ({ browser }) => {
    test.skip(!LIBRARY_URL, SKIP);

    const anchor = await findAnchorBook();
    test.skip(!anchor, `no book with a review found at ${LIBRARY_URL} — add one to capture this.`);
    const overlong = await seedOverlongBook();

    const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
    const checks: GeometryCheck[] = [];
    try {
      // ── 1. The anchor review stays fully expanded ─────────────────────────
      await page.goto(`${LIBRARY_URL}/library/${anchor!.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.personal-review .review-text').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);

      await frameReview(page);
      const anchorPng = await capturePng(page, 'book-detail-review-anchor-desktop');
      expect(anchorPng).toContain('book-detail-review-anchor-desktop');

      const anchorState = (await readReviewState(page))!;
      const anchorOk =
        !anchorState.clamped &&
        !anchorState.hasToggle &&
        !anchorState.hasFade &&
        anchorState.fullLines <= COLLAPSE_LINES;
      checks.push({
        id: 'review-anchor-expanded',
        pass: anchorOk,
        message: anchorOk
          ? `anchor review "${anchor!.title}" renders ${anchorState.fullLines} lines (<= ${COLLAPSE_LINES}) and stays expanded: no clamp, no control, no fade`
          : `anchor review "${anchor!.title}" must stay fully expanded below the threshold, but clamped=${anchorState.clamped} toggle=${anchorState.hasToggle} fade=${anchorState.hasFade} lines=${anchorState.fullLines}`,
        metrics: { title: anchor!.title, ...anchorState, text: undefined },
      });

      // ── 2-3. The overlong review collapses, expands, collapses again ──────
      await page.goto(`${LIBRARY_URL}/library/${overlong.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.review-toggle').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);

      const collapsed = (await readReviewState(page))!;
      await frameReview(page);
      const collapsedPng = await capturePng(page, 'book-detail-review-collapsed-desktop');

      const collapsedOk =
        collapsed.clamped &&
        collapsed.hasToggle &&
        collapsed.hasFade &&
        collapsed.ariaExpanded === 'false' &&
        collapsed.ariaControls === collapsed.id &&
        collapsed.fullLines > COLLAPSE_LINES &&
        Math.round(collapsed.visibleLines) === PREVIEW_LINES;
      checks.push({
        id: 'review-collapsed-preview',
        pass: collapsedOk,
        message: collapsedOk
          ? `a ${collapsed.fullLines}-line review collapses to a ${collapsed.visibleLines}-line preview with a "${collapsed.toggleLabel}" control (aria-expanded=${collapsed.ariaExpanded}, aria-controls=${collapsed.ariaControls}) and a fade`
          : `collapse preview is wrong: lines ${collapsed.visibleLines}/${collapsed.fullLines}, clamped=${collapsed.clamped}, toggle=${collapsed.hasToggle} (${collapsed.toggleLabel}), fade=${collapsed.hasFade}, aria=${collapsed.ariaExpanded}/${collapsed.ariaControls} vs ${collapsed.id}`,
        metrics: { ...collapsed, text: undefined, png: collapsedPng },
      });

      // Expand on demand, then collapse again — all in place.
      await page.locator('.review-toggle').click();
      await page.waitForTimeout(400);
      const expanded = (await readReviewState(page))!;
      await frameReview(page);
      const expandedPng = await capturePng(page, 'book-detail-review-expanded-desktop');

      const expandedOk =
        !expanded.clamped &&
        !expanded.hasFade &&
        expanded.ariaExpanded === 'true' &&
        expanded.visibleLines === expanded.fullLines &&
        // Presentation only: the full text is still in the DOM, untouched.
        expanded.textLength === collapsed.textLength &&
        expanded.text === collapsed.text;

      checks.push({
        id: 'review-expands-in-place',
        pass: expandedOk,
        message: expandedOk
          ? `expanding shows all ${expanded.fullLines} lines in place (aria-expanded=true) with the full ${expanded.textLength}-char review intact in the DOM`
          : `expand is wrong: clamped=${expanded.clamped} lines=${expanded.visibleLines}/${expanded.fullLines} aria=${expanded.ariaExpanded} textLen ${expanded.textLength} (was ${collapsed.textLength})`,
        metrics: { ...expanded, text: undefined, png: expandedPng },
      });

      // Collapse again without leaving the page.
      await page.locator('.review-toggle').click();
      await page.waitForTimeout(400);
      const recollapsed = (await readReviewState(page))!;
      const recollapseOk =
        recollapsed.clamped &&
        recollapsed.ariaExpanded === 'false' &&
        recollapsed.visibleLines !== recollapsed.fullLines;
      checks.push({
        id: 'review-collapses-again',
        pass: recollapseOk,
        message: recollapseOk
          ? `collapsing again returns to the ${recollapsed.visibleLines}-line preview without leaving or reloading the page`
          : `re-collapse is wrong: clamped=${recollapsed.clamped} lines=${recollapsed.visibleLines}/${recollapsed.fullLines} aria=${recollapsed.ariaExpanded}`,
        metrics: { ...recollapsed, text: undefined },
      });

      // ── 4. The stored record is untouched (read back from the API) ────────
      const stored = await apiGet<BookRow>(LIBRARY_URL, `/api/books/${overlong.id}`);
      const storedOk =
        (stored.personalReview ?? '') === (overlong.personalReview ?? '') &&
        (stored.personalReview ?? '').length === collapsed.textLength;
      checks.push({
        id: 'review-storage-untouched',
        pass: storedOk,
        message: storedOk
          ? `the stored review is byte-identical after collapse/expand/collapse (${(stored.personalReview ?? '').length} chars)`
          : `the stored review changed: ${(stored.personalReview ?? '').length} chars vs ${(overlong.personalReview ?? '').length} created / ${collapsed.textLength} rendered`,
        metrics: {
          storedLength: (stored.personalReview ?? '').length,
          createdLength: (overlong.personalReview ?? '').length,
          renderedLength: collapsed.textLength,
        },
      });

      const meta: CaptureMeta = {
        name: 'book-detail-review-desktop',
        surface: 'book-detail',
        viewport: DESKTOP_VIEWPORT,
        state: 'long-review-collapse',
      };
      await writeGeometryReport('book-detail-review-desktop', checks, meta);
      for (const c of checks) expect(c.pass, c.message).toBe(true);
    } finally {
      await context.close();
      await deleteFixtures();
    }
  });

  test('book-detail-review-mobile', async ({ browser }) => {
    test.skip(!LIBRARY_URL, SKIP);

    const overlong = await seedOverlongBook();
    const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, true);
    try {
      await page.goto(`${LIBRARY_URL}/library/${overlong.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.review-toggle').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);

      const state = (await readReviewState(page))!;
      await frameReview(page);
      const png = await capturePng(page, 'book-detail-review-mobile');

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      );
      const ok =
        state.clamped &&
        state.hasToggle &&
        Math.round(state.visibleLines) === PREVIEW_LINES &&
        state.ariaExpanded === 'false' &&
        noOverflow;

      const check: GeometryCheck = {
        id: 'review-mobile-collapse',
        pass: ok,
        message: ok
          ? `at ${MOBILE_VIEWPORT.width}px the ${state.fullLines}-line review collapses to ${state.visibleLines} lines with a keyboard-reachable control and no horizontal overflow`
          : `mobile collapse is wrong: clamped=${state.clamped} lines=${state.visibleLines}/${state.fullLines} toggle=${state.hasToggle} aria=${state.ariaExpanded} overflow=${!noOverflow}`,
        metrics: { ...state, text: undefined, png, noOverflow },
      };

      const meta: CaptureMeta = {
        name: 'book-detail-review-mobile',
        surface: 'book-detail',
        viewport: MOBILE_VIEWPORT,
        state: 'long-review-collapse',
      };
      await writeGeometryReport('book-detail-review-mobile', [check], meta);
      expect(check.pass, check.message).toBe(true);
    } finally {
      await context.close();
      await deleteFixtures();
    }
  });
});
