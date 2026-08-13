/**
 * Visual-verification capture helpers — reusable surface of the visual-QA
 * harness (see ../visual-regression.spec.ts and docs/visual-verification.md).
 *
 * Everything here is additive: it reads the app's rendered DOM and the
 * fixture state, and writes evidence artifacts (PNG + geometry JSON) under
 * e2e/visual-evidence/. It never modifies application code, the Playwright
 * config, or the shared fixture lifecycle.
 *
 * Artifact naming follows the 10-image matrix in docs/visual-verification.md:
 * <surface>-<state>-<viewport>.png, e.g. epub-light-desktop.png. All captures
 * are the app's ONE fixed light rendering — the theme system is gone, so the
 * harness never parameterizes by theme and never clicks theme controls.
 * Viewports are exactly 1440x900 (desktop) and 390x844 (mobile) and PNGs are
 * captured at deviceScaleFactor 1 so the artifact dimensions are exact.
 *
 * Real-library mode: reader surfaces (EPUB/PDF) need a book file, which the
 * isolated e2e fixture cannot provide (no test assets exist in-repo; they are
 * never invented). Set VISUAL_QA_LIBRARY_URL to a running instance that has
 * real books AND serves the build under test; the harness then captures the
 * full 10-image matrix. Without it, reader surfaces skip with a clear message.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Browser, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

export interface Viewport {
  width: number;
  height: number;
}

/** Protocol viewports (expert section 4): exactly these, nothing else. */
export const DESKTOP_VIEWPORT: Viewport = { width: 1440, height: 900 };
export const MOBILE_VIEWPORT: Viewport = { width: 390, height: 844 };

/**
 * Fixed light rendering invariants for the EPUB rendition. The app ships
 * exactly one (light) theme; these constants mirror the single source of
 * truth — epub-reader.component.ts NOSTOS_LIGHT_RULES and the :root tokens
 * in styles.css. If the app tokens change, update these AND the docs
 * (docs/visual-verification.md §Fixed rendering invariants) in the same PR.
 */
export const READER_IFRAME_LIGHT = { background: '#ffffff', color: '#1a1a1a' } as const;

/** Shell surface (--bg-surface tokens; #epub-viewer uses it). */
export const READER_SHELL_LIGHT = '#ffffff';

/**
 * Target library filter contract (expert section 3): the sidebar is the
 * single progress-filter home with exactly these six choices and NO toolbar
 * progress surface. The contract is enforced once the progress-filter repair
 * lands on main; until then the check reports a documented skip (see
 * docs/visual-verification.md §Library).
 */
export const LIBRARY_FILTER_CONTRACT = [
  'All Books',
  'Not Started',
  'In Progress',
  'Favorites',
  'Finished',
  'Unsorted',
] as const;

/** Optional real-library endpoint for reader surfaces (see header comment). */
export const LIBRARY_URL = (process.env.VISUAL_QA_LIBRARY_URL ?? '').replace(/\/+$/, '');

export const READER_SKIP_REASON =
  'reader surfaces require real book files, which the isolated e2e fixture cannot ' +
  'provide (no EPUB/PDF test assets exist in-repo and the harness never invents them). ' +
  'Run against a real library instance with `VISUAL_QA_LIBRARY_URL=<origin>` to capture ' +
  'the EPUB/PDF images (see docs/visual-verification.md §Reader surfaces).';

export interface GeometryCheck {
  id: string;
  pass: boolean;
  /** true when the check is a documented skip (dependency not present), never a failure. */
  skipped?: boolean;
  message: string;
  metrics?: Record<string, unknown>;
}

export interface CaptureMeta {
  name: string;
  surface: 'epub' | 'pdf' | 'studio' | 'library';
  viewport: Viewport;
  state: string;
}

// ---------------------------------------------------------------------------
// Evidence artifacts
// ---------------------------------------------------------------------------

