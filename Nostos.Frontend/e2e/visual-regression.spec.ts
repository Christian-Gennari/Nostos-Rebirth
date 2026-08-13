/**
 * Visual-regression evidence harness — the 14-image matrix.
 *
 * Reusable, parameterized capture(surface, viewport, theme, state) that turns
 * the mandatory visual-verification protocol (expert section 4) into a
 * mechanical, committable artifact: each capture produces a PNG + a geometry
 * JSON report under e2e/visual-evidence/, and the automated geometry checks
 * from the protocol run as real assertions:
 *
 *   - EPUB iframe foreground/background match the theme tokens (and the shell
 *     surface matches too — no pale rim);
 *   - PDF scrollport bottom clears the shell toolbar at the final page;
 *   - Zen gutters balanced + all zen chrome display:none;
 *   - Library toolbar has no progress combobox; sidebar/drawer exposes the
 *     six contract filters.
 *
 * Surfaces that need data the isolated fixture cannot provide are SKIPPED
 * with a clear, documented message — never faked:
 *   - EPUB/PDF reader surfaces need real book files. No EPUB/PDF test assets
 *     exist in-repo, so by default they skip; set VISUAL_QA_LIBRARY_URL to a
 *     real library instance (serving the build under test) to capture them.
 *   - The library six-filter sidebar contract needs the progress-filter
 *     repair (expert section 3) merged into main. Until it lands the check
 *     reports a documented skip; it activates automatically once merged.
 *
 * The spec runs in the desktop project (config testIgnore covers mobile.*).
 * Mobile captures open their own 390x844 context with touch emulation, so
 * artifact pixels are exactly 1440x900 / 390x844 per the protocol.
 */
import { expect, test } from '@playwright/test';

import { apiPost, loadFixture, newRunId } from './support/fixture';
import {
  artifactPath,
  capturePng,
  checkEpubIframeTheme,
  checkLibraryFilterContract,
  checkLibraryNoProgressCombobox,
  checkPdfFinalPageClearance,
  checkZenChromeHidden,
  checkZenFillsViewport,
  checkZenGuttersBalanced,
  DESKTOP_VIEWPORT,
  findLibraryBook,
  libraryFilterLabels,
  LIBRARY_URL,
  MOBILE_VIEWPORT,
  newCapturePage,
  READER_SKIP_REASON,
  writeGeometryReport,
  apiPut,
  type CaptureMeta,
  type GeometryCheck,
  type Theme,
} from './support/visual-capture';

test.describe.configure({ mode: 'serial' });

const RUN = newRunId();
const SEED_CLIENT = 'visual-qa';
const DOC_TITLE = 'Visual QA Draft';

let fixture: ReturnType<typeof loadFixture>;

function meta(
  name: string,
  surface: CaptureMeta['surface'],
  viewport: CaptureMeta['viewport'],
  theme: Theme,
  state: string
): CaptureMeta {
  return { name, surface, viewport, theme, state };
}

