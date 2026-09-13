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
| `transition: all` | 26 sites | **0** |
| Transition items missing a duration | 25 (introduced by me, then fixed) | **0** |
| Focus-ring literals | 23 inline `2px` | 1 token |
| `.visually-hidden` definitions | 2 (byte-identical) | 1 global |
| Segmented-control implementations | 4 drifted (2 broken on dark) | 1 recipe |
| Literal colours in components | 109 (per-line, inflated) | 79 (per-literal, ratchet-pinned) |
| Captured surfaces | 5 (20 PNGs) | 6 (24 PNGs) — the reader route was uncovered |
| Static design rules | 0 | 6 gating + 1 advisory, each proven to fire |
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
9. **`transition` semicolons dropped by my own conversion script** — where a
   declaration followed on the next line it was absorbed into the transition
   *value* and discarded, so elements rendered black. Valid CSS; 23 stylesheets
   still "parse cleanly"; no check failed. Found only by the pixel sweep growing a
   black fg bucket. Now rule 1 of `check:design`.
10. **Two more phantom regressions in the harness** (found after the first fix, when
    a "regression" appeared in both themes with a byte-identical CSS hash):
    - the reader capture varied with the wall clock (live elapsed-time readout,
      ~11,300 px between runs of identical code);
    - library captures varied with the DATABASE, which other agents write during a
      run (~60,000–100,000 px with identical CSS).
    Both now handled: a frozen clock, and a per-surface content fingerprint that
    lets the gate attribute a diff to data or to CSS rather than guessing.

**Verification status:** `check:pixels` passes 24/24 on three consecutive captures,
and was re-proven to still FAIL on a genuinely injected styling change (radius
4px -> 9px), naming it as CSS rather than data. A gate hardened only until it stops
complaining is worse than no gate.

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

## The seven open calls — all CLOSED

Decision authority was delegated. Each was resolved from measurement, and three
turned out to be defects rather than taste calls:

1. **Dark active-segment fill** — resolved as a BUG FIX, not a preference. On dark,
   `--bg-surface` (#1B1E26) is *darker* than the `--bg-hover` track (#252A34), so
   Studio's and Settings' selected option SANK. Measured live before:
   track `rgb(37,42,52)` vs active `rgb(27,30,38)`. This was the THIRD time the same
   bug was written in this app (Library, Brain, then Studio+Settings) — each copy
   authored from light mode, where `--bg-surface` is white and correct. All four now
   read `--control-active-fill` / `--control-active-ink`.
2. **Settings' missing active outline** — added; it was simple drift.
3. **Focus ring** — the clay-vs-slate framing was wrong. `--color-accent` is 3px
   nowhere; the real drift was a hardcoded `2px` width. Widths all read
   `--focus-ring-width`; the dock's accent COLOUR is kept deliberately (a dock item
   can be destructive, so it earns a distinct ring). Library's `.toggle-opt` had NO
   focus ring while Brain's byte-identical copy did — that was a real accessibility
   defect and is fixed.
4. **Type rungs** — `0.875rem` had exactly ONE use against twelve `0.88rem`, a
   0.08px difference standing as two rungs. Collapsed. The other three
   (`0.85`/`0.88`/`0.9rem`, 22/12/32 uses) are deliberately kept and documented as
   examined.
5. **Toast literals** — resolved, NOT a taste call. `#4ade80` / `#f87171` were the
   last theme-blind colours in the app: no other component hardcodes them (all read
   `--color-success` / `--color-danger`), the component contradicted itself (`info`
   already used a token), and the brand manifesto lists "neon gradients & colorful
   AI aesthetics" under *Avoid*.
6. **High-risk `transition: all`** — the "high risk" label was MINE and it was
   wrong. It came from a heuristic that counted any rule *declaring* a size property
   and that matched comments as selectors. Re-derived correctly (diff base rule
   against its state variants; `transform` excluded as compositable and intended),
   all 10 remaining sites were safe. `transition: all` is now **0**.
7. **Stacked PRs** — left stacked (#95 then #96); merge order recorded in both.

## What went wrong, and the one thing that caught it

Worth reading before trusting any gate in this repo.

The `transition: all` conversion produced **25 sites where earlier items had no
duration** — `transition: a, b 0.2s` binds the time to `b` only, so `a` snapped.
Verified live: that shape computes to `transitionDuration: "0s, 0s, 0.2s"`.

**Every gate passed.** The pixel baseline is a *static* capture, and a non-hovered
element looks identical whether it would animate or snap on hover. The paint sweep
recorded the changed duration clusters as "expected" — the tooling reported the
symptom and my interpretation of it was wrong.

What caught it was **adversarial review of the decisions by an independent model**.
That review also refuted the specificity arithmetic documented above (I had claimed
(doubling) (0,6,0) vs (0,5,0); the truth is a (0,5,0) TIE broken by source order).
Both corrections are now in `docs/design/design-language.md` with the wrong version
recorded rather than quietly deleted.

The generalisable lesson: **a gate built by the same reasoning that produced the
change inherits that reasoning's blind spots.** Both of my failures were invisible
to checks I had designed myself. Neither was caught by more testing — they were
caught by someone re-deriving the answer from first principles.

Consequence for tooling honesty: `possible-unwinnable-dark-override` is now
**ADVISORY**, not a gate, because sound specificity arithmetic could not be built
cheaply and a trusted-but-unsound check is worse than none.

## Phase 4 (measured, and deliberately NOT done)

Phase 4 was "migrate the remaining surfaces onto the shared vocabulary". Measured
before starting, and the measurement changed the answer:

- 1,290 rules / 5,367 declarations app-wide. **44 duplicate declaration-sets**.
- Of those, **32 are 2-3 declaration idioms** (`background: var(--bg-hover); color:
  var(--color-text-main)`, focus rings, disabled states). Extracting them into a
  class means adding a `class=` attribute to hundreds of template nodes and makes
  the CSS *less* legible, not more. That is why they were rejected in the plan's
  "deliberately NOT unified" list.
- Only **12 groups carry 4+ declarations**, and most of those are genuinely
  different things (two independent dropdowns in one file, a responsive clip of a
  heading, absolute overlays on different layouts).
- Removing every duplicate would delete ~238 declarations: **~4.4% of the total.**

Against that, Phase 4 is 18 surfaces / 18 PRs in a tree with several concurrent
agents, for a line-count saving whose honest ceiling is single-digit percent.

I attempted the least risky slice anyway — two byte-identical rule pairs inside
`audio-reader.component.css` — and **my scripted merge corrupted the file**,
folding `.rate-selector`/`.rate-label` into `.rate-pill` and deleting
`.rate-option`'s states. It was caught immediately (the reader capture grew
24,624 differing px and the paint sweep showed changed buckets with an *unchanged*
content hash, i.e. my edit, not data), reverted, and the file verified byte-clean
against HEAD.

That was the right moment to stop. The evidence for stopping is itself measured:

- the saving is ~4.4% of declarations at the absolute theoretical maximum;
- the one attempt I made produced a defect;
- the categories with real duplication are the ones extraction makes *worse*;
- and a scripted bulk rewrite of 18 surfaces is exactly the shape of change that
  produced the 25-site transition regression earlier in this work.

**If it is wanted later**, do it one surface per PR, by hand, starting with
`book-detail` (37 literals) — never by script, and never more than one surface at a
time. The guards from Phase 3 make each step verifiable.

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
