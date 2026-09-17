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
| Page ground | `#FBFBFC` cool canvas | `#15181F` slate |
| Content surface | `#ffffff` | `#1B1E26` |
| Hairline border | `#E5E7EB` | `#262A34` |
| Primary ink | `#121316` obsidian | `#EDEEF2` porcelain |
| Accent | `#5B5E66` slate | `#D1AC8F` smoked warm |
| Dominant body ink | `#4A4D54` | `#C5C9D0` |

The light values above are the cool-neutral palette. Light and dark are now on
the *same* side of the warm/cool axis, so the two themes differ in luminance
rather than in temperature — the dark counterparts were originally chosen for
contrast against a warm ground and were re-checked against this one.

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

The arithmetic, and a correction I had wrong at first.

A **compound** is a combinator-separated part, NOT a class: `.nav-item.active` is
ONE compound holding two classes. Angular's `ShadowCss` splits a selector on
combinators and appends exactly **one** `[_ngcontent-x]` per **compound**, so each
compound's contribution becomes `(0, classes + 1, elements)`:

| | classes | injected attributes | specificity |
| --- | --- | --- | --- |
| component `.nav-item.active .count-badge` | 3 | 2 | **(0,5,0)** |
| global `:root[data-theme='dark'] .nav-item.active .count-badge` | 3 | `:root` + `[data-theme]` = 2 | **(0,5,0)** |

**They TIE**, and the component wins because Angular appends component styles after
`styles.css`. So the failure mode is *a tie broken by source order*, not a loss.

My first version of this section claimed (0,6,0) vs (0,5,0) by doubling a class
count. That reproduced the right verdict for this one selector and is **wrong in
general** — it miscounts multi-class compounds, element selectors, IDs, `:not()`,
`:is()`/`:where()`, combinators and comma lists. Two independent verifications now
agree on the tie reading: re-injecting the override and enumerating winning rules
from the CSSOM, and deleting the override with zero pixel change across 24 captures
(the second is only consistent with the override never winning).

**Consequence for the guard:** because real specificity is more complex than any
count of classes, `check:design`'s `possible-unwinnable-dark-override` is
**ADVISORY** — it reports, it does not fail the build, and its silence is not
evidence. The reliable detector for this bug class is the paint sweep read in BOTH
themes plus the pixel baseline, which is what actually caught the original defect.
A static specificity check is a signpost, not a proof.

The contrasting shape that made the whole bug class confusing: a global rule with
`--ink-lede` targeted `.meta-title`, a **single-compound** selector. There the
component rule is (0,2,0) against the global (0,3,0) and the override genuinely
**won**. Same-shaped global rule, opposite outcome — which is exactly why this must
be measured per rule rather than inferred.

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

### A capture that depends on the wall clock cannot be compared to anything
`reader-desktop-light` differed by ~11,300 px between two runs of identical code
AND identical content, because the reader paints a live elapsed-time readout
(`.time-label-btn`). No amount of image-settling fixes that: two correct captures
of a clock are supposed to differ.

The harness now installs a fixed clock (`page.clock.install`) before navigating, so
the readout advances deterministically from a known instant. This changes *when*
the app paints, never *what* it paints — the distinction matters, because a harness
that alters the thing under test is not a harness.

### Data-driven surfaces need a content fingerprint, not just a CSS hash
The library grid paints a list read from `nostos.db`, and other agents write to
that database while captures run (`nostos.db` was observed being written mid-run,
and a book added to the grid moved ~100,000 px in **both** themes with a
byte-identical CSS hash).

Without recording the content, that is indistinguishable from a real regression —
and it was initially misreported as one. Each capture now records a per-surface
content hash (visible text, resolved image URLs with intrinsic sizes, element
counts). The gate now says which of the two happened:

- content changed → "most likely DATA, not styling";
- CSS and content both match → "REAL styling change; regenerate the baseline
  deliberately".

