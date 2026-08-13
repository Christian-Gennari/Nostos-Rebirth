# Visual Verification — Standing PR Gate

Every PR that changes rendered UI (reader, writing studio, library, layout,
themes, or any component visible to the user) must pass the visual-verification
protocol below **before merge**. This is the mechanical, executable form of the
mandatory protocol from the UI defect-remediation plan (expert section 4).

The harness lives in `Nostos.Frontend/e2e/`:

| File | Role |
| --- | --- |
| `visual-regression.spec.ts` | The 14-image matrix: parameterized `capture(surface, viewport, theme, state)` -> PNG + geometry JSON |
| `support/visual-capture.ts` | Reusable capture/geometry helpers (theme tokens, viewport contexts, artifact paths, checks) |
| `visual-evidence/*.png` | Committed evidence artifacts (exact protocol filenames) |
| `visual-evidence/*.geometry.json` | Per-capture geometry report: checks, metrics, pass/skip/fail |

## The 14-image matrix

Viewports are **exactly** `1440x900` (desktop) and `390x844` (mobile);
PNGs are captured at `deviceScaleFactor: 1` so artifact pixels are exact.

| # | Artifact | Surface | Viewport | Theme | State |
| --- | --- | --- | --- | --- | --- |
| 1 | `epub-light-desktop.png` | EPUB reader | 1440x900 | light | initial |
| 2 | `epub-dark-desktop.png` | EPUB reader | 1440x900 | dark | after in-session toggle |
| 3 | `epub-sepia-desktop.png` | EPUB reader | 1440x900 | sepia | after in-session toggle |
| 4 | `epub-dark-mobile.png` | EPUB reader | 390x844 | dark | after in-session toggle |
| 5 | `pdf-light-desktop.png` | PDF reader | 1440x900 | light | final page bottom |
| 6 | `pdf-dark-desktop.png` | PDF reader | 1440x900 | dark | final page bottom |
| 7 | `pdf-sepia-desktop.png` | PDF reader | 1440x900 | sepia | final page bottom |
| 8 | `pdf-dark-mobile-bottom.png` | PDF reader | 390x844 | dark | final page bottom |
| 9 | `studio-document-desktop.png` | Writing Studio | 1440x900 | light | document open |
| 10 | `studio-zen-desktop.png` | Writing Studio | 1440x900 | light | zen |
| 11 | `studio-zen-mobile.png` | Writing Studio | 390x844 | light | zen |
| 12 | `studio-empty-desktop.png` | Writing Studio | 1440x900 | light | no document |
| 13 | `library-filters-desktop.png` | Library | 1440x900 | light | sidebar + toolbar |
| 14 | `library-filters-mobile-open.png` | Library | 390x844 | light | drawer open |

## How to run

Default run (isolated fixture — no book assets needed):

```sh
cd Nostos.Frontend
npm run e2e          # builds backend + frontend, boots temp-SQLite fixture, runs everything
```

This captures images 9–14 (studio + library, fixture-served) and **skips**
images 1–8 with a documented message: the isolated fixture has no EPUB/PDF
book files and the harness never invents assets.

Full 14-image run against a real library (reader surfaces need real books):

```sh
cd Nostos.Frontend
VISUAL_QA_LIBRARY_URL=https://your-instance npm run e2e
```

