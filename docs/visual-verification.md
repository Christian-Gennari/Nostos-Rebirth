# Visual Verification — Standing PR Gate

Every PR that changes rendered UI (reader, writing studio, library, layout,
or any component visible to the user) must pass the visual-verification
protocol below **before merge**. This is the mechanical, executable form of the
mandatory protocol from the UI defect-remediation plan (expert section 4).

The app ships exactly **one light rendering** — the theme system was removed.
The visual matrix is therefore fixed-light: 15 images, no theme
parameterization, no theme-toggle interaction, and the EPUB/PDF reader checks
are hardcoded **fixed rendering invariants** (see below).

The harness lives in `Nostos.Frontend/e2e/`:

| File | Role |
| --- | --- |
| `visual-regression.spec.ts` | The 15-image fixed-light matrix: parameterized `capture(surface, viewport, state)` -> PNG + geometry JSON |
| `support/visual-capture.ts` | Reusable capture/geometry helpers (fixed light invariants, viewport contexts, artifact paths, checks) |
| `visual-evidence/*.png` | Committed evidence artifacts (exact protocol filenames) |
| `visual-evidence/*.json` | Per-capture geometry report: checks, metrics, pass/skip/fail |

## The 15-image matrix

Viewports are **exactly** `1440x900` (desktop) and `390x844` (mobile);
PNGs are captured at `deviceScaleFactor: 1` so artifact pixels are exact.

| # | Artifact | Surface | Viewport | State |
| --- | --- | --- | --- | --- |
| 1 | `epub-light-desktop.png` | EPUB reader | 1440x900 | fixed light, initial |
| 2 | `epub-light-mobile.png` | EPUB reader | 390x844 | fixed light, initial |
| 3 | `pdf-light-desktop.png` | PDF reader | 1440x900 | final page bottom |
| 4 | `pdf-light-mobile-bottom.png` | PDF reader | 390x844 | final page bottom |
| 5 | `studio-document-desktop.png` | Writing Studio | 1440x900 | document open |
| 6 | `studio-zen-desktop.png` | Writing Studio | 1440x900 | zen |
| 7 | `studio-zen-mobile.png` | Writing Studio | 390x844 | zen |
| 8 | `studio-empty-desktop.png` | Writing Studio | 1440x900 | no document |
| 9 | `library-filters-desktop.png` | Library | 1440x900 | sidebar + toolbar |
| 10 | `library-filters-mobile.png` | Library | 390x844 | drawer open |
| 11 | `brain-empty-desktop.png` | Second Brain | 1440x900 | no concepts, `[[ ]]` empty state |
| 12 | `brain-index-desktop.png` | Second Brain | 1440x900 | seeded concept index, list view |
| 13 | `brain-index-mobile.png` | Second Brain | 390x844 | seeded concept index, list view |
| 14 | `brain-concept-desktop.png` | Second Brain | 1440x900 | selected concept, notes grid |
| 15 | `brain-map-desktop.png` | Second Brain | 1440x900 | co-occurrence graph |

The first ten rows preserve the honest 14 → 10 reduction: the four redundant desktop dark/sepia
reader captures are gone and the two mobile reader geometries formerly
covered only in dark mode are captured in the app's single light rendering.

### Book detail (real-library only)

Two further artifacts cover the book detail page's cover-derived background
wash. They are real-library-only for the same reason the reader surfaces are:
the echo is derived from the book's own cover art, and the isolated fixture has
no covers.

| Artifact | Surface | Viewport | State |
| --- | --- | --- | --- |
| `book-detail-hero-desktop.png` | Book detail | 1440x900 | cover echo present |
| `book-detail-hero-mobile.png` | Book detail | 390x844 | cover echo present |

## How to run

Default run (isolated fixture — no book assets needed):

```sh
cd Nostos.Frontend
npm run e2e          # builds backend + frontend, boots temp-SQLite fixture, runs everything
```

This captures images 5–15 (studio + library + Second Brain, fixture-served) and **skips**
images 1–4 with a documented message: the isolated fixture has no EPUB/PDF
book files and the harness never invents assets.

Full 15-image run against a real library (reader surfaces need real books):

```sh
cd Nostos.Frontend
VISUAL_QA_LIBRARY_URL=https://your-instance npm run e2e
```