A whole-run concatenated hash was tried first and was not good enough: it could not
name *which* surface moved, so the failure stayed unattributable.

The content hash excludes anything time-based on purpose. It must be stable across
two runs of the same code, or it carries no signal — which is also why the frozen
clock and this hash are complementary rather than redundant.

### Stub the data. Do not re-baseline a clock.
The content fingerprint is a *diagnostic*: it tells you a data-driven surface
moved and attributes it to DATA rather than CSS. That is the right call for the
library, whose rows genuinely belong to the user and cannot be faked without
losing the surface's meaning.

It is the wrong call for a surface whose data is *incidental* to what it renders.
`settings` fetches backup history — real stored timestamps from real backups — so
a weekly backup job moved ~3,900 px with byte-identical CSS, and the gate's
message ("this is a REAL styling change") was wrong, because `CONTENT_HASH` only
scans book/index/note cards and never looks at this surface's rows at all.

Re-baselining that would have fixed it for exactly one week and hidden the next
occurrence. The capture now **intercepts the endpoints and serves a fixed
fixture**, so only the clock is frozen and the CSS is still compared
byte-for-byte. Settings passes deterministically in any environment, including a
fresh worktree whose seeded DB has different values.

Two traps worth remembering if you add a stub:

- **Count matters as much as values.** `maxBackups` is 3, and the history card's
  *height* depends on the row count. A two-entry fixture left the card 12 px short
  of the viewport bottom and moved 8,146 px of pure background — with no text
  differing anywhere.
- **Every endpoint, not just the obvious one.** `/api/backup/settings` drives the
  Automatic Backup toggle *and* its description, which is different copy for
  enabled/disabled. Missing it produced 4,020 px of text drift from a database
  seed. Enumerate what the surface fetches; anything carrying a value that can
  differ between machines belongs in the fixture.

Pin the data when the surface's data is incidental; keep the fingerprint when it
is the subject. Never regenerate a baseline to silence a surface that is merely
non-deterministic — that trades a visible failure for an invisible one.

### Surface capture ORDER is load-bearing
An intermittent `reader-desktop-dark` failure (~11,240 px) resisted the clock fix.
The decisive measurement: it was **byte-identical across three consecutive
single-surface runs and matched the baseline**, yet failed inside a full 6-surface
run. Passing in isolation and failing in the suite means the variable is something
that *accumulates across the run* — here, wall-clock time, because the reader paints
a live elapsed-time readout and `clock.install` fixes the START time but the clock
still advances.

Two fixes were tried. The strong one — `clock.pauseAt` — **froze the app's own boot**
and the reader came up empty (61 elements, 9 painted); the non-vacuity guard caught
it and it was reverted. The one that works is ordering: the reader is captured
**first**, so elapsed time is minimal and reproducible.

Generalisable lesson: when a capture fails only in the suite, measure it *in
isolation* before touching the CSS. The comparison that localises the cause is
"passes alone, fails together", and it is cheap.

### `transition: a, b 0.2s` — the time binds only to `b` (the worst bug in this work)
`transition` is a **comma-separated list of shorthands**, and a trailing `<time>`
applies only to the LAST item. So:

```css
transition: background-color, border-color, box-shadow 0.2s ease;
```

means `background-color` and `border-color` at **0s** (they SNAP) and only
`box-shadow` animating. Confirmed in the browser — that declaration computes to
`transitionDuration: "0s, 0s, 0.2s"`.

This is precisely the trap the `transition: all` -> explicit-properties conversion
walks into, and 25 sites were converted into exactly that shape before it was
caught. Two properties that used to fade now snapped, and **the pixel gate cannot
see it**: a static screenshot of a non-hovered element is identical whether it would
animate or snap on hover. The paint sweep could not see it either — it reads
`transitionProperty` and clusters `transitionDuration`, and a bucket of
`0s, 0s, 0.2s` was recorded as the expected consequence of the conversion instead of
as a defect.

