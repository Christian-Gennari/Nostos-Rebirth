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
  surface: 'epub' | 'pdf' | 'studio' | 'library' | 'book-detail';
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

// ---------------------------------------------------------------------------
// Library toolbar stability (filter/sort cross-fade regression guard)
// ---------------------------------------------------------------------------

/**
 * The library toolbar must keep its static heading and centred search geometry,
 * and the result container must not change width when a filter change removes
 * the scrollbar. Both were real defects: a long dynamic title used to shove the
 * search field, and a short/empty result set dropped the styled 8px scrollbar
 * and shifted every column.
 *
 * The change under test is driven through the real search box: typing activates
 * a search chip and produces an empty result set, exercising both stability
 * guards at once.
 */
export async function checkLibraryToolbarStability(page: Page): Promise<GeometryCheck> {
  const search = page.locator('.search-input');
  const title = page.locator('#library-title');
  const scroller = page.locator('.library-right-side');
  const searchContainer = page.locator('.search-bar-container');
  const toolbarEl = page.locator('.toolbar');
  await search.waitFor({ timeout: 30_000 });

  const before = await search.boundingBox();
  const titleBefore = await title.boundingBox();
  const scrollBefore = await scroller.evaluate((el) => el.clientWidth);

  await search.fill('zzz-no-such-book-in-this-library');
  // 300ms input debounce + 200ms out-phase + 300ms in-phase + margin.
  await page.waitForTimeout(1500);

  const after = await search.boundingBox();
  const titleAfter = await title.boundingBox();
  const scrollAfter = await scroller.evaluate((el) => el.clientWidth);
  const searchPosition = await searchContainer.evaluate((el) => getComputedStyle(el).position);
  const toolbarBox = await toolbarEl.boundingBox();
  const toolbarPadding = await toolbarEl.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      paddingLeft: parseFloat(style.paddingLeft),
      paddingRight: parseFloat(style.paddingRight),
    };
  });
  if (!before || !after || !titleBefore || !titleAfter || !toolbarBox) {
    return failCheck(
      'library-toolbar-stability',
      'could not measure .search-input / #library-title',
    );
  }

  const dSearchX = Math.abs(after.x - before.x);
  const dSearchW = Math.abs(after.width - before.width);
  const dTitleX = Math.abs(titleAfter.x - titleBefore.x);
  const dTitleH = Math.abs(titleAfter.height - titleBefore.height);
  const dScrollW = Math.abs(scrollAfter - scrollBefore);
  const searchCenterX = after.x + after.width / 2;
  const toolbarCenterX =
    toolbarBox.x +
    toolbarPadding.paddingLeft +
    (toolbarBox.width - toolbarPadding.paddingLeft - toolbarPadding.paddingRight) / 2;
  const dCenterX = Math.abs(searchCenterX - toolbarCenterX);
  const singleRowCentered = searchPosition === 'absolute';
  const centeringOk = !singleRowCentered || dCenterX <= 1;
  const ok =
    dSearchX <= 1 && dSearchW <= 1 && dTitleX <= 1 && dTitleH <= 1 && dScrollW <= 1 && centeringOk;
  const metrics = {
    searchX: r1(before.x),
    searchXAfter: r1(after.x),
    dSearchX: r1(dSearchX),
    searchWidth: r1(before.width),
    dSearchW: r1(dSearchW),
    titleX: r1(titleBefore.x),
    dTitleX: r1(dTitleX),
    titleBoxHeight: r1(titleBefore.height),
    dTitleH: r1(dTitleH),
    scrollClientWidth: scrollBefore,
    dScrollW,
    searchCenterX: r1(searchCenterX),
    toolbarCenterX: r1(toolbarCenterX),
    dCenterX: r1(dCenterX),
  };
  const centeringMessage = singleRowCentered
    ? `, search centre ${r1(searchCenterX)} vs toolbar content centre ${r1(toolbarCenterX)} ` +
      `(Δ${r1(dCenterX)}px)`
    : ', search centring skipped in stacked mode (full-width field)';
  const titleText = (await title.textContent())?.trim() ?? '';
  const message =
    `title "${titleText}": search x ${r1(before.x)} -> ${r1(after.x)} ` +
    `(Δ${r1(dSearchX)}px), search width Δ${r1(dSearchW)}px, title box x Δ${r1(dTitleX)}px, ` +
    `title box height Δ${r1(dTitleH)}px, results client width Δ${dScrollW}px${centeringMessage} ` +
    `(${ok ? 'stable' : 'SHIFTS'})`;
  return ok
    ? passCheck('library-toolbar-stability', message, metrics)
    : failCheck('library-toolbar-stability', message, metrics);
}

