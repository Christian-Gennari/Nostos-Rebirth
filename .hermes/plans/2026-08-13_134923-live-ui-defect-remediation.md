# Live UI Defect Remediation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Correct the three production-visible UI regressions and make screenshot capture plus vision review a mandatory merge gate for Nostos UI work.

**Architecture:** EPUB themes propagate through epub.js rendition themes; PDFs use a themed viewing surface while preserving authored page pixels; Writing Studio zen becomes a one-track viewport layout with a centered prose measure; progress filtering returns to the sidebar as its single home. Unit/component tests protect state and wiring, while production-build screenshots and vision review protect appearance.

**Tech Stack:** Angular 21 standalone components and signals, epub.js, pdf.js through ngx-extended-pdf-viewer, TinyMCE, Vitest through the Angular test builder, Playwright/headless Chromium.

---

## 1. Reader theme propagation

### 1.1 EPUB design

Use epub.js `rendition.themes`, not annotation-manager style injection.

Reasons:
- The book is rendered in epub.js-managed iframe documents, outside the shell's CSS cascade.
- `rendition.themes` is the supported lifecycle-aware API and applies to current and subsequently rendered sections.
- `epub-annotation-manager.ts` should remain responsible for annotation and selection styling. Mixing reading-theme ownership into it would couple unrelated concerns and risk overwriting highlight rules.

Behavior:
- Define three named rendition themes: `nostos-light`, `nostos-dark`, and `nostos-sepia`.
- Each theme sets both `html` and `body` background/color, link color, selection color, and sensible image treatment. Use `!important` only for background and foreground rules necessary to defeat publisher CSS.
- Do not replace typography, margins, emphasis, illustrations, or layout from the EPUB. Nostos owns the reading surface colors, not the publication design.
- Register themes once per rendition. Select the current theme after rendition creation and before/at first display.
- Inject `ThemeService` into `EpubReaderComponent`. Add an Angular `effect` that reads `themeService.theme()` and reselects the matching rendition theme whenever the user toggles mid-session. Because rendition assignment is not itself a signal, also call the same `applyReadingTheme()` immediately after creating the rendition and before/after initial `display()` as required by epub.js lifecycle.
- Reapply to `rendition.getContents()` after selection as a defensive pass for the current iframe, but do not move theme ownership into the annotation contents registry.
- Theme the outer `#epub-viewer` and its loading/empty canvas from existing CSS variables so no light flash or pale gutter appears around the iframe.
- Preserve the existing requirement that `EpubAnnotationManager` is constructed before `rendition.display()`; do not regress first-section annotation styling.

Theme behavior:
- Light: light Nostos body/surface and dark text.
- Dark: dark body/surface, light text, links/highlights adjusted for contrast. Images remain uninverted.
- Sepia: sepia paper and dark brown text. Images remain authored.

Responsive behavior:
- Desktop and mobile use the same iframe theme selection.
- Mobile keeps current pagination, selection, and annotation behavior; only viewport padding/gutters use themed variables.

Files:
- Modify `Nostos.Frontend/src/app/reader/epub-reader/epub-reader.component.ts`
- Modify `Nostos.Frontend/src/app/reader/epub-reader/epub-reader.component.css`
- Modify `Nostos.Frontend/src/app/reader/epub-reader/epub-reader.component.spec.ts`
- Do not modify `Nostos.Frontend/src/app/reader/epub-reader/epub-annotation-manager.ts` unless a failing integration test proves a contents lifecycle gap.

Component/spec coverage:
1. Initial light/dark/sepia theme selects the matching rendition theme.
2. Toggling light → dark → sepia after display reselects without recreating the rendition or losing location.
3. A section rendered after a theme switch inherits the selected theme.
4. Theme application does not remove annotation/highlight styles.
5. Destroying/reopening the reader does not retain a stale rendition or duplicate effects.

### 1.2 PDF design

