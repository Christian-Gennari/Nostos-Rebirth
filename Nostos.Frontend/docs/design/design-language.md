# Nostos Design Language

> **The CSS is the source of truth.** This document records what the stylesheets
> and the running app *already do*, measured. It is a description, not a
> specification to impose. Where this document and the CSS disagree, the CSS
> wins and this document is the thing that is wrong.
>
> The brand grew incrementally, so any earlier design document — the manifesto,
> a brand-kit token sheet, a superseded plan — is **not** authority. Values here
> were read out of `src/styles.css`, the component stylesheets, and the painted
> DOM of the running app.

How the numbers below were produced: `scripts/capture-baseline.mjs` clusters
computed values over every element that actually paints (851 on the Library,
down to 18 on the splash), across 5 surfaces x 2 viewports x 2 themes, at DPR 1.
Re-run it with `npm run capture:baseline`.

---

## 1. What is themed and what is not

The system has two axes, and they behave differently. Confusing them is how
theme regressions happen.

### Themed — colours invert between light and dark

| Axis | Light | Dark |
| --- | --- | --- |
| Page ground | `#FDF8F6` paper | `#15181F` slate |
| Content surface | `#ffffff` | `#1B1E26` |
| Hairline border | `#E4E1DB` | `#262A34` |
| Primary ink | `#28372D` pine | `#EDEEF2` porcelain |
| Accent | `#8A6D58` clay | `#D1AC8F` smoked warm |
| Dominant body ink | `#5C5A55` | `#C5C9D0` |

Every colour token has a counterpart in both themes, and
`scripts/check-theme-tokens.mjs` fails the build if one does not. That guard
also covers self-contained theme modules outside `styles.css` (the TinyMCE
editor content), which were previously invisible to it.

### Theme-invariant — identical in both themes

| Axis | Value set |
| --- | --- |
| **Weight** | exactly three: `400` (71%), `500` (18%), `600` (10%) |
| **Family** | exactly two: `Hanken Grotesk` (99%), `Newsreader` (1%) |
| **Radius** | `0` (81%), `50%`, `999px`, `6px`, `3px`, `4px`, `8px`, `12px`, `24px`, `5px` |
| **Gap** | `4px` (28%), `16px` (20%), `2px` (17%), `6px` (11%), `10.4px`, `8px`, `12px` |
| **Padding** | `8px` (17%), `7.2px` (10%), `5px` (9%), `3px` (8%), `4px` (7%), `16px` (7%) |
| **Duration** | `0.2s` (28%), `0.15s` (27%), `0.16s` (18%), `0.12s` (16%) |
| **Easing** | `ease` (**84%**), `cubic-bezier(0.16,1,0.3,1)` (9%), `linear` (3%) |

### Deliberately invariant in BOTH themes — do not "fix" these

These are theme-invariant on purpose, and a naive "make everything themed"
sweep would break them:

- **`.format-badge`** paints `rgba(255, 255, 255, 0.22)` on 20 borders in both
  themes. It is a chip sitting **on cover artwork**, not on the page ground, so
  it must not invert with the page.
- **`--brand-shape` / `--brand-doorway`** — the mark is one forest-tile /
  paper-arch variant in both themes. Listed as `INVARIANT` in the theme guard.
- **`--graph-node` / `--graph-node-head`** — the concept map sits on its own
  stage, not on page chrome. Theme-aware values, but not a surface in the
  app's ladder.
- **`--modal-scrim` family** — a scrim over arbitrary content, not a surface.
- **`--cover-disc-*`** — controls on artwork; they invert with the *artwork*
  context, which is why they carry their own token family.

Their allowlist is the `INVARIANT` regex in `scripts/check-theme-tokens.mjs`.
Adding to that regex is the correct way to declare a new invariant; it is not
a way to silence a real omission.

---

## 2. Motion