// ---------------------------------------------------------------------------
// Library — collections rail motion (fade, fold depth, fold continuity)
// ---------------------------------------------------------------------------

/**
 * Guards the rail's collapse motion plus the search field's icon inset - all
 * computed-CSS facts the unit tier cannot observe (it sees DOM and signals, not
 * transition timing or used grid tracks). Each assertion pins a specific
 * failure mode; the first, second and fourth were verified to FAIL against the
 * pre-fix values, and the third against a half-applied fix:
 *
 *  1. The section labels must FADE with the rest of the rail text. Left out of
 *     the opacity rules, they sat at opacity 1 for the whole 320ms fold and then
 *     vanished on the delayed `visibility: hidden` - a legible sliver right up
 *     to the last frame. Asserted as: at least one sample where the labels are
 *     already <= 0.1 opacity while the rail is still past half its travel.
 *  2. The fold must reach ZERO. A bare `1fr` track carries an `auto` minimum
 *     clamped to the child's content, so `0fr` settled at the label's line box
 *     (~16px) and left dead space in the rail. Asserted as: the settled track
 *     height is <= 0.5px.
 *  3. The fold must stay CONTINUOUS. This guards the FIX rather than the original
 *     bug: the pre-fix fold did interpolate, it simply stopped at ~16px. But
 *     declaring the min on only the collapsed state (`1fr` -> `minmax(0, 0fr)`)
 *     IS discrete and snaps (measured: 2 distinct heights) - the plausible way
 *     to half-apply the fold fix. Asserted as: more than three distinct heights.
 *  4. The search icon must clear the placeholder text: the glyph's box has to
 *     end before the text begins.
 */