`VISUAL_QA_LIBRARY_URL` must point at an instance that (a) serves the
**build under test** (the branch's own `ng build` output) and (b) has at
least one EPUB and one PDF book with files in the library. The harness
discovers them via `/api/books` and skips any missing surface with a clear
message.

## Automated geometry checks (run on every capture)

| Check | Applies to | Pass criterion |
| --- | --- | --- |
| `epub-iframe-theme` | EPUB captures | iframe `body`/`html` background+foreground equal the theme tokens; `#epub-viewer` shell surface matches the same tokens (no pale rim) |
| `pdf-scrollport-clearance` | PDF captures | scrolled to final page bottom, `#viewerContainer` bottom is at/above `header.reader-toolbar` top (toolbar covers no content) |
| `zen-fills-viewport` | zen captures | `.studio-layout` equals the viewport size |
| `zen-chrome-hidden` | zen captures | sidebars, editor header/status, TinyMCE menubar + formatting toolbar all `display:none` |
| `zen-gutters-balanced` | zen captures | editor surface horizontally centered: left/right gutters within 3px |
| `library-no-progress-combobox` | library captures | toolbar progress filter is not a `<select>`; the only toolbar select is sort |
| `library-six-sidebar-filters` | library captures | sidebar/drawer exposes exactly: All Books, Not Started, In Progress, Favorites, Finished, Unsorted — and no toolbar progress surface |

Every check is recorded in the capture's `.geometry.json` report with its
metrics. **Skips are never failures and never fakes**: a check is skipped only
when a documented dependency is absent (see below).

### Documented skips

1. **Reader surfaces (images 1–8)** skip in the default run: no EPUB/PDF test
   assets exist in-repo and they are never invented. Run with
   `VISUAL_QA_LIBRARY_URL` to capture them. The existing committed reader PNGs
   are historical evidence from the reader-theme/zen fix PRs; the harness
   regenerates them only in real-library mode.
2. **`epub-dark-mobile` highlight**: the app has no programmatic
   highlight-placement API — highlights require real user selection inside a
   book, which the harness cannot synthesize. The screenshot documents the
   themed reader; highlight visuals are covered by the vision review step when
   a real library is used.
3. **`library-six-sidebar-filters`** skips while the progress-filter repair
   (expert section 3) is not merged into main: the current merged UI still has
   the toolbar progress dropdown and five sidebar filters. The check activates
   automatically when the repair lands — no harness change needed. Until then
   the capture still runs (evidence of the current state) and the report marks
   the check `skipped` with the exact reason.

## Tokens

`support/visual-capture.ts` mirrors the app's single source of truth for
theme colors (`epub-reader.component.ts` `NOSTOS_THEME_RULES` + `styles.css`):

| Theme | iframe/shell background | iframe foreground |
| --- | --- | --- |
| light | `#ffffff` | `#1a1a1a` |
| dark | `#161a21` | `#e6e8ec` |
| sepia | `#faf5e8` | `#3a2f1d` |

If the app tokens change, update the table in `visual-capture.ts` and this
section **in the same PR** — a stale token table is a false FAIL.

## Vision review (mandatory, human or vision-model)

Screenshots plus geometry are the gate; pixel-diff snapshots are not. For
each PNG, record PASS/FAIL against the expert vision criteria:

- EPUB shell and iframe visibly share the selected theme.
- No pale iframe rim or first-section white flash.
- No unintended bright PDF viewing canvas.
- PDF colors and images are not inverted or corrupted.
- PDF page boundary is visible in every theme.
- Bottom toolbar covers no document content.
- Zen fills the viewport.
- Zen prose has balanced left/right margins; no empty right half.
- No detached control strip remains.
- Mobile dock overlays neither zen nor reader content.
- Exactly one progress-filter surface is visible.
- No clipping, horizontal overflow, illegible contrast, or overlapping controls.

Verdicts must be attached to the PR alongside the artifact names (e.g.
"PASS 14/14 — `epub-dark-mobile.png` verified against criterion list").
**Any unexplained FAIL blocks merge.**

## Human-override rule

A FAIL may be overridden only by an explicit human decision that states why
the visible result is intentional (e.g. "dark PDF page is authored white and
must not be recolored — surround-only dark mode is by design"). The override
must name the artifact and the criterion it waives. Silent or unexplained
failures never merge.

## PR checklist (copy into every UI PR description)

- [ ] `npx ng test --watch=false` green, no reduced test count
- [ ] `npm run e2e` green (existing specs + visual matrix; skips documented)
- [ ] `npx ng build` green
- [ ] 14-image matrix captured from the branch's actual production build
      (real-library run for images 1–8)
- [ ] Geometry reports: no failed checks; skips documented
- [ ] Vision review recorded per artifact (PASS/FAIL + artifact names)
- [ ] No unexplained FAIL; human overrides explicitly explained
- [ ] `git diff --check` clean