**What caught it: an adversarial review of the decisions, not the tooling.** The
lesson is not "add another rule" (though `transition-missing-duration` now exists,
and found 9 further sites the first fix missed) — it is that a gate built by the
same reasoning that produced the change inherits that reasoning's blind spots. The
pixel gate was designed to catch *visual* regressions; this defect is *temporal*,
and no static capture can express it.

Rule of thumb: when replacing `all` with a property list, repeat the timing on
**every** item. `transition: a 0.2s ease, b 0.2s ease`.

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
- **`0.85rem` (22 uses) vs `0.88rem` (12 uses) vs `0.9rem` (32 uses)** — the three
  remaining sub-pixel-adjacent rungs. Kept because each is used enough to be a real
  step in practice, and unlike the `0.875rem` outlier (ONE use against twelve, a
  0.08px difference) collapsing them would visibly move tens of elements. Recorded
  so the next reader knows the four-rung cluster was examined and deliberately left
  as three.

### The toast accents were the last theme-blind colours (now fixed)
`toast-container.component.ts` painted its success and error accents with
`#4ade80` / `#f87171` — light-mode Tailwind green/red hardcoded onto a surface that
is near-black in dark mode. Resolved rather than merely flagged, on evidence:

- **Nothing else in the app hardcodes these.** Every other surface (book-detail,
  settings, library, note-card, flat-tree, second-brain, add-book-modal) reads
  `--color-success` / `--color-danger`, which are theme-aware
  (`#22c55e` -> `#8FC7A8`, `#d32f2f` -> `#E4796B`). Toast was the sole outlier.
- **The component contradicted itself**: its `info` variant already used
  `--color-primary`. So "error and success are literal, info is a token" was not a
  considered distinction, just an unfinished one.
- **The brand manifesto weighs in**: it calls for "very restrained" accents and
  lists "neon gradients & colorful AI aesthetics" under *Avoid*. A saturated mint on
  a near-black ground was the one place that leaked through.

Note also that an earlier claim in this document — that these components were
"unthemed" — was WRONG. They use `var()` with fallbacks and the tokens resolve;
only the fallbacks were dead, and those were removed.

### `.empty-state` is four different messages, not one component

The same class name is declared in four stylesheets, which looks like duplication until
you read the bodies (all measured):

| Surface | Shape |
| --- | --- |
| settings | plain centred text block, 32px padding |
| flat-tree | inline dashed-border row, 42px min-height |
| reader | full-height column, muted ink, `p` child |
| writing-studio | full-height column with an icon-circle and an action button |

Only two of the four share anything beyond the name (reader and writing-studio agree on
`display: flex` / column / centred / muted ink / centred text — five declarations, and
they disagree on padding, height and gap). The markup differs too: text-only, a status
row, and an icon-plus-copy layout.

An `app-empty-state` would therefore be an `<ng-content>` wrapper that changes the
rendered DOM on four surfaces to save about four declarations, and it would still need
per-surface padding and height passed in. The shared part is not a component, it is a
naming collision — the same word used for four different messages. Left as-is; if the
four should ever LOOK alike, that is a design decision to make deliberately, not a
side-effect of a dedup.

### The three search boxes are near-copies, and deliberately left alone

`second-brain` renders three search fields — `.search-box`, `.note-search-box` and
`.merge-search-box` — and the first two are close relatives of Library's
`.search-bar-container`. Measured, they are NOT byte-identical: they differ in flex
sizing (`flex: 1 1 220px` vs none), input padding (`0.6rem 1rem` vs `0.6rem 0.75rem`),
and transition shorthand (`background` vs `background-color, border-color, box-shadow`).
Those are per-context choices, not drift.

Unlike the `.toggle-opt` recipe — which WAS byte-identical and had already drifted — a
merge here would require deciding which padding and which flex behaviour wins, for about
six rules. That is a reconciliation dressed up as a dedup, so it is not done. If it is
ever wanted, extract the shared parts (the absolute 18px icon in a 2.5rem gutter, the
`--border-focus` + `--color-accent-faint` focus ring) as tokens rather than forcing the
boxes to become one another.

