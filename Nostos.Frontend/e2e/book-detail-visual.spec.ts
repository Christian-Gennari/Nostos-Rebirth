/**
 * Book detail visual evidence — the cover echo (cover-derived background wash).
 *
 * Book detail needs a real book WITH cover art (the echo is derived from the
 * cover), so this spec is real-library only and skips with a documented reason
 * otherwise — same contract as the reader surfaces in visual-regression.spec.ts.
 *
 *   VISUAL_QA_LIBRARY_URL=http://localhost:4310 npm run e2e -- book-detail-visual.spec.ts
 *
 * The URL must serve the build under test and have at least one book with a
 * cover. Both viewports are captured from this one spec via newCapturePage's own
 * contexts (the harness pattern), so the file name deliberately avoids the
 * "mobile" pattern that the desktop project ignores.
 *
 * Evidence: e2e/visual-evidence/book-detail-hero-{desktop,mobile}.{png,json}
 */
import { expect, test } from '@playwright/test';

import {
  capturePng,
  checkBookDetailCoverEcho,
  DESKTOP_VIEWPORT,
  findLibraryCoverBook,
  LIBRARY_URL,
  MOBILE_VIEWPORT,
  newCapturePage,
  writeGeometryReport,
  type CaptureMeta,
} from './support/visual-capture';

const SKIP_REASON =
  'book detail needs a real book with cover art, which the isolated e2e fixture cannot ' +
  'provide (its books have no covers and the harness never invents assets). Run with ' +
  '`VISUAL_QA_LIBRARY_URL=<origin>` against an instance serving the build under test ' +
  '(see docs/visual-verification.md §Book detail).';

interface Case {
  name: string;
  viewport: { width: number; height: number };
  mobile: boolean;
}

const CASES: Case[] = [
  { name: 'book-detail-hero-desktop', viewport: DESKTOP_VIEWPORT, mobile: false },
  { name: 'book-detail-hero-mobile', viewport: MOBILE_VIEWPORT, mobile: true },
];

test.describe('visual matrix — Book detail (real library)', () => {
  for (const tc of CASES) {
    test(`${tc.name}`, async ({ browser }) => {
      test.skip(!LIBRARY_URL, SKIP_REASON);

      const book = await findLibraryCoverBook();
      test.skip(
        !book,
        `no book with cover art found at VISUAL_QA_LIBRARY_URL (${LIBRARY_URL}) — add one ` +
          `to the real library to capture '${tc.name}' (see docs/visual-verification.md §Book detail)`
      );

      const { context, page } = await newCapturePage(browser, tc.viewport, tc.mobile);
      try {
        await page.goto(`${LIBRARY_URL}/library/${book!.id}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-title').first().waitFor({ timeout: 30_000 });
        // Let the cover, its thumbnail and the blurred layer paint.
        await page.waitForTimeout(800);

        // Evidence first: the PNG is produced even if a check below fails, so a
        // failing run still leaves something to look at.
        const png = await capturePng(page, tc.name);
        expect(png).toContain(tc.name);

        const check = await checkBookDetailCoverEcho(page);
        const meta: CaptureMeta = {
          name: tc.name,
          surface: 'book-detail',
          viewport: tc.viewport,
          state: 'cover-echo',
        };
        await writeGeometryReport(tc.name, [check], meta);
        expect(check.pass, check.message).toBe(true);
      } finally {
        await context.close();
      }
    });
  }
});