`--motion-fast/base/slow` are `160/220/320ms` and `--ease-standard/out/spring`
exist — but **84% of everything that moves uses plain `ease`**, and the painted
durations are `0.2s`/`0.15s`/`0.16s`/`0.12s` rather than the named steps. The
scale exists; the app mostly does not use it.

`--ease-plain: ease` was added so the majority easing is at least named and
centrally changeable. It is deliberately equal to `ease`: introducing it moved
no pixels. Re-pointing it at a curve is a one-line, whole-app, **visible**
change — which is why it is a separate token from `--ease-standard`.

Two duration families (`0.16s` and `0.15s`, together 43%) are almost certainly
one convention written twice.

**When timing a new transition,** prefer the named scale. When adding motion to
a surface that changes size, see the `transition: all` warning below.

---

## 3. Anti-patterns this codebase has actually been bitten by

Each of these is a real defect that shipped, not a style preference.

### `transition: all`
**Do not write `transition: all`. Name the properties that actually change.**

The reason is not pedantry: `all` interpolates layout properties too, so a hover
that changes size animates layout, which reads as a fade or flicker where a crisp
change was intended.

**Enumerate the properties by measuring, not by reading.** For each site, diff the
base rule against its `:hover`/`:focus` variants and list only the properties that
actually differ. In this codebase that pass converted 24 of 26 sites; the property
sets were derived from the diff, so converting them is value-preserving *for the
interpolated properties*.

Two things that are **not** preserved, and why they are still worth knowing:

- The painted `transitionProperty` / `transitionDuration` buckets move, and a
  property-set change can shift *which* duration cluster an element lands in
  (`.format-badge` painted 0.2s but reported 0.22s once `all` was replaced,
  purely because the cluster it belonged to changed). This is why the painted-value
  gate is compared per-bucket and the transition buckets are read separately from
  the colour buckets.
- One site is genuinely **high risk and must stay `all`**: a hover that changes
  size. Those are enumerated in the design-language vendored list; convert them
  only with eyes on the animation, not by script.

**A trap that bit this change-set:** the conversion script dropped the terminating
semicolon. `transition: background-color, color 0.2s ease` followed on the next
line by `color: var(--color-text-main);` swallows that declaration as part of the
transition *value*, so the element loses its colour and renders black. The result
is valid CSS — every declaration parses, all stylesheets "parse cleanly", and no
check fails. It shows up only as a new `rgb(0, 0, 0)` in the painted-value sweep.
When editing transition declarations programmatically, assert the semicolon.

### A global dark override racing an Angular-encapsulated component rule
The dark theme is implemented in two halves: tokens in the `:root[data-theme]`
block, and explicit override selectors for things tokens cannot express. The
overrides have to out-specify the component rule, and Angular rewrites a
component selector to add `[_ngcontent]`, which raises its specificity.

When the two land on the **same** specificity, the component wins on source
order (Angular appends component styles after `styles.css`). The failure is
invisible in review, does not error, and only manifests in one theme.

This happened twice — `.book-grid .book-card:hover .cover-wrapper` and
`.index-list .index-row-shell:focus-within .index-item.active` — and both were
fixed by naming an *enclosing* class purely to climb the ladder.

**Prefer a token the component consumes over a specificity override.** A token
re-declared on `:root` is specificity `(0,1,0)` and cannot race anything.

The arithmetic, because it is not the intuitive one. Angular adds an
`[_ngcontent-x]` attribute to **every compound**, so a component rule's
specificity is **twice its compound count**, while a global override counts once:

| | compounds | specificity |
| --- | --- | --- |
| component `.nav-item.active .count-badge` | 3 | **(0,6,0)** |
| global `:root[data-theme='dark'] .nav-item.active .count-badge` | 3 (+`[attr]`) | **(0,5,0)** |

So the override loses — and if the two ever **tie**, the component still wins,
because Angular appends component styles after `styles.css`.

`check:design` now computes both sides statically and fails on a tie or a loss
(`unwinnable-dark-override`), proven against the exact selector that shipped
broken. Two shapes it reports, both real:

- `:root[data-theme='dark'] .nav-item.active .count-badge` — 3 vs 6, LOSES.
- `:root[data-theme='dark'] .brand, .meta-title` — the tie case. `.meta-title`
  was a single compound, so the component rule was (0,2,0) against (0,3,0) and the
  override genuinely **won**. Same-shaped global rule, opposite outcome, which is
  why the arithmetic has to be checked per rule and not generalised from one
  example.

Worked example — the selected-row fill. It has exactly two consumers
(`.index-item.active` in the Brain index, `.nav-item.active::before` in the
Library sidebar); every other `--primary-fill` use is a button, CTA or badge
that is bright in both themes. Because both are *selection* states they must
resolve identically, so the value lives on **`--selection-surface`**
(`#28372D` forest with white ink in light, `#2B323F` raised slate with porcelain
in dark) and the two component rules read it directly. The four-selector global
override and its `.index-list` specificity padding are gone — the whole race is
structurally removed rather than won. Verify with `npm run probe:selection`,
which drives rest/hover/focus in both themes, because **this defect does not
appear at rest**.

### The specificity arithmetic, measured (read this before writing an override)

Angular adds **one `[_ngcontent]` attribute per COMPOUND selector**, so a
component rule's effective specificity is roughly **2x its compound count**.
That is why a global override's fate is decided by comparing compound counts —
and why the same-looking override can win against one component rule and lose
against its neighbour in the same file:

| Rule | Specificity | Outcome |
| --- | --- | --- |
| `:root[data-theme='dark'] .nav-item.active .count-badge` (global) | (0,5,0) | — |
| `.nav-item.active[_ngcontent] .count-badge[_ngcontent]` (component) | **(0,5,0)** | **TIE → component wins on source order** |
| `:root[data-theme='dark'] .meta-title` (global) | (0,3,0) | — |
| `.meta-title[_ngcontent]` (component) | (0,2,0) | override genuinely wins |

Both rows were in the *same deleted override block*. The badge override was
losing silently (a light chip survived on dark), the title override was working.
**Check the count per rule; do not assume.** Resolve it with a token instead:
a value on `:root` is (0,1,0) and is read by the component, so no global rule
needs to win anything.

Three instances of this class are confirmed in this repo: `.book-grid
.book-card:hover .cover-wrapper`, `.index-list .index-row-shell:focus-within
.index-item.active`, and `.nav-item.active .count-badge`. The first two were
fixed by hand-padding a selector; the third is the one that motivated writing
this table down.

### A component token invisible to the token guard
`check-theme-tokens.mjs` used to read only `styles.css`. The TinyMCE editor
content declares its own 13-token theme pair inside a `.ts` file and was
therefore unguarded. The guard now walks `.ts` files too. **A theme block
outside `styles.css` is legitimate; an unguarded one is not.**

### Treating a token name as a colour
`--color-primary` is a legacy alias whose dark value differs from
`--primary-ink`/`--primary-fill` yet is still read as a foreground by many rules.
`--danger-ink` resolves to porcelain `#F0F2F5` on dark — its one consumer is a
mark on a *filled* danger surface. **Read a token's value in both themes before
using it as a foreground.** A name promises a role, not a hue.

### Measuring a stale build
An audit session measured a bundle that predated a merge to `main`; every
number it produced described the old code. `scripts/capture-baseline.mjs` now
checks freshness on every run and **fails** if the served stylesheet is not the
newest build, or if the build is older than the newest source file.