### The segmented control is a shared RECIPE, not a shared component

The `.toggle-opt` base recipe is declared ONCE, in `styles.css`. Library and Brain
each used to carry a byte-identical copy of those four rules (only the comments
differed), which had already caused real drift: the focus ring was added to one copy
and not the other, so the same control behaved differently for keyboard users
depending on which page they were on. The mobile overrides stay in their components
because they genuinely differ (Library 32px box, Brain 44px touch target).

The MARKUP stays duplicated on purpose, and this is a decision, not an oversight. The
four surfaces sharing this visual recipe have four different interaction contracts:

| Surface | ARIA | Active class |
| --- | --- | --- |
| Studio sidebar | `role="tablist"` / `role="tab"` / `aria-selected` | `.active` |
| Settings theme | `role="radiogroup"` / `role="radio"` / `aria-checked` | `.is-active` |
| Brain view | `role="group"` / `aria-pressed` | `.active` |
| Library view | `role="group"` / `aria-pressed` | `.active` |

So the real candidate pool was two call sites (Library and Brain), not four. A shared
component would have to either keep those differences behind inputs — a leaky
abstraction for two callers — or silently change one call site's rendered DOM.
Extraction saves ZERO CSS now that the recipe is shared, and roughly 15 lines of
markup across two templates.

**Do not "finish" this by extracting the component.** Two earlier attempts were
reverted for exactly this reason.

Library's ARIA was upgraded in its own follow-up task (NOT in the dedup pass), which
is why it now matches Brain. Both icon-only controls previously announced as an
unnamed "button" with a colour-only selected state; they now expose a labelled
`role="group"` with `aria-pressed` tracking the visible view. The rule stands: a
behaviour change rides in its own PR with its own spec, never folded into a
behaviour-preserving refactor. See the `aria-pressed` note below for why the
attribute is emitted on these two and deliberately NOT on the icon buttons.

### The segmented control, and why it had to be fixed three separate times
Four components render the same control under different names:

| Component | Track | Option | Active option |
| --- | --- | --- | --- |
| Library | `.control-group` | `.toggle-opt` | `.toggle-opt.active` |
| Brain | `.view-mode-control` | `.toggle-opt` | `.toggle-opt.active` |
| Studio | `.sidebar-tabs` | `.tab-btn` | `.tab-btn.active` |
| Settings | `.theme-choice` | `.theme-opt` | `.theme-opt.is-active` |

Canonical recipe: `--bg-hover` track, 3px padding, `--radius-md`, 2px gap, **no
border**, and an active option painted `--control-active-fill` /
`--control-active-ink` with `--shadow-sm` plus a 1px `--border-color` outline.