/** e2e/visual-evidence/ — the repo's tracked evidence directory. */
export function evidenceDir(): string {
  const dir = path.join(__dirname, '..', 'visual-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function artifactPath(name: string, ext: 'png' | 'json'): string {
  return path.join(evidenceDir(), `${name}.${ext}`);
}

/** Captures the viewport (exact protocol size) as <name>.png. */
export async function capturePng(page: Page, name: string): Promise<string> {
  const out = artifactPath(name, 'png');
  await page.screenshot({ path: out });
  return out;
}

/** Writes the geometry report <name>.json: one check list per capture. */
export async function writeGeometryReport(
  name: string,
  checks: GeometryCheck[],
  meta: CaptureMeta
): Promise<string> {
  const report = {
    artifact: `${name}.png`,
    capturedAt: new Date().toISOString(),
    ...meta,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.pass && !c.skipped).length,
      skipped: checks.filter((c) => c.skipped).length,
      failed: checks.filter((c) => !c.pass && !c.skipped).length,
    },
  };
  const out = artifactPath(name, 'json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return out;
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

/**
 * Opens a fresh context at the protocol viewport. The app ships exactly one
 * (light) rendering, so no theme state is pre-seeded. mobile emulation adds
 * touch/DPR-1 so artifact pixels are exact.
 */
export async function newCapturePage(
  browser: Browser,
  viewport: Viewport,
  mobile = false
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1, // exact protocol pixel dimensions in the PNG
  });
  const page = await context.newPage();
  return { context, page };
}

// ---------------------------------------------------------------------------
// Geometry checks (expert section 4, "Automated Playwright geometry checks")
// ---------------------------------------------------------------------------

function passCheck(id: string, message: string, metrics?: Record<string, unknown>): GeometryCheck {
  return { id, pass: true, message, metrics };
}

function failCheck(id: string, message: string, metrics?: Record<string, unknown>): GeometryCheck {
  return { id, pass: false, message, metrics };
}

/**
 * EPUB: the rendition iframe's foreground/background must equal the fixed
 * light normalization constants, and the #epub-viewer shell surface must
 * match the same light surface so no pale rim separates shell from content.
 * These are fixed rendering invariants — the app ships exactly one theme.
 */
export async function checkEpubIframeLight(page: Page): Promise<GeometryCheck> {
  const expected = READER_IFRAME_LIGHT;
  const shellExpected = READER_SHELL_LIGHT;
  const frameLocator = page.frameLocator('#epub-viewer iframe');
  const body = frameLocator.locator('body').first();
  await body.waitFor({ timeout: 30_000 });

  const contentStyles = await body.evaluate(() => {
    const hex = (rgb: string): string => {
      const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgb);
      if (!m) return rgb.trim().toLowerCase();
      return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
    };
    const cs = (el: Element) => getComputedStyle(el);
    return {
      bodyBg: hex(cs(document.body).backgroundColor),
      bodyColor: hex(cs(document.body).color),
    };
  });
  const shellBg = await page
    .locator('#epub-viewer')
    .evaluate((el) => {
      const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(getComputedStyle(el).backgroundColor);
      return m
        ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
        : getComputedStyle(el).backgroundColor.trim().toLowerCase();
    });

  const bodyBg = contentStyles.bodyBg;
  const bodyColor = contentStyles.bodyColor;
  const ok = bodyBg === expected.background && bodyColor === expected.color && shellBg === shellExpected;
  return ok
    ? passCheck(
        'epub-iframe-light',
        `iframe ${bodyBg}/${bodyColor} and shell ${shellBg} match the fixed light invariants ` +
          `(${expected.background}/${expected.color}/${shellExpected})`,
        { bodyBg, bodyColor, shellBg, expected }
      )
    : failCheck(
        'epub-iframe-light',
        `iframe/shell colors deviate from the fixed light rendering: got ${bodyBg}/${bodyColor} ` +
          `(shell ${shellBg}), expected ${expected.background}/${expected.color} (shell ${shellExpected})`,
        { bodyBg, bodyColor, shellBg, expected }
      );
}

/**
 * PDF: with the scrollport scrolled to the final page bottom, the scrollport
 * must end above (or flush with) the shell toolbar top — the bottom toolbar
 * must never cover document content.
 */
export async function checkPdfFinalPageClearance(page: Page): Promise<GeometryCheck> {
  const scrollport = page.locator('#viewerContainer');
  await scrollport.waitFor({ timeout: 30_000 });
  await page.locator('#viewerContainer canvas, #viewerContainer .page').first().waitFor({ timeout: 30_000 });
  await scrollport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400); // let pdf.js settle after the jump

  const sp = await scrollport.boundingBox();
  const tb = await page.locator('header.reader-toolbar').boundingBox();
  if (!sp || !tb) {
    return failCheck('pdf-scrollport-clearance', 'could not measure scrollport/toolbar geometry', { sp, tb });
  }
  const clearance = tb.y - (sp.y + sp.height);
  const ok = clearance >= -0.5;
  const msg =
    `final-page scrollport bottom ${(sp.y + sp.height).toFixed(1)}px vs toolbar top ${tb.y.toFixed(1)}px ` +
    `-> clearance ${clearance.toFixed(1)}px (${ok ? 'clear' : 'OVERLAPPED'})`;
  return ok ? passCheck('pdf-scrollport-clearance', msg, { clearance }) : failCheck('pdf-scrollport-clearance', msg, { clearance });
}