Do not use CSS `invert()`/`hue-rotate()` on PDF canvases.

Decision:
- Theme the viewer canvas/surround and page boundary in all three themes.
- Preserve the PDF page pixels as authored. A white page may remain white, but it must sit on a clearly dark/sepia canvas with a visible edge and shadow.
- Do not claim that dark mode recolors arbitrary PDFs. Inverting canvases damages photographs, diagrams, cover art, colored annotations, and highlight semantics. Brightness/contrast filters are less destructive than inversion but still alter every image and can weaken fine text; they should not be automatic.
- If glare remains unacceptable after visual review, treat optional per-reader “Dim PDF pages” as a separate feature. It is not part of this repair.

Mechanism:
- Inject `ThemeService` into `PdfReaderComponent` and expose computed viewer background/page-edge values derived from existing theme tokens.
- Replace the hard-coded `'#fefeff'` `[backgroundColor]` binding with a computed/token-backed value.
- Keep `pdfBackgroundColor` unset/default so opaque authored page backgrounds are preserved. Do not use it as proof of recoloring: many PDFs paint an opaque white page rectangle.
- Add a theme-specific page outline and shadow around `.page` so white page edges remain visible on light canvas and are unmistakable on dark/sepia canvas.
- Ensure loading and empty states inherit the reader surface.