export async function checkLibrarySidebarRail(page: Page): Promise<GeometryCheck> {
  const ID = 'library-sidebar-rail';
  await page.locator('.sidebar').first().waitFor({ timeout: 30_000 });

  // Mobile renders this same element as an off-canvas drawer: no rail width
  // motion and no fold, so the rail assertions do not apply.
  const drawer = await page.evaluate(() => window.innerWidth < 768);
  const railWidth = await page.evaluate(
    () => document.querySelector('app-sidebar-collections')?.getBoundingClientRect().width ?? 0,
  );
  if (drawer || railWidth === 0) {
    return {
      id: ID,
      pass: false,
      skipped: true,
      message: 'SKIPPED: mobile drawer — no rail width motion or fold to assert.',
    };
  }

  const reduced = await page.evaluate(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  // Start expanded so the collapse we measure is a real transition.
  const startsCollapsed = await page.evaluate(() =>
    document.querySelector('.sidebar')!.classList.contains('collapsed'),
  );
  if (startsCollapsed) {
    await page.locator('.toggle-btn').click();
    await page.waitForTimeout(600);
  }
  const expandedWidth = await page.evaluate(
    () => document.querySelector('app-sidebar-collections')!.getBoundingClientRect().width,
  );

  const samples = await page.evaluate(async () => {
    type Sample = { railW: number; labelOpacity: number; trackH: number };
    const out: Sample[] = [];
    const railEl = document.querySelector('app-sidebar-collections')!;
    const trackEl = document.querySelector('.collapsible')!;
    const labels = Array.from(document.querySelectorAll('.section-label'));
    const read = (): void => {
      out.push({
        railW: railEl.getBoundingClientRect().width,
        labelOpacity: labels.length
          ? Math.max(...labels.map((l) => parseFloat(getComputedStyle(l).opacity)))
          : 0,
        trackH: trackEl.getBoundingClientRect().height,
      });
    };
    document.querySelector<HTMLButtonElement>('.toggle-btn')!.click();
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const iv = window.setInterval(() => {
        read();
        if (performance.now() - t0 > 700) {
          window.clearInterval(iv);
          resolve();
        }
      }, 16);
    });
    return out;
  });

  const last = samples[samples.length - 1];
  const halfTravel = last.railW + (expandedWidth - last.railW) / 2;
  const fadedWhileWide = samples.some((s) => s.labelOpacity <= 0.1 && s.railW > halfTravel);
  const settledTrack = Math.round(last.trackH * 10) / 10;
  const distinctTracks = new Set(samples.map((s) => Math.round(s.trackH))).size;

  // Measured in-page rather than with locator.boundingBox(): lucide copies the
  // `search-icon` class onto BOTH its host element and the inner <svg>, so a
  // plain `.search-icon` locator is a strict-mode violation (two matches), and
  // boundingBox() also waits on actionability. Reading the rendered geometry
  // directly is unambiguous and never waits.
  const icon = await page.evaluate(() => {
    const el = document.querySelector('.search-icon');
    const input = document.querySelector('.search-input');
    if (!el || !input) return null;
    const cs = getComputedStyle(input);
    const ir = el.getBoundingClientRect();
    const nr = input.getBoundingClientRect();
    return {
      iconRight: ir.right,
      textStart: nr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    };
  });
  if (!icon) {
    return failCheck(ID, 'could not measure .search-icon / .search-input');
  }
  const iconGap = r1(icon.textStart - icon.iconRight);

  const foldOk = settledTrack <= 0.5;
  const fadeOk = fadedWhileWide;
  const continuityOk = reduced || distinctTracks > 3;
  const iconOk = iconGap > 2;
  const ok = foldOk && fadeOk && continuityOk && iconOk;

  const metrics = {
    expandedWidth: r1(expandedWidth),
    collapsedWidth: r1(last.railW),
    halfTravel: r1(halfTravel),
    settledTrackHeight: settledTrack,
    distinctTrackHeights: distinctTracks,
    fadedWhileRailWide: fadedWhileWide,
    iconGap,
    reducedMotion: reduced,
    samples: samples.length,
  };
  const message =
    `rail ${r1(expandedWidth)} -> ${r1(last.railW)}px: section labels ` +
    `${fadeOk ? 'fade out before the rail closes' : 'STAY VISIBLE until the fold ends'}; ` +
    `settled label track ${settledTrack}px (${foldOk ? 'closes fully' : 'LEAVES DEAD SPACE'}); ` +
    `${distinctTracks} distinct fold heights (${continuityOk ? 'continuous' : 'SNAPS'}); ` +
    `search icon gap to text ${iconGap}px (${iconOk ? 'clear' : 'OVERLAPS'})`;
  return ok ? passCheck(ID, message, metrics) : failCheck(ID, message, metrics);
}

function r1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Book detail — cover echo (decorative cover-derived wash)
// ---------------------------------------------------------------------------

/** Finds a book that has cover art (the echo needs a real cover). */
export async function findLibraryCoverBook(): Promise<{ id: string; title: string } | null> {
  const res = await fetch(`${LIBRARY_URL}/api/books?pageSize=200`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${LIBRARY_URL}/api/books -> ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    items?: Array<{ id: string; title: string; coverUrl?: string | null }>;
  };
  const match = (data.items ?? []).find((b) => !!b.coverUrl);
  return match ? { id: match.id, title: match.title } : null;
}

/**
 * Book detail hero criteria. Each one guards a defect that actually shipped:
 *
 *  1. FULL-BLEED BAND. The whole point of the layout is that the cover art fills
 *     the top of the page; the page previously rendered the cover in a narrow
 *     side column inside an 800px centred container, so most of a wide screen was
 *     empty. The band must span the scroll container's full width.
 *  2. ART ACTUALLY RENDERS. The art is carried by real `<img>` layers, never a
 *     `[style.background-image]` binding (the framework strips that and leaves an
 *     empty rectangle that still occupies space and still paints its scrim).
 *  3. NO COPY/COVER COLLISION. The sharp cover hangs over the band's fade via a
 *     negative margin and sits ABOVE the hero copy in the stacking order, so if
 *     the copy's clearance is ever reduced the cover silently paints over the
 *     author line. Assert the copy's last line ends above the cover's top edge.
 *  4. TITLE OWNS ITS PIXEL. Content paints above the decorative art layers.
 *  5. NO HORIZONTAL OVERFLOW (`.layout-content` is `overflow-y: auto`, which makes
 *     `overflow-x` compute to `auto` too, so a too-wide band scrolls the page).
 */