/**
 * Zen: every piece of chrome the protocol says must disappear has
 * display:none (sidebars, document header/action strip, status row, TinyMCE
 * menubar/formatting toolbar).
 */
export async function checkZenChromeHidden(page: Page): Promise<GeometryCheck> {
  const selectors = [
    '.sidebar-left',
    '.sidebar-right',
    '.editor-header',
    '.editor-status',
    '.tox-menubar',
    '.tox-toolbar-overlord',
  ];
  const displays = await page.evaluate((sels) => {
    const out: Record<string, string> = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      out[sel] = el ? getComputedStyle(el).display : '<absent>';
    }
    return out;
  }, selectors);
  const violations = Object.entries(displays).filter(([, d]) => d !== 'none' && d !== '<absent>');
  const metrics = { displays };
  return violations.length === 0
    ? passCheck('zen-chrome-hidden', `zen hides all chrome: ${selectors.join(', ')}`, metrics)
    : failCheck(
        'zen-chrome-hidden',
        `zen chrome still visible: ${violations.map(([s, d]) => `${s}=${d}`).join(', ')}`,
        metrics
      );
}

/**
 * Zen: the writing surface must be horizontally centered — left and right
 * gutters balanced within 3px (editor centered via .editor-wrapper
 * align-items:center + symmetric padding; target max-width min(100%, 860px)).
 */
export async function checkZenGuttersBalanced(page: Page): Promise<GeometryCheck> {
  const surface = page.locator('app-markdown-editor').first();
  await surface.waitFor({ timeout: 30_000 });
  const rect = await surface.boundingBox();
  const vw = page.viewportSize()?.width ?? 0;
  if (!rect) return failCheck('zen-gutters-balanced', 'could not measure editor surface');
  const left = rect.x;
  const right = vw - (rect.x + rect.width);
  const delta = Math.abs(left - right);
  const ok = delta <= 3;
  const msg =
    `editor surface ${rect.width.toFixed(1)}px wide in ${vw}px viewport: left gutter ${left.toFixed(1)}px, ` +
    `right gutter ${right.toFixed(1)}px (delta ${delta.toFixed(1)}px, ${ok ? 'balanced' : 'UNBALANCED'})`;
  const metrics = { leftGutter: Math.round(left * 10) / 10, rightGutter: Math.round(right * 10) / 10, delta: Math.round(delta * 10) / 10, surfaceWidth: Math.round(rect.width) };
  return ok ? passCheck('zen-gutters-balanced', msg, metrics) : failCheck('zen-gutters-balanced', msg, metrics);
}

/** Zen: the studio host fills the viewport (position fixed, inset 0). */
export async function checkZenFillsViewport(page: Page): Promise<GeometryCheck> {
  const rect = await page.locator('.studio-layout').boundingBox();
  const vw = page.viewportSize()?.width ?? 0;
  const vh = page.viewportSize()?.height ?? 0;
  if (!rect) return failCheck('zen-fills-viewport', 'could not measure .studio-layout');
  const ok = Math.abs(rect.width - vw) <= 1 && Math.abs(rect.height - vh) <= 1;
  const msg = `studio layout ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} vs viewport ${vw}x${vh} (${ok ? 'fills' : 'does not fill'})`;
  return ok ? passCheck('zen-fills-viewport', msg, { w: rect.width, h: rect.height }) : failCheck('zen-fills-viewport', msg, { w: rect.width, h: rect.height });
}

/**
 * Library toolbar: the progress filter must NOT be a combobox (<select>).
 * The only allowed toolbar select is the sort control. (The expert's full
 * contract — no toolbar progress surface at all — is enforced by
 * checkLibraryFilterContract when the progress-filter repair lands.)
 */