**The active option must never be `--bg-surface`.** On dark, `--bg-surface`
(#1B1E26) is DARKER than the `--bg-hover` track (#252A34), so the selected option
*sinks* and the unselected pair looks raised. This bug was written and fixed three
separate times — Library, Brain, then Studio and Settings — because each copy was
authored from the light theme, where `--bg-surface` is white and correct. Measured
live on Studio before the fix: track `rgb(37,42,52)` vs active `rgb(27,30,38)`.

Drift found and removed: Studio's track carried a `border` the other three lacked
(it read as a boxed widget, not a raised track); Library's `.toggle-opt` had **no
focus ring** while Brain's byte-identical copy did, so one control behaved
differently for keyboard users depending on which page they were on.

### What WAS unified: the icon button (30 call sites -> one component)

`appIconButton` (`src/app/ui/icon-button/`) replaced 30 hand-built
`<button class="icon-btn"><lucide-icon ...></lucide-icon></button>` copies across
five templates. The five copies disagreed about SIZE, which is the thing the
component now owns.

`selector: 'button[appIconButton]'` means **the host is the native `<button>`**.
Not a wrapper element: a custom host defaults to `display: inline`, breaks flex/grid
alignment, and breaks descendant selectors this codebase relies on
(`.reader-toolbar .icon-btn`, `.note-actions .icon-btn`, `button:focus-visible`).
Not a plain directive either: a directive cannot own an encapsulated stylesheet.

**Measured size rungs** (the only thing the component owns):

| Rung | Box | Used by |
| --- | --- | --- |
| `md` (default) | 32px | reader toolbar, modal close, note-card edit-mode |
| `xs` | 28px | Library list rows |
| `xxs` | 24px | note-card's round row chips |

Radius is deliberately NOT owned: it varies per surface on purpose (3px global
`--radius-sm`, 4px Library rows and the reader toolbar, 6px studio zen toggle, 50%
note-card chips) and mostly arrives through DESCENDANT rules that keep matching
because the host is still a button. Encoding a radius rung here would have moved
pixels on four surfaces to no benefit.

Also deliberately NOT inputs, each for a measured reason:

- **`ariaLabel`** — a `[attr.aria-label]` host binding OVERRIDES a static
  `aria-label` on the call site, silently replacing Library's "Edit book" with
  nothing. Since the host is the button, native `aria-label` already passes through;
  the input only added a way to lose the label.
- **`active`** — every surface styles selection with its own `.icon-btn.active`, and
  a plain `[class.active]="tocOpen()"` works untouched. A second way to express one
  state is guaranteed to drift.
- **`aria-pressed`** — tri-state with a default of `null` (attribute absent). Most
  icon buttons are actions, not toggles; emitting `aria-pressed="false"` would
  misreport them.

Kept in the surfaces: `data-tip` + the themed tooltip, the `.delete` danger hover,
and every ancestor-scoped rule.

**THE ENCAPSULATION BOUNDARY, MEASURED.** Angular puts one `_ngcontent` attribute per
compound. The component host keeps the PARENT's scope attribute (so `.icon-btn` and
`.reader-toolbar .icon-btn` still apply), but the glyph inside carries the CHILD's.
Verified live: host `_ngcontent-ng-c1225754224`, glyph `_ngcontent-ng-c599134121`.
So `.icon-btn lucide-icon { border-radius: ... }` silently STOPS MATCHING at a
component boundary. Reader's glyph radius and its mobile `top: 0` override now cross
explicitly with `:host ::ng-deep`, the convention this repo already uses for
`second-brain -> note-card`.

**And a bare attribute is not a class.** `<button appIconButton zen-toggle>` is valid
HTML and reads fine, but `.zen-toggle` never matches it — this silently broke studio's
zen toggle and the reader's `desktop-only` buttons during the migration. Now guarded
by RULE 8.

*(A latent bug found on the way and NOT fixed, because fixing it is a visual change:*
studio passes `strokeWidth="1.5"`, but the app actually paints `stroke-width: 1`. The
migration preserves the painted value with `[strokeWidth]="1"`.

Confirmed at the source rather than inferred: `lucide-angular`'s `parseNumber` does
`parseInt(value, 10)`, so a static `strokeWidth="1.5"` is truncated to `1` before it is
written to the SVG. A plain `<svg stroke-width="1.5">` honours 1.5 verbatim (verified in
a browser), so the truncation is lucide's, not the browser's. Honouring the written 1.5
would thicken six studio icons — worth doing, but as a deliberate visual change with the
pixel gate regenerated, not inside a refactor.)*

### What WAS unified: `.visually-hidden`
It was declared twice, byte-identically (`second-brain` and `concept-map`). A
utility with no per-surface variation should not be duplicated: the copies give
no benefit and can drift, at which point one surface renders differently and
nothing says so. It now lives once in `styles.css`, and `check:design` fails if
it is declared zero times (content that should be hidden becomes visible) or more
than once (the drift can restart).