`VISUAL_QA_LIBRARY_URL` must point at an instance that (a) serves the
**build under test** (the branch's own build output) and (b) has at
least one EPUB and one PDF book with files in the library. The harness
discovers them via `/api/books` and skips any missing surface with a clear
message. The established local recipe is the dev build proxied to the real
backend: a temp `src/proxy.local.json` pointing `/api` at the running backend
plus `npx ng serve --port <fresh-port> --proxy-config src/proxy.local.json`,
then `VISUAL_QA_LIBRARY_URL=http://localhost:<fresh-port> npm run e2e`
(delete the temp proxy file afterwards).

Book detail only (needs a book with cover art):

```sh
cd Nostos.Frontend
VISUAL_QA_LIBRARY_URL=http://localhost:4310 npm run e2e -- book-detail-visual.spec.ts
```

`book-detail-visual.spec.ts` captures both viewports from one spec (via
`newCapturePage`'s own contexts), so it runs in the desktop project only — its
file name deliberately avoids the `mobile*.spec.ts` pattern the desktop project
ignores. Without `VISUAL_QA_LIBRARY_URL` both cases skip with a documented reason.

## Second Brain feature contract

The Second Brain indexes concept references written as `[[Name]]` in note
content. Saving a note creates any referenced concepts and refreshes its note
links; the hourly cleanup worker deletes concepts with zero note links, so a
concept with no references is expected to disappear.

The surface has three views: the index lists, searches, sorts and counts
concepts; the detail pane filters and sorts linked notes and shows related
concepts; and the map renders co-occurring concepts as an SVG graph. Index
sort and list/map view persist under `nostos.brain.indexSort` and
`nostos.brain.viewMode` respectively.

Management actions have narrow, deliberate semantics:

- Rename changes the concept name. If that name already exists, the two
  concepts are merged; note text is not rewritten, so saving an old `[[Name]]`
  reference can recreate it.
- Merge moves unique note links from the source to the selected target and
  deletes the source concept. Note text is unchanged.
- Delete removes the concept and its note links but does not edit note text;
  saving a note containing the reference can recreate the concept.
- Note edit updates note content and re-processes its concept links. Note
  delete permanently removes the note and its links after confirmation.

## Automated geometry checks (run on every capture)

| Check | Applies to | Pass criterion |
| --- | --- | --- |
| `epub-iframe-light` | EPUB captures | iframe `body`/`html` background+foreground equal the fixed light constants; `#epub-viewer` shell surface matches the same light surface (no pale rim) |
| `pdf-scrollport-clearance` | PDF captures | scrolled to final page bottom, `#viewerContainer` bottom is at/above `header.reader-toolbar` top (toolbar covers no content) |
| `zen-fills-viewport` | zen captures | `.studio-layout` equals the viewport size |
| `zen-chrome-hidden` | zen captures | sidebars, editor header/status, TinyMCE menubar + formatting toolbar all `display:none` |
| `zen-gutters-balanced` | zen captures | editor surface horizontally centered: left/right gutters within 3px |
| `library-no-progress-combobox` | library captures | toolbar progress filter is not a `<select>`; the only toolbar select is sort |
| `library-six-sidebar-filters` | library captures | sidebar/drawer exposes exactly: All Books, Not Started, In Progress, Favorites, Finished, Unsorted — and no toolbar progress surface |
| `brain-no-arrival-animation` | selected Brain concept capture | detail pane has no `.wait-field`, no `is-waiting` class, `.concept-header`/`.note-card` computed `animation-name: none`, and no running animation targets in the pane |
| `brain-layout-overflow` | Brain captures | desktop index/detail tracks stay within the grid and the 390px surface has no horizontal overflow |
| `brain-map-geometry` | Brain map capture | SVG node count matches the concept badge and every node radius stays within the documented 14–34px bounds |
| `brain-empty-state` | Brain empty capture | the fixture-served `[[Concept Name]]` empty state is visible and the concept list has no rows |
| `book-detail-hero` | book detail captures | the hero band spans the scroll container's full width (±2px) and is ≥260px tall; both decorative art layers are real `<img>`s that actually loaded (never a stripped `[style.background-image]`); the hero copy's last line ends above the sharp cover's top edge (a negative-margin overhang must never paint over the author line); `.book-title` owns its own pixel; no horizontal overflow |
| `book-detail-fade` | book detail captures | the hero's fade into the page is a smooth **ease-in-out from its own gradient stops**: the scrim releases monotonically downward (it must never strengthen in the region the fade has to lighten) and the fade's per-segment slope rises then falls, with both end segments ≤ half the peak slope (a steeper end draws a visible onset/stop line across the band). The stops are a smoothstep in **lightness**, not in alpha — compositing a light fade over dark art is non-linear, so an alpha smoothstep comes out front-loaded. Measure it with `npm run profile:fade -- --url <book-detail-url>`, which reports the ramp in OKLab L plus the deviation from a true smoothstep; the guard above only protects the *shape*, so a front-loading regression has to be caught by that profiler |

Every check is recorded in the capture's `.json` report with its
metrics. **Skips are never failures and never fakes**: a check is skipped only
when a documented dependency is absent (see below).

### Documented skips

1. **Reader surfaces (images 1–4)** skip in the default run: no EPUB/PDF test
   assets exist in-repo and they are never invented. Run with
   `VISUAL_QA_LIBRARY_URL` to capture them. The committed reader PNGs are
   regenerated only in real-library mode.
2. **EPUB highlights**: the app has no programmatic highlight-placement API —
   highlights require real user selection inside a book, which the harness
   cannot synthesize. The screenshot documents the fixed-light reader;
   highlight visuals are covered by the vision review step when a real
   library is used.
3. **`library-six-sidebar-filters`** skips while the progress-filter repair
   (expert section 3) is not merged into main: the current merged UI still has
   the toolbar progress dropdown and five sidebar filters. The check activates
   automatically when the repair lands — no harness change needed. Until then
   the capture still runs (evidence of the current state) and the report marks
   the check `skipped` with the exact reason.

## Fixed rendering invariants

The reader's light appearance is not a selectable state — it is the only
rendering. Two invariants are asserted by the harness and must not regress:

- **EPUB iframe normalization** is a fixed publisher-CSS override registered
  once per rendition (`epub-reader.component.ts` `NOSTOS_LIGHT_RULES`):
  iframe background `#ffffff`, foreground `#1a1a1a`, links and selection
  styled, publisher backgrounds/heading colors suppressed.
- **PDF light surround** is a fixed constant: the viewer canvas surround stays
  `#fefeff` with the base light page outline/shadow (never the library's gray
  default), and the shell toolbar never covers the final page.

`support/visual-capture.ts` mirrors these constants (`READER_IFRAME_LIGHT`,
`READER_SHELL_LIGHT`). If the app tokens change, update the constants and this
section **in the same PR** — a stale constant table is a false FAIL.

## Vision review (mandatory, human or vision-model)

Screenshots plus geometry are the gate; pixel-diff snapshots are not. For
each PNG, record PASS/FAIL against the expert vision criteria:

- EPUB iframe renders the fixed light normalization (no publisher
  background/heading bleed, no pale iframe rim or first-section white flash).
- PDF page boundary is visible; the surround is the fixed light color and PDF
  colors/images are not inverted or corrupted.
- Bottom toolbar covers no document content.
- Zen fills the viewport.
- Zen prose has balanced left/right margins; no empty right half.
- No detached control strip remains.
- Mobile dock overlays neither zen nor reader content.
- Exactly one progress-filter surface is visible.
- No clipping, horizontal overflow, illegible contrast, or overlapping controls.
- Second Brain: the index, selected concept notes, map nodes and empty state are legible at their named viewports; the detail pane swaps without a covering flash or entrance animation; the map has no clipped nodes or non-tappable node sizes.
- The reader shell has no theme controls and no second toolbar row on mobile.
- Book detail: the cover wash has **no visible edge, seam, rectangle, band or
  corner** where it stops — it must fade smoothly into the paper background on
  every side. A straight boundary is a FAIL even if subtle (this shipped three
  times as "a weird square in the upper left").
- Book detail: the wash sits **behind** the cover and title and reads as derived
  from that cover's own art; the cover stays the clear focal point and text
  remains the most legible element. If the wash competes with either, lower its
  opacity rather than removing the check.

Verdicts must be attached to the PR alongside the artifact names (e.g.
"PASS 15/15 — `brain-concept-desktop.png` verified against criterion list").
**Any unexplained FAIL blocks merge.**

## Human-override rule

A FAIL may be overridden only by an explicit human decision that states why
the visible result is intentional (e.g. a deliberate layout change that the
PR describes). The override must name the artifact and the criterion it
waives. Silent or unexplained failures never merge.

## PR checklist (copy into every UI PR description)

- [ ] `npx ng test --watch=false` green, no reduced test count
- [ ] `npm run e2e` green (existing specs + visual matrix; skips documented)
- [ ] `npx ng build` green
- [ ] 15-image matrix captured from the branch's actual build
      (real-library run for images 1–4)
- [ ] Geometry reports: no failed checks; skips documented
- [ ] Vision review recorded per artifact (PASS/FAIL + artifact names)
- [ ] No unexplained FAIL; human overrides explicitly explained
- [ ] `git diff --check` clean
