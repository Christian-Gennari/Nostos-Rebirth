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
23 sites animate every property, including layout ones. Because `all` includes
padding and width, a hover that changes either animates layout — which reads as
a fade or flicker where a crisp change was intended. **Use an explicit property
list.**

### A global dark override racing an Angular-encapsulated component rule
The dark theme is implemented in two halves: tokens in the `:root[data-theme]`
block, and ~30 explicit override selectors for things tokens cannot express. The
overrides have to out-specify the component rule, and Angular rewrites a
component selector to add `[_ngcontent]`, which raises its specificity.

When the two land on the **same** specificity, the component wins on source
order (Angular appends component styles after `styles.css`). The failure is
invisible in review, does not error, and only manifests in one theme.

This has happened twice — `.book-grid .book-card:hover .cover-wrapper` and
`.index-list .index-row-shell:focus-within .index-item.active` — and both were
fixed by naming an *enclosing* class purely to climb the ladder. **Prefer a
token the component consumes over a specificity override.** A token re-declared
on `:root` is specificity `(0,1,0)` and cannot race anything.

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
records a build fingerprint and **fails** if a sentinel selector is missing, and
`scripts/check-sentinel.mjs` proves that sentinel can go false. Before
interpreting any live number, confirm the served bundle is the code you think
it is.

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

---

## 5. Running the harnesses

```bash
npm run check              # css integrity + theme graph (incl. .ts theme modules)
npm run capture:baseline   # 20 PNGs + painted-value JSON + build fingerprint
npm run check:sentinel     # proves the build sentinel can go false
```

A CSS refactor compiles perfectly while changing every surface, so **the build
passing is not evidence**. The acceptance test is the baseline comparison: after
a change, re-capture and diff against `e2e/visual-evidence/design-baseline/`.
Byte-identical output is the expected result for a value-preserving refactor.