*(Repair note: an earlier edit replaced this section's HEADING with the toast note
and orphaned its body underneath, leaving the `visually-hidden` prose attached to
the wrong heading. A text-level patch that matches only a heading can strand the
body; check that a renamed section still has its paragraph.)*

---

## 5. Running the harnesses

```bash
npm run check                     # parse + token graph (incl. .ts theme modules) + 7 drift rules
                                  #   (the 8th, possible-unwinnable-dark-override, is ADVISORY)
npm run check:design -- --self-test   # proves each drift rule can actually fire
npm run check:freshness           # proves the freshness check fails in both directions
npm run capture:baseline -- --port 5214 --out /tmp/after
npm run check:pixels -- /tmp/after    # the real acceptance test
npm run probe:selection           # rest/hover/focus of a selected row, both themes
npm run probe:iconbutton -- --port 5214 --out /tmp/before   # icon-button contract
npm run probe:iconbutton -- --diff /tmp/before/iconbutton.json /tmp/after/iconbutton.json
```

The capture set is **24 PNGs across 6 surfaces**: library, brain, studio, settings,
home and the reader (`/read/:id` — a route, not a tab, which is why it was missed
by the first pass), each at desktop and mobile in light and dark. Image decode is
awaited and the clock is frozen, so two captures of one build are byte-identical.

A CSS refactor compiles perfectly while changing every surface, so **the build
passing is not evidence**. The acceptance test is the pixel gate. Byte-identical
output is the expected result for a value-preserving refactor; when a change is
*intended* to move pixels, regenerate the baseline and say so in the commit.

### The icon-button probe, and why a screenshot is not enough

`check:pixels` captures STATIC frames. It cannot see `:hover`, `:focus` or
`disabled` — the blind spot that once let 25 transition sites ship snapping instead
of animating while all 24 captures still matched. Classic CSS has no hover state in a
static PNG, and state is exactly what a shared component is most likely to break.

`scripts/probe-iconbutton.mjs` dumps **computed style** (27 fields including
`transition-property`/`transition-duration`, size, radius, outline, glyph geometry)
at rest/hover/focus, per surface and theme, then `--diff`s two runs. It is the
acceptance test for a control migration; PNGs cannot be.

Four instrument bugs found by using it, each of which made it lie:

- **A fixed settle wait sampled mid-transition.** At 60ms against a 200ms transition
  the same CSS produced different numbers, and the "regression" was the instrument.
  Now: a minimum wait past the transition, then poll until two reads agree.
- **Two equal reads before a transition STARTS look settled.** The probe recorded
  REST values under a `hover` label, so a phantom diff appeared. `stateApplied` is now
  recorded and compared.
- **Only ~13 of 30 call sites render at rest.** The rest sit inside `@if` branches, so
  each surface runs real interactions (open the TOC/notes panels, switch Library to
  list view, open the modal, enter zen, open the note editor). Without that, most call
  sites would be silently unverified.
- **Sampling keyed on the class string missed whole variants.** Studio's 8 buttons all
  carry `icon-btn` and differ by glyph size and stroke weight, so a per-class cap
  sampled 3 and left 5 migrated-but-unverified. Sampling now keys on the painted
  variant: 80 buttons, 12 variants.

It also checks its OWN coverage and exits non-zero unless it captured at least two
distinct variants, hover AND focus, the 24px rung, and the note-card edit-mode
buttons. A probe that silently samples nothing is worse than no probe.

**Its noise floor is measured, not assumed**: two consecutive runs of the same code
are byte-identical (0 differences). Verify that before trusting any diff.

Order matters for `check:pixels`: run `capture:baseline` **and** a fresh capture of
the same build before trusting a failure, because a baseline written while the page
was still settling produces a diff that looks like a regression and is not one.
Both tiers are needed: the pixel PNGs only see the captured viewport, while the
paint sweep sees the whole document — during the segmented-control fix the sweep
flagged mobile dark changes that the viewport-only screenshots never showed.