Prefer a **content/mtime** freshness check to a hard-coded sentinel **selector**.
The first version of this guard asserted the served sheet contained
`index-list .index-row-shell` (the specificity fix from #94) — and that marker
was legitimately refactored away one phase later, so the guard failed on a
correct build. A marker that names something the work is trying to delete will
rot on schedule. `npm run check:freshness` proves the current check fails in
both directions.

### A flaky screenshot is not a regression
`library-desktop-light` differs on roughly one run in three *with identical
code*. Before reading any pixel delta as your change, re-run and compare two
captures of the **same code** — otherwise a capture artifact gets reported as a
regression. `npm run check:pixels` now declares that region explicitly.

### Two DIFFERENT PNGs from the SAME stylesheet hash
This was the most expensive bug in the change-set, and it was in the harness,
not the CSS.

`library-desktop-dark.png` differed from the baseline by **338,467 pixels**
(26% of the frame, max channel delta 255) while the paint sweep showed a single
changed element. The obvious readings were both wrong: it was not a real
styling regression, and it was not the known flake (that one is ~636 px).

The decisive evidence was the **bundle hash**. Two capture sets taken minutes
apart reported the *same* `styles-OTQI5LFS.css` hash `7f83f46e` and produced
different images. Identical CSS cannot produce different paint, so the variable
had to be the capture. The grid renders covers with
`loading="lazy" decoding="async"`, and the harness waited a fixed 1500 ms — so
whether each cover had decoded was a race.

Two lessons, both now enforced:

1. **Compare the bundle hash before blaming the CSS.** If the hash matches and
   the pixels do not, stop looking at stylesheets. Record the hash in every
   capture set (the fingerprint does) and diff it first.
2. **Settle images, do not sleep on them.** `capture-baseline.mjs` now forces
   `loading="eager"`, awaits load *and* `decode()`, and **fails the capture** if
   any image is pending or broken. A harness that silently races makes every
   comparison meaningless in both directions: it invents regressions and it can
   also mask real ones.

A useful tell: a difference that large with a clean sweep means the *sweep* is
blind, not that the page is fine. Here the sweep was right and the harness was
wrong — but the size of the discrepancy is what said "look at the harness".

### The flake allowance is a rectangle list, not a pixel budget
`check-pixels.mjs` ignores differences only inside explicitly declared
rectangles, each with a recorded justification and measured size. A per-image
pixel budget was rejected: a real change (a switch knob moving is ~536 px) and a
rendering artefact (the toolbar edge drift is ~636 px) are the same order of
magnitude, so a budget cannot separate them. A rectangle can, because it is
spatially specific. Anything outside the declared boxes is compared at a
tolerance of 8/channel and fails the build.

---

## 4. What is deliberately NOT unified

Documented so the next reader does not "fix" it:

- **`display: flex` (208x), `align-items: center` (176x), `cursor: pointer`
  (65x), `position: relative` (67x)** — one-to-three-declaration idioms that
  read clearly inline. Extracting them would add a class attribute to hundreds
  of template nodes and make the CSS less legible.
- **`.nav-item` / `.index-item` / `.tree-row`** — three row variants: a pill
  painted by `::before` with a shadow, a filled row, and a tree row with a
  gutter chevron. The differences are deliberate and documented in the source.
- **The five `outline-offset` values on focus rings** — inset for tiles and
  rows, outset for chips. A real distinction, not drift.
- **The editor content's `--ink` / `--paper` vocabulary** — a separate visual
  world (warm ink on paper) injected into a TinyMCE iframe. Local by design.

### What WAS unified: `.visually-hidden`
It was declared twice, byte-identically (`second-brain` and `concept-map`). A
utility with no per-surface variation should not be duplicated: the copies give
no benefit and can drift, at which point one surface renders differently and
nothing says so. It now lives once in `styles.css`, and `check:design` fails if
it is declared zero times (content that should be hidden becomes visible) or more
than once (the drift can restart).

---

## 5. Running the harnesses

```bash
npm run check              # css integrity + theme graph (incl. .ts theme modules)
npm run capture:baseline   # 20 PNGs + painted-value JSON + build freshness check
npm run check:freshness    # proves the freshness check fails in both directions
npm run probe:selection    # rest/hover/focus of a selected row, both themes
```

A CSS refactor compiles perfectly while changing every surface, so **the build
passing is not evidence**. The acceptance test is the baseline comparison: after
a change, re-capture and diff against `e2e/visual-evidence/design-baseline/`.
Byte-identical output is the expected result for a value-preserving refactor.
