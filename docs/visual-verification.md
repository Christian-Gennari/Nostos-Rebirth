# Visual Verification — Standing PR Gate

Every PR that changes rendered UI (reader, writing studio, library, layout,
or any component visible to the user) must pass the visual-verification
protocol below **before merge**. This is the mechanical, executable form of the
mandatory protocol from the UI defect-remediation plan (expert section 4).

The app ships exactly **one light rendering** — the theme system was removed.
The visual matrix is therefore fixed-light: 10 images, no theme
parameterization, no theme-toggle interaction, and the EPUB/PDF reader checks
are hardcoded **fixed rendering invariants** (see below).

The harness lives in `Nostos.Frontend/e2e/`:

| File | Role |
| --- | --- |
| `visual-regression.spec.ts` | The 10-image fixed-light matrix: parameterized `capture(surface, viewport, state)` -> PNG + geometry JSON |
| `support/visual-capture.ts` | Reusable capture/geometry helpers (fixed light invariants, viewport contexts, artifact paths, checks) |
| `visual-evidence/*.png` | Committed evidence artifacts (exact protocol filenames) |
| `visual-evidence/*.json` | Per-capture geometry report: checks, metrics, pass/skip/fail |

## The 10-image matrix

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

This is the honest 14 → 10 reduction: the four redundant desktop dark/sepia
reader captures are gone and the two mobile reader geometries formerly
covered only in dark mode are captured in the app's single light rendering.

## How to run

Default run (isolated fixture — no book assets needed):

```sh
cd Nostos.Frontend
npm run e2e          # builds backend + frontend, boots temp-SQLite fixture, runs everything
```

This captures images 5–10 (studio + library, fixture-served) and **skips**
images 1–4 with a documented message: the isolated fixture has no EPUB/PDF
book files and the harness never invents assets.

Full 10-image run against a real library (reader surfaces need real books):

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
- The reader shell has no theme controls and no second toolbar row on mobile.

Verdicts must be attached to the PR alongside the artifact names (e.g.
"PASS 10/10 — `epub-light-mobile.png` verified against criterion list").
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
- [ ] 10-image matrix captured from the branch's actual build
      (real-library run for images 1–4)
- [ ] Geometry reports: no failed checks; skips documented
- [ ] Vision review recorded per artifact (PASS/FAIL + artifact names)
- [ ] No unexplained FAIL; human overrides explicitly explained
- [ ] `git diff --check` clean