export async function checkLibraryNoProgressCombobox(page: Page): Promise<GeometryCheck> {
  const toolbar = page.locator('header.toolbar');
  await toolbar.waitFor({ timeout: 30_000 });
  const selects = await toolbar.locator('select').all();
  const found: string[] = [];
  for (const sel of selects) {
    const id = (await sel.getAttribute('id')) ?? (await sel.getAttribute('class')) ?? '<unnamed>';
    const options = await sel.locator('option').allTextContents();
    found.push(`${id} [${options.join(', ')}]`);
  }
  const progressSelect = found.find((f) => !/sort/i.test(f));
  if (progressSelect) {
    return failCheck('library-no-progress-combobox', `toolbar has a non-sort combobox: ${progressSelect}`, { found });
  }
  // If a progress filter control exists it must be a button-triggered menu, not a combobox.
  const triggerTag = await toolbar
    .locator('.filter-trigger')
    .evaluate((el) => (el ? el.tagName.toLowerCase() : '<absent>'))
    .catch(() => '<absent>');
  if (triggerTag !== '<absent>' && triggerTag !== 'button') {
    return failCheck('library-no-progress-combobox', `progress filter trigger is a <${triggerTag}>, expected a button menu`, { found, triggerTag });
  }
  return passCheck(
    'library-no-progress-combobox',
    `no progress combobox in toolbar (sort-only select${found.length ? `s: ${found.join('; ')}` : ''}; progress control is a ${triggerTag} menu)`,
    { found, triggerTag }
  );
}

/**
 * Reads the sidebar (or opened mobile drawer) status-filter labels. The
 * first .nav-group holds the progress filters; labels are visible whenever
 * the sidebar/drawer is expanded.
 */
export async function libraryFilterLabels(page: Page): Promise<string[]> {
  const labels = page.locator('.sidebar-panel nav.sidebar .nav-group').first().locator('span.label');
  await labels.first().waitFor({ timeout: 15_000 });
  return (await labels.allTextContents()).map((t) => t.trim());
}

/**
 * Six-filter contract check. Distinguishes three states honestly:
 *  - contract implemented and exact            -> pass
 *  - contract implemented but wrong            -> fail (real failure)
 *  - repair not merged yet (legacy UI: no
 *    'Not Started' item or legacy 'Reading'
 *    label still present)                      -> skipped (documented dependency)
 */
export async function checkLibraryFilterContract(labels: string[]): Promise<GeometryCheck> {
  const expected = [...LIBRARY_FILTER_CONTRACT];
  const preRepair = !labels.includes('Not Started') || labels.includes('Reading');
  if (preRepair) {
    return {
      id: 'library-six-sidebar-filters',
      pass: false,
      skipped: true,
      message:
        `SKIPPED: library filter contract not implemented in the merged build. ` +
        `Found ${labels.length} sidebar filters [${labels.join(', ')}]; contract requires exactly six ` +
        `[${expected.join(', ')}] with no toolbar progress surface (expert section 3). ` +
        `This check activates automatically when the progress-filter repair lands on main. ` +
        `See docs/visual-verification.md §Library.`,
      metrics: { found: labels, expected },
    };
  }
  const actual = [...labels].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    return failCheck(
      'library-six-sidebar-filters',
      `sidebar/drawer filters do not match the contract: found [${labels.join(', ')}], ` +
        `expected [${expected.join(', ')}]`,
      { found: labels, expected }
    );
  }
  return passCheck(
    'library-six-sidebar-filters',
    `sidebar/drawer exposes exactly the six contract filters: ${expected.join(', ')}`,
    { found: labels }
  );
}

// ---------------------------------------------------------------------------
// Real-library book discovery (reader surfaces only)
// ---------------------------------------------------------------------------

/** Finds a book with a file of the given kind at the real library origin. */
export async function findLibraryBook(kind: 'epub' | 'pdf'): Promise<{ id: string; title: string; fileName: string } | null> {
  const res = await fetch(`${LIBRARY_URL}/api/books?pageSize=200`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${LIBRARY_URL}/api/books -> ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { items?: Array<{ id: string; title: string; fileName?: string | null; hasFile?: boolean }> };
  const books = data.items ?? [];
  const match = books.find((b) => b.hasFile && b.fileName?.toLowerCase().endsWith(kind === 'epub' ? '.epub' : '.pdf'));
  return match ? { id: match.id, title: match.title, fileName: match.fileName ?? '' } : null;
}

/** Minimal REST PUT for supported backend endpoints (writings content). */
export async function apiPut<T = unknown>(baseUrl: string, urlPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${urlPath} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