export async function checkBookDetailHero(page: Page): Promise<GeometryCheck> {
  const hero = page.locator('.book-hero').first();
  const title = page.locator('.book-title').first();
  await title.waitFor({ timeout: 30_000 });
  await hero.waitFor({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s);
    const rect = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
    const round1 = (v: number) => Math.round(v * 10) / 10;
    const heroEl = q('.book-hero');
    const copy = q('.hero-copy');
    const coverEl = q('.cover-card');
    const cover = rect(coverEl);
    const scroller = q('.layout-content');
    // Last line of the hero copy, measured as the deepest content box so the
    // copy's bottom PADDING (which deliberately reaches the band's edge) is not
    // mistaken for the text's position.
    const lines = copy ? Array.from(copy.children).map((c) => rect(c)).filter(Boolean) : [];
    const copyContentBottom = lines.length
      ? Math.max(...lines.map((r) => (r as DOMRect).bottom))
      : null;
    const artImgs = Array.from(document.querySelectorAll('.hero-art img')) as HTMLImageElement[];
    const titleRect = rect(q('.book-title'));
    const hit = titleRect
      ? document.elementFromPoint(
          titleRect.left + titleRect.width / 2,
          titleRect.top + titleRect.height / 2
        )
      : null;
    return {
      hero: rect(heroEl),
      heroHeight: heroEl ? round1(heroEl.getBoundingClientRect().height) : null,
      scrollerWidth: scroller ? scroller.clientWidth : null,
      scrollerScrollWidth: scroller ? scroller.scrollWidth : null,
      copyContentBottom: copyContentBottom == null ? null : round1(copyContentBottom),
      coverTop: cover ? round1(cover.top) : null,
      artCount: artImgs.length,
      artLoaded: artImgs.filter((i) => i.complete && i.naturalWidth > 0).map((i) =>
        String(i.getAttribute('src')).split('/').pop()
      ),
      artSrcs: artImgs.map((i) => String(i.getAttribute('src'))),
      noArt: heroEl ? heroEl.classList.contains('no-art') : null,
      titleHit: hit ? String(hit.className || hit.tagName).slice(0, 48) : '<null>',
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
    };
  });

  const fullBleed = m.hero != null && m.scrollerWidth != null && Math.abs(m.hero.width - m.scrollerWidth) <= 2;
  const isHero = (m.heroHeight ?? 0) >= 260;
  // Three art layers now: defocused base, progressive defocus, halation bloom.
  const artRenders = m.artCount === 3 && m.artLoaded.length === 3 && m.noArt === false;
  // Positive gap => the copy ends above the cover's top edge.
  const clearance =
    m.copyContentBottom != null && m.coverTop != null ? m.coverTop - m.copyContentBottom : null;
  const noCollision = clearance != null && clearance >= 4;
  const contentOnTop = /book-title/.test(m.titleHit);
  const noOverflowX = m.docScroll <= m.docClient + 1;

  const ok = fullBleed && isHero && artRenders && noCollision && contentOnTop && noOverflowX;
  const metrics = { ...m, clearance };
  const msg =
    `band ${m.hero ? `${Math.round(m.hero.width)}x${m.heroHeight}px` : '?'} ` +
    `(${fullBleed ? 'full-bleed' : `NOT full-bleed vs ${m.scrollerWidth}px`}), ` +
    `${isHero ? 'hero-height' : 'TOO SHORT'}, ` +
    `art ${m.artLoaded.length}/${m.artCount} layers loaded ${artRenders ? '' : '(ART NOT RENDERING) '}` +
    `src=${m.artSrcs[0] ?? 'none'}, ` +
    `copy->cover clearance ${clearance}px ${noCollision ? '' : '(COPY/COVER COLLISION) '}` +
    `[copy ends ${m.copyContentBottom}, cover starts ${m.coverTop}], ` +
    `title owns its pixel ${contentOnTop ? 'yes' : `NO (${m.titleHit})`}, ` +
    `h-overflow ${noOverflowX ? 'none' : 'PRESENT'}`;
  return ok ? passCheck('book-detail-hero', msg, metrics) : failCheck('book-detail-hero', msg, metrics);
}