Toolbar overlap:
- Remove the `#mainContainer.toolbar-hidden { margin-top: -34px }` negative-margin workaround.
- Reset the hidden internal PDF-toolbar offset at the actual scroll container (`#viewerContainer { top: 0; bottom: 0; }`, scoped to the toolbar-hidden state only after confirming the library's emitted DOM/class).
- The PDF reader must fill only the shell's content grid row. The shell bottom toolbar occupies its own row; it must never overlay the PDF scrollport.
- Add `scroll-padding-bottom` equal to the reader toolbar plus safe-area inset as a secondary navigation safeguard, not as a substitute for correct grid sizing.

Theme behavior:
- Light: neutral canvas, white authored pages, visible subtle edge.
- Dark: charcoal canvas, authored pages unchanged, high-contrast page edge/shadow; no inverted text/images.
- Sepia: sepia canvas, authored pages unchanged, warm page edge/shadow.

Responsive behavior:
- Desktop and mobile preserve the same page fidelity.
- At 390×844, the final page can scroll fully above the shell toolbar and bottom safe area.

Files:
- Modify `Nostos.Frontend/src/app/reader/pdf-reader/pdf-reader.component.ts`
- Modify `Nostos.Frontend/src/app/reader/pdf-reader/pdf-reader.component.html`
- Modify `Nostos.Frontend/src/app/reader/pdf-reader/pdf-reader.component.css`
- Create `Nostos.Frontend/src/app/reader/pdf-reader/pdf-reader.component.spec.ts`
- Modify `Nostos.Frontend/src/app/reader/reader-shell.component.css` only if measured grid geometry proves the overlap originates in the shell; keep ownership in the reader first.

Component/spec coverage:
1. Hard-coded `#fefeff` is gone; light/dark/sepia viewer backgrounds follow theme state.
2. Theme switching updates the viewer without reloading the PDF.
3. No canvas filter/inversion is applied in any theme.
4. Internal-toolbar-hidden mode has no negative margin.
5. Desktop and mobile layout tests assert the PDF host/scrollport ends above the shell toolbar.

## 2. Writing Studio zen mode

### 2.1 Toggle placement

- Zen is only meaningful with an active document, so do not show it on an empty studio.
- Remove the thin standalone `editor-header` presentation that makes the button look detached.
- Put the normal zen entry button in the document action cluster aligned to the editor pane's upper-right, beside other document-level actions rather than beside the tiny save label.
- Move save state to the existing status area near word count/document metadata. It should not justify a full-width strip.
- In zen, render a subdued fixed “Exit zen” button at the top-right with an accessible label and visible keyboard focus. `Escape` remains the primary quick exit, but the mode must never trap pointer-only users.

Files:
- Modify `Nostos.Frontend/src/app/writing-studio/writing-studio.component.html`
- Modify `Nostos.Frontend/src/app/writing-studio/writing-studio.component.css`
- Modify `Nostos.Frontend/src/app/writing-studio/writing-studio.component.ts` only for focus restoration or explicit zen state handling.
- Modify `Nostos.Frontend/src/app/writing-studio/writing-studio.component.spec.ts`
- Modify `Nostos.Frontend/src/app/writing-studio/markdown-editor/markdown-editor.component.{ts,html,css}` only if an explicit input is needed to hide TinyMCE chrome while preserving its editing iframe.

### 2.2 Immersive layout

- In zen, change `.studio-layout` to a single `1fr` column. Hiding the two `auto` grid items is insufficient and is the root cause of the left-aligned 740px layout.
- Fix the studio host to `inset: 0`, `width: 100vw`, and `height: 100dvh` above the application shell.
- Hide both sidebars, the application dock, the studio menu bar, the document action/header strip, and TinyMCE's formatting toolbar/menubar.
- Keep editing commands available through keyboard shortcuts. The visible exit control is the only persistent chrome.
- Center the editor at a readable prose measure: wrapper width `100%`; editing surface `min(100%, 860px)` with auto inline margins and responsive padding. Do not stretch prose across the viewport.
- Use one scroll owner: the TinyMCE/editor content surface. The fixed studio host and outer editor pane must not independently scroll. Preserve the scroll position when entering/exiting zen.
- Restore focus to the zen entry button (or the editor if the entry button is conditionally removed) on exit.

Mobile:
- Use `100dvh` and safe-area insets.
- Keep the fixed bottom app dock hidden for the entire zen state.
- Editor width is `100%` minus mobile padding; no artificial desktop max-width gutter.
- Hide menus/toolbars as on desktop. Do not treat responsive sidebar hiding as zen completion.

Tests:
1. Zen is absent with no active document and present with an active document.
2. Enter sets `body.nostos-zen`; Escape/exit clears it and restores focus.
3. Computed zen grid has one track and editor pane spans viewport width.
4. Editing surface is centered and capped at readable measure on desktop, full-width with padding on mobile.
5. Sidebars, app dock, studio menu, formatting toolbar, and detached header are hidden.
6. Exactly one scroll container remains; scroll position survives round trip.
7. Component destruction always removes `body.nostos-zen`.

## 3. Progress filter: one home

Decision: restore the sidebar as the single home for status/progress filtering.

Reasons:
- It matches the established information architecture Christian explicitly preferred.
- A dropdown in the crowded top toolbar duplicates navigation and overlays the grid when open.
- On mobile, the sidebar already has a drawer/toggle; filters remain reachable there without permanently consuming toolbar width.

Behavior:
- Remove the progress dropdown from `library.component.html` and its presentation CSS.
- Keep URL ownership through the existing `filter` query parameter.
- Extend the sidebar list to: All Books, Not Started, In Progress, Favorites, Finished, Unsorted.
- Rename “Reading” to “In Progress” while retaining the existing `reading` URL/backend enum value. Do not introduce a second semantic value.
- Use `queryParamsHandling="merge"` consistently so changing status does not accidentally discard collection/search state unless product rules explicitly require clearing a mutually exclusive collection selection.
- Highlight the active status from the URL; browser back/forward must restore it.
- Mobile sidebar toggle/drawer must expose the same list and close after selection, returning focus to the opener.

Files:
- Modify `Nostos.Frontend/src/app/library/library.component.html`
- Modify `Nostos.Frontend/src/app/library/library.component.ts` to remove dropdown-only handlers/state if now unused.
- Modify `Nostos.Frontend/src/app/library/library.component.css`
- Modify `Nostos.Frontend/src/app/library/library.component.spec.ts`
- Modify `Nostos.Frontend/src/app/library/sidebar-collections/sidebar-collections.component.html`
- Modify `Nostos.Frontend/src/app/library/sidebar-collections/sidebar-collections.component.ts` only if active-query/mobile-close logic is not already present.
- Modify `Nostos.Frontend/src/app/library/sidebar-collections/sidebar-collections.component.css`
- Modify `Nostos.Frontend/src/app/library/sidebar-collections/sidebar-collections.component.spec.ts`

Tests:
1. Toolbar contains no progress/status dropdown.
2. Sidebar renders exactly the six status choices above; “Reading” is not visible.
3. Each item writes the canonical `filter` value; In Progress writes `reading`.
4. Not Started writes `notstarted`.
5. Active state follows initial URL and back/forward URL changes.
6. Query-parameter merge behavior is explicit and tested.
7. Mobile drawer exposes every filter, closes after selection, and restores focus.

## 4. Mandatory visual verification protocol

This is a hard merge requirement for every PR that changes HTML, CSS, design tokens, responsive behavior, or a component affecting rendered UI. Unit tests alone cannot satisfy it.

### 4.1 Required execution

1. Build the production frontend, not only the development bundle.
2. Run the affected route against the real application or the production-like Playwright fixture with stable seeded content.
3. Capture Chromium screenshots at exactly 1440×900 and 390×844.
4. Capture both the normal state and every changed interactive state: menus open, zen active, reader at first/prose/final page, mobile drawer open, etc.
5. Run a vision-model review on the actual PNGs using the acceptance checklist. The reviewer must return PASS/FAIL per image and cite the visible region for every failure.
6. Put screenshot artifact names and the vision verdict in the PR description/check. Any unexplained FAIL blocks merge.
7. A human may override a false positive, but the override must state why the visible result is intentional. Do not silently waive it.

Use semantic screenshot assertions for geometry and state. Avoid broad pixel baselines as the sole gate because font antialiasing and canvas rendering create noise. Keep screenshots as CI artifacts, not source-controlled binaries.

### 4.2 Screenshot matrix for this remediation

Reader EPUB:
- `epub-light-desktop.png`: prose page, shell and iframe coherent.
- `epub-dark-desktop.png`: prose page after an in-session theme toggle.
- `epub-sepia-desktop.png`: prose page after another in-session toggle.
- `epub-dark-mobile.png`: prose page with annotation/highlight visible.

Reader PDF:
- `pdf-light-desktop.png`: page edge visible on canvas.
- `pdf-dark-desktop.png`: dark surround, faithful page colors, unmistakable page edge.
- `pdf-sepia-desktop.png`: sepia surround, faithful page colors.
- `pdf-dark-mobile-bottom.png`: scrolled to final page bottom; all content clears toolbar/safe area.

Writing Studio:
- `studio-document-desktop.png`: normal mode; zen control belongs to document action cluster, no empty strip.
- `studio-zen-desktop.png`: centered readable column, no sidebars/dock/menu/format toolbar, no empty right half.
- `studio-zen-mobile.png`: full mobile viewport, no bottom-dock overlay, exit reachable.
- `studio-empty-desktop.png`: no meaningless zen control.

Library:
- `library-filters-desktop.png`: one status list in sidebar; no toolbar duplicate.
- `library-filters-mobile-open.png`: mobile drawer open with all six choices reachable.

### 4.3 Vision pass criteria

Every image must pass all applicable checks:
- No unintended white/cream region outside authored PDF pages.
- EPUB reading background and text visibly match the selected shell theme; no iframe rim or first-section flash is captured.
- PDF pages are not inverted or color-corrupted; page boundaries remain visible.
- Reader toolbar does not cover content at the bottom.
- Zen occupies the viewport, has balanced left/right margins, one readable centered column, one scroll owner, and a reachable exit.
- No detached or apparently random control strip remains.
- Mobile app dock does not overlay zen or reader content.
- Exactly one progress-filter surface is visible at a time; mobile access is obvious.
- No clipping, accidental horizontal scroll, overlapping controls, illegible contrast, missing focus indicator, or layout shift.

### 4.4 Going-forward PR checklist

For every UI PR, require:
- [ ] Impacted routes/states listed.
- [ ] 1440×900 screenshot for each changed state.
- [ ] 390×844 screenshot for each changed state.
- [ ] All affected themes captured; if theme-independent, all three still smoke-checked.
- [ ] Keyboard/focus state checked.
- [ ] Content-overflow/long-content state checked.
- [ ] Vision review attached with per-image PASS/FAIL.
- [ ] Human review of vision failures/ambiguities recorded.
- [ ] Production build, Angular tests, and relevant Playwright tests green.

## 5. Test and verification commands

From `Nostos.Frontend/`:

```bash
npx ng test --watch=false
npx ng build
npm run e2e
```

Do not run raw `vitest`; the repository relies on the Angular test builder to configure Vitest globals.

Add/extend Playwright coverage under:
- `Nostos.Frontend/e2e/visual-regression.spec.ts` for deterministic screenshot capture and geometry assertions.
- Reuse existing e2e fixture/seed helpers; seed one representative EPUB, one PDF containing text plus color imagery, and one long Writing Studio document.

Automated geometry assertions:
- EPUB iframe body computed foreground/background equals expected theme tokens.
- PDF page/scrollport bottom is above the shell toolbar bounding box.
- Zen editor pane spans viewport; centered editor left/right gutters differ by no more than a small tolerance.
- App dock and hidden chrome have `display:none` in zen.
- Library toolbar has no progress combobox; desktop sidebar/mobile drawer has six filter links.

## 6. Parallel worktree ordering (maximum two workers)

### Batch 1 — run two workers in parallel

Worker A: reader themes and PDF overlap
- Owns `reader/epub-reader/**`, `reader/pdf-reader/**`.
- May touch `reader/reader-shell.component.css` only after documenting measured need.
- Branch/PR: one reader-correction issue branch.

Worker B: Writing Studio zen
- Owns `writing-studio/**` and, only if unavoidable, the existing global `body.nostos-zen app-app-dock` rule.
- Branch/PR: one zen-correction issue branch.

Conflict rule:
- Worker A must not touch Writing Studio files.
- Worker B must not touch reader files.
- Avoid global `styles.css` changes where component-scoped rules suffice. If Worker B must touch it, Worker A may not.

After both branches pass component tests and their own screenshot/vision checks, merge them sequentially into main and refresh main before Batch 2.

### Batch 2 — filter implementation plus verification infrastructure

Worker A: filter single-home correction
- Owns `library/library.component.*` and `library/sidebar-collections/**`.

Worker B: visual QA harness/protocol
- Owns `Nostos.Frontend/e2e/visual-regression.spec.ts`, reusable e2e screenshot helpers, and the PR checklist/documentation location selected by the repository.
- Must not modify library/reader/studio implementation files.
- Base this worktree on main containing Batch 1 so selectors and screenshots describe shipped layout.

After the filter branch lands, rebase/refresh the visual-QA branch and run the complete 14-image matrix. This final pass is serial by necessity: it verifies the integrated result, not isolated branches.

## 7. Merge acceptance

A branch is not mergeable until:
1. Production Angular build passes.
2. Full Angular test suite passes with no reduced count.
3. Relevant Playwright semantic assertions pass at desktop and mobile sizes.
4. Required PNGs were captured from the branch's actual production build.
5. Vision review returns PASS for each PNG or a documented human override exists.
6. Independent code audit verifies the branch HEAD, not an uncommitted worktree.
7. No PDF inversion/filter was introduced; no duplicate filter remains; zen has one-column grid geometry; EPUB theme changes apply without reopening the book.