async function expectChecks(name: string, checks: GeometryCheck[], m: CaptureMeta): Promise<void> {
  await writeGeometryReport(name, checks, m);
  for (const check of checks) {
    // Skipped checks are documented dependencies (see geometry JSON + docs);
    // every non-skipped check must pass for the capture to be green.
    if (!check.skipped) {
      expect(check.pass, check.message).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Writing Studio — fixture-served (no book assets needed)
// ---------------------------------------------------------------------------

test.describe('visual matrix — Writing Studio (fixture-served)', () => {
  let docId: string | null = null;

  test('studio-empty-desktop', async ({ browser }) => {
    fixture = loadFixture();
    const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT, 'light');
    try {
      await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
      await page.locator('.editor-pane .empty-state').waitFor({ timeout: 30_000 });
      await expect(page.locator('.editor-pane .empty-state p')).toContainText('Select a file to begin writing');
      const png = await capturePng(page, 'studio-empty-desktop');
      await writeGeometryReport(
        'studio-empty-desktop',
        [
          {
            id: 'studio-empty-state',
            pass: true,
            message: 'empty studio shows the "Select a file to begin writing" state',
            metrics: { png },
          },
        ],
        meta('studio-empty-desktop', 'studio', DESKTOP_VIEWPORT, 'light', 'no-document')
      );
    } finally {
      await context.close();
    }
  });

  test('studio-document-desktop', async ({ browser }) => {
    // Seed one document through the supported REST surface, then open it.
    const created = await apiPost<{ id: string }>(fixture.baseUrl, '/api/writings', {
      name: DOC_TITLE,
      type: 'Document',
      parentId: null,
    });
    docId = created.id;
    await apiPut(fixture.baseUrl, `/api/writings/${docId}`, {
      name: DOC_TITLE,
      content:
        '# Visual QA Draft\n\nA paragraph of representative prose so the editor has visible ' +
        'content in the evidence capture.\n\n## Section\n\nMore prose, a few sentences long, ' +
        'to give the writing surface a realistic height in the screenshot.',
    });

    const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT, 'light');
    try {
      await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
      await page
        .locator('.file-list .tree-row', { hasText: DOC_TITLE })
        .waitFor({ timeout: 30_000 });
      await page.locator('.file-list .tree-row', { hasText: DOC_TITLE }).click();
      await page.locator('.tox-tinymce').waitFor({ timeout: 45_000 });
      await page.waitForTimeout(800); // let TinyMCE layout settle
      await expect(page.locator('.editor-header .zen-toggle')).toBeVisible();

      const png = await capturePng(page, 'studio-document-desktop');
      await writeGeometryReport(
        'studio-document-desktop',
        [
          {
            id: 'studio-document-open',
            pass: true,
            message: `document '${DOC_TITLE}' open in the editor with normal chrome visible`,
            metrics: { png },
          },
        ],
        meta('studio-document-desktop', 'studio', DESKTOP_VIEWPORT, 'light', 'document-open')
      );
    } finally {
      await context.close();
    }
  });

  test('studio-zen-desktop', async ({ browser }) => {
    expect(docId, 'studio-document-desktop must run first (serial)').toBeTruthy();
    const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT, 'light');
    try {
      await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
      await page.locator('.file-list .tree-row', { hasText: DOC_TITLE }).waitFor({ timeout: 30_000 });
      await page.locator('.file-list .tree-row', { hasText: DOC_TITLE }).click();
      await page.locator('.tox-tinymce').waitFor({ timeout: 45_000 });
      await page.locator('.editor-header .zen-toggle').click();
      await page.locator('.zen-exit').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);

      const checks = [
        await checkZenFillsViewport(page),
        await checkZenChromeHidden(page),
        await checkZenGuttersBalanced(page),
      ];
      await expectChecks('studio-zen-desktop', checks, meta('studio-zen-desktop', 'studio', DESKTOP_VIEWPORT, 'light', 'zen'));
      await capturePng(page, 'studio-zen-desktop');
    } finally {
      await context.close();
    }
  });

  test('studio-zen-mobile', async ({ browser }) => {
    expect(docId, 'studio-document-desktop must run first (serial)').toBeTruthy();
    const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, 'light', true);
    try {
      await page.goto(`${fixture.baseUrl}/studio`, { waitUntil: 'domcontentloaded' });
      // On mobile the file sidebar starts closed; open it through the UI.
      const openSidebar = page.locator('.editor-pane .empty-state .btn-outline');
      if (await openSidebar.isVisible().catch(() => false)) {
        await openSidebar.click();
      }
      await page.locator('.file-list .tree-row', { hasText: DOC_TITLE }).waitFor({ timeout: 30_000 });
      await page.locator('.file-list .tree-row', { hasText: DOC_TITLE }).click();
      await page.locator('.tox-tinymce').waitFor({ timeout: 45_000 });
      // Selecting a document closes the mobile sidebar; the zen toggle lives in
      // the (now visible) editor header.
      await page.locator('.editor-header .zen-toggle').click();
      await page.locator('.zen-exit').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);

      const checks = [
        await checkZenFillsViewport(page),
        await checkZenChromeHidden(page),
        await checkZenGuttersBalanced(page),
      ];
      await expectChecks('studio-zen-mobile', checks, meta('studio-zen-mobile', 'studio', MOBILE_VIEWPORT, 'light', 'zen'));
      await capturePng(page, 'studio-zen-mobile');
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Library — fixture-served
// ---------------------------------------------------------------------------

test.describe('visual matrix — Library (fixture-served)', () => {
  test.beforeAll(async () => {
    fixture = loadFixture();
    // Populate the library through supported REST so the filters page is not empty.
    const books: Array<{ type: string; title: string; author?: string; categories?: string }> = [
      { type: 'physical', title: 'Visual QA: Meditations', author: 'Marcus Aurelius', categories: 'philosophy' },
      { type: 'physical', title: 'Visual QA: Candide', author: 'Voltaire', categories: 'literature' },
      { type: 'physical', title: 'Visual QA: Poetics', author: 'Aristotle', categories: 'philosophy' },
      { type: 'physical', title: 'Visual QA: Symposium', author: 'Plato', categories: 'philosophy' },
    ];
    for (const book of books) {
      await apiPost(fixture.baseUrl, '/api/books', { ...book });
    }
  });

  test('library-filters-desktop', async ({ browser }) => {
    const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT, 'light');
    try {
      await page.goto(`${fixture.baseUrl}/library`, { waitUntil: 'domcontentloaded' });
      await page.locator('header.toolbar').waitFor({ timeout: 30_000 });
      await page.locator('.sidebar-panel nav.sidebar .nav-group .nav-item').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);

      // Evidence first: the PNG is produced even when a documented dependency
      // below is not merged yet.
      await capturePng(page, 'library-filters-desktop');

      const checks: GeometryCheck[] = [];
      checks.push(await checkLibraryNoProgressCombobox(page));
      checks.push(await checkLibraryFilterContract(await libraryFilterLabels(page)));
      await expectChecks('library-filters-desktop', checks, meta('library-filters-desktop', 'library', DESKTOP_VIEWPORT, 'light', 'filters'));
    } finally {
      await context.close();
    }
  });

  test('library-filters-mobile-open', async ({ browser }) => {
    const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, 'light', true);
    try {
      await page.goto(`${fixture.baseUrl}/library`, { waitUntil: 'domcontentloaded' });
      await page.locator('header.toolbar').waitFor({ timeout: 30_000 });
      // Open the sidebar drawer (off-canvas on mobile).
      await page.locator('.floating-toggle').click();
      await page.locator('.mobile-backdrop').waitFor({ timeout: 15_000 });
      await page.locator('.sidebar-panel nav.sidebar .nav-group .nav-item').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);

      await capturePng(page, 'library-filters-mobile-open');

      const checks: GeometryCheck[] = [];
      checks.push(await checkLibraryNoProgressCombobox(page));
      checks.push(await checkLibraryFilterContract(await libraryFilterLabels(page)));
      await expectChecks('library-filters-mobile-open', checks, meta('library-filters-mobile-open', 'library', MOBILE_VIEWPORT, 'light', 'drawer-open'));
    } finally {
      await context.close();
    }
  });

  // The six-filter sidebar contract needs the progress-filter repair (expert
  // section 3) merged into main. Until then these tests skip with the exact
  // reason; when the repair lands they assert the contract for real.
  const contractTests = [
    { name: 'library-six-filter-contract-desktop', viewport: DESKTOP_VIEWPORT, mobile: false },
    { name: 'library-six-filter-contract-mobile', viewport: MOBILE_VIEWPORT, mobile: true },
  ];
  for (const ct of contractTests) {
    test(ct.name, async ({ browser }) => {
      const { context, page } = await newCapturePage(browser, ct.viewport, 'light', ct.mobile);
      try {
        await page.goto(`${fixture.baseUrl}/library`, { waitUntil: 'domcontentloaded' });
        if (ct.mobile) {
          await page.locator('.floating-toggle').click();
          await page.locator('.mobile-backdrop').waitFor({ timeout: 15_000 });
        }
        await page.locator('.sidebar-panel nav.sidebar .nav-group .nav-item').first().waitFor({ timeout: 15_000 });

        const check = await checkLibraryFilterContract(await libraryFilterLabels(page));
        test.skip(check.skipped ?? false, check.message);
        await expectChecks(ct.name, [check], meta(ct.name, 'library', ct.viewport, 'light', 'contract'));
      } finally {
        await context.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Reader surfaces — EPUB/PDF (real library only; skipped otherwise)
// ---------------------------------------------------------------------------

interface ReaderCase {
  name: string;
  kind: 'epub' | 'pdf';
  theme: Theme;
  viewport: { width: number; height: number };
  mobile: boolean;
  state: string;
}

const READER_MATRIX: ReaderCase[] = [
  { name: 'epub-light-desktop', kind: 'epub', theme: 'light', viewport: DESKTOP_VIEWPORT, mobile: false, state: 'in-session-toggle' },
  { name: 'epub-dark-desktop', kind: 'epub', theme: 'dark', viewport: DESKTOP_VIEWPORT, mobile: false, state: 'in-session-toggle' },
  { name: 'epub-sepia-desktop', kind: 'epub', theme: 'sepia', viewport: DESKTOP_VIEWPORT, mobile: false, state: 'in-session-toggle' },
  { name: 'epub-dark-mobile', kind: 'epub', theme: 'dark', viewport: MOBILE_VIEWPORT, mobile: true, state: 'in-session-toggle' },
  { name: 'pdf-light-desktop', kind: 'pdf', theme: 'light', viewport: DESKTOP_VIEWPORT, mobile: false, state: 'final-page-bottom' },
  { name: 'pdf-dark-desktop', kind: 'pdf', theme: 'dark', viewport: DESKTOP_VIEWPORT, mobile: false, state: 'final-page-bottom' },
  { name: 'pdf-sepia-desktop', kind: 'pdf', theme: 'sepia', viewport: DESKTOP_VIEWPORT, mobile: false, state: 'final-page-bottom' },
  { name: 'pdf-dark-mobile-bottom', kind: 'pdf', theme: 'dark', viewport: MOBILE_VIEWPORT, mobile: true, state: 'final-page-bottom' },
];

test.describe('visual matrix — Reader surfaces (real library)', () => {
  for (const tc of READER_MATRIX) {
    test(`${tc.name}`, async ({ browser }) => {
      test.skip(!LIBRARY_URL, READER_SKIP_REASON);

      const book = await findLibraryBook(tc.kind);
      test.skip(
        !book,
        `no ${tc.kind} book with a file found at VISUAL_QA_LIBRARY_URL (${LIBRARY_URL}) — ` +
          `add one to the real library to capture '${tc.name}' (see docs/visual-verification.md §Reader surfaces)`
      );

      const { context, page } = await newCapturePage(browser, tc.viewport, 'light', tc.mobile);
      try {
        await page.goto(`${LIBRARY_URL}/read/${book!.id}`, { waitUntil: 'domcontentloaded' });

        if (tc.kind === 'epub') {
          await page.locator('#epub-viewer iframe').waitFor({ state: 'attached', timeout: 45_000 });
          await page
            .frameLocator('#epub-viewer iframe')
            .locator('body')
            .first()
            .waitFor({ timeout: 45_000 });
        } else {
          await page.locator('#viewerContainer canvas').first().waitFor({ timeout: 60_000 });
        }

        // In-session theme toggle (expert: dark/sepia "after an in-session toggle").
        await page.getByRole('button', { name: `${tc.theme[0].toUpperCase()}${tc.theme.slice(1)} theme` }).click();
        await page.waitForTimeout(1200); // rendition/pdf.js re-theme settle

        const checks: GeometryCheck[] = [];
        if (tc.kind === 'epub') {
          checks.push(await checkEpubIframeTheme(page, tc.theme));
          // Highlight note: the app has no programmatic highlight-placement API —
          // highlights require real user selection inside the book, which the
          // harness cannot synthesize. Documented in docs/visual-verification.md.
        } else {
          checks.push(await checkPdfFinalPageClearance(page));
        }

        await expectChecks(tc.name, checks, meta(tc.name, tc.kind, tc.viewport, tc.theme, tc.state));
        const png = await capturePng(page, tc.name);
        expect(artifactPath(tc.name, 'png')).toBe(png); // evidence path sanity
      } finally {
        await context.close();
      }
    });
  }
});
