# Unified design language — execution status

Supersedes the three planning documents in this directory
(`2026-09-13_174330`, `_181500`, `_183500`). Those described the plan; this records
what was actually built, what was measured, and what is deliberately left.

**Method note, because it was a review correction and it governed everything:**
the brand grew incrementally, so the earlier documents were treated as
unreliable. Every claim here was re-derived by measuring the CSS and the live
DOM. Where a document and the CSS disagreed, the CSS won.

## Where the work lives

| PR | Branch | Scope |
| --- | --- | --- |
| #95 | `chore/design-language-token-contract` | Phase 1: token naming, retire inert, baseline harness |
| #96 | `refactor/theme-dissolve-dark-overrides` | Phases 1b/2/3, stacked on #95 |

Merge #95 first (or ask for the branches to be flattened into one PR).

## Results

| Measure | Before | After |
| --- | --- | --- |
| Dark override selectors | 30 | 2 (both documented, both justified) |
| `transition: all` | 26 sites | 2 (1 high-risk, 1 in a component under repair) |
| Focus-ring literals | 23 inline `2px` | 1 token |
| `.visually-hidden` definitions | 2 (byte-identical) | 1 global |
| Literal colours in components | 109 (per-line, inflated) | 83 (per-literal, ratchet-pinned) |
| Captured surfaces | 5 (20 PNGs) | 6 (24 PNGs) — the reader route was uncovered |
| Static design rules | 0 | 5, each proven to fire |
| Pixel gate | ad-hoc manual diffing | `check:pixels`, rectangle-scoped |

**The honest headline is unchanged from the plan: the line-count saving is
modest (10–20%).** The win is that there are fewer *distinct ways* to express the
same thing, and — substantiated by the defects found — fewer one-theme bugs.

## Defects found and fixed

1. **`.nav-item.active .count-badge`** — the dark override tied the component rule
   at (0,5,0) and lost on source order, so dark painted the light chip. Third
   occurrence of this class.
2. **`.btn-primary`'s dark override was load-bearing for `settings`**, which
   declares its own `.btn-primary`. Deleting the override turned "Back up now"
   back into a dark spruce pill. Fixed by pointing the component at the CTA
   tokens — the whole point of the refactor.
3. **Mobile dock rail** carried a *downward* shadow on dark: the container
   override (0,3,0) beat the mobile rule (0,2,0) inside its media query. A real
   bug, preserved as-is because fixing it would be an unrelated visual change.
4. **`var(--space-3)` in the reader** was declared nowhere in the repo; the
   fallback was always the value.
5. **`--radius-full`** consumed but never declared.
6. **`--ink-lede` light-mode value** — an early attempt muted it and moved six grid
   card titles out of pine, caught by pixel diff.
7. **The capture harness raced lazy images** (see below). The most expensive bug
   in the change-set, and it was in the harness, not the CSS.
8. **`toast-container` success/error accents** are theme-blind literals beside
   unused token equivalents — noted, not changed (see open calls).

## The harness bug, because it invalidates comparisons made before it was fixed

`library-desktop-dark` differed from baseline by **338,467 pixels** (26% of frame)
while the paint sweep showed **one** changed element. Neither reading was correct:
it was not a styling regression and not the known flake. Two capture sets taken
minutes apart reported the **same bundle hash** (`7f83f46e`) and produced
**different images** — impossible if the CSS were the variable. The library grid
renders covers with `loading="lazy" decoding="async"` and the harness slept a
fixed 1500 ms, so decode was a race.

Two rules now enforced: compare the **bundle hash** before blaming CSS, and
**settle images** (eager + `decode()` + fail on pending) rather than sleeping.
Any capture comparison from before this fix is unreliable in both directions.

## Guards, and why each exists

`npm run check:design` (5 rules, `--self-test` proves each can fire):

| Rule | Defect it prevents |
| --- | --- |
| `unterminated-transition` | A missing `;` swallows the next declaration. Valid CSS, renders black, no existing check noticed. |
| `undeclared-token` | `var(--x)` with no declaration; distinguishes a dropped declaration from a fallback-that-renders. |
| `literal-colour` | Ratchet at 83. May only fall; a NEW hard-coded colour fails. |
| `visually-hidden` | Zero declarations (content becomes visible) or more than one (drift can restart). |
| `unwinnable-dark-override` | Recomputes Angular's doubled-compound specificity; fails on a tie or a loss. |

`npm run check:pixels` — byte comparison against the baseline minus declared flake
rectangles, plus the paint sweep with the motion buckets read separately.
Documented limitation: the sweep only samples elements that paint in the captured
viewport, so the pixel tier is the contract and the sweep is a second opinion.

## Open calls (deliberately NOT decided unilaterally)

1. **Dark active-segment fill**: `#323A48` (Library/Brain) vs `#1B1E26`
   (Studio/Settings), identical in light. Unifying changes a visible fill.
2. **Settings has no active-state outline**; the others do.
3. **Focus ring**: clay 3px vs slate 2px — which is the brand?
4. **Four type rungs within 0.8px** (`0.85`/`0.875`/`0.88`/`0.9rem`) across 21% of
   text. Collapsing them is visible.
5. **Toast success/error literals** `#4ade80` / `#f87171` where `--color-success` /
   `--color-danger` exist and are theme-aware. Swapping moves the hue.
6. **`transition: all` in the high-risk size-changing hover** — needs eyes on the
   animation, not a script.
7. **Stacked PRs #95/#96** — merge in order, or flatten.

## Phase 4 (not started)

Migrating the remaining surfaces onto the shared vocabulary is mechanical but is
18 surfaces / 18 PRs, whose only justification is line count, against real
regression risk with several agents in the same tree. Recommended order by
measured duplication density: `book-detail` (37 literals), `reader-shell`,
`audio-reader`, `epub-reader`, `pdf-reader`, then the rest.

## Reproduce

```bash
cd Nostos.Frontend
npm run check                    # parse + token graph + 5 drift rules
npm run check:design -- --self-test
npm test && npm run build
npm run capture:baseline -- --port 5214 --out /tmp/after
npm run check:pixels -- /tmp/after
npm run probe:selection          # rest/hover/focus of a selected row, both themes
```
