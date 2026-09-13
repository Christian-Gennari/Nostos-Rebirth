# Nostos Unified Design Language — Implementation Plan (v3)

> **SUPERSEDED.** This describes the PLAN, not what was built. Execution status,
> measured before/after values, the defects found, and the open calls all live in
> `.hermes/plans/2026-09-13_200000-nostos-design-language-status.md`.

> **Supersedes both earlier drafts** (`2026-09-13_174330-...` and `2026-09-13_181500-...`). v1 leaned on old docs; v2 was CSS-derived but taken against a **stale build** and before Christian's PR #94 merged. v3 is re-derived against `8e2dd2a` and re-validated against the merge.
>
> **Authority: the CSS and the running app only.** No prior document is treated as truth. Where a doc and the CSS disagree, the CSS wins and the doc is a defect to fix.
> **Status: read-only.** No application file modified. Plan: `.hermes/plans/2026-09-13_183500-nostos-design-language-v3.md`

**Goal:** Make the design language that already exists explicit and enforceable, so repeated styling collapses into shared vocabulary and drifted duplicates converge — preserving the app's appearance and its character (warm editorial palette, serif/sans pairing, hairlines, tight radii, the breathing wait-field).

**Method:** read every `.css` **and** the 4 components whose CSS lives in `styles:[...]` blocks in `.ts`; sweep the **painted DOM** (computed values clustered over live elements, ×4 surfaces ×both themes); read the merge history and confirm which build the browser was actually serving; treat declared-intent-vs-painted-reality divergence as the finding.

---

## 1. Two corrections that must come first

### 1.1 I measured a stale build — the audit is still valid, the screenshots are not

Verified this session:

| Artifact | State |
| --- | --- |
| Served by `:5214` | `wwwroot/styles-HDW77E2D.css`, mtime **17:22:10** |
| Server process started | **17:22:10** (`dotnet run -c Release`) |
| Your commit `af719bc` | **17:54:01** |
| `dist/…/styles-OOUH22C2.css` | 17:52:40 — a *later, still local* `ng build` |
| Is PR #94's selector in the served CSS? | **No** (`hasNewSelector: null`; wwwroot has no match) |

**So the app I measured and screenshotted is pre-PR-#94.** Consequences:

- **Every UI screenshot and painted-value reading in this plan is pre-merge and must be re-captured** (Phase 0) before it can serve as a refactor baseline.
- **The declaration-level findings are unaffected**, because PR #94 changed **only** `styles.css` (+17/−2) and **only** dark override selectors. Token counts are byte-for-byte identical before and after: **115 light / 80 dark, `--color-secondary` still the only dark-only token.** F1/F2/F7/F8/F9 all stand as measured.
- **Line numbers quoted for `styles.css` shift +15 after line 547** (874 not 859; 931 not 916; 1004 not 989; 1019, 1113, 1122). Everything before 547 is unchanged.

Also flagged: `wwwroot/` currently holds **three** stale hashed stylesheets (`UMMDJDYO`, `FQ74MWLB`, `HDW77E2D`). Gitignored, so harmless to the repo, but it is accumulating output and it is what makes "which build am I looking at?" ambiguous. Worth a tidy.

### 1.2 The dark theme is implemented in TWO halves, and the second half is a specificity ladder

This is the most important architectural finding in the audit.

| Half | Size | Nature |
| --- | --- | --- |
| **1 — tokens** | 80 tokens, **173 lines** (`styles.css:321–493`) | Clean. Every colour re-declared per theme; `check:theme` enforces completeness. |
| **2 — explicit dark-only override rules** | **30 selectors / 21 rule blocks, 691 lines** (`styles.css:494–1184`) | Fragile. Each must out-specify an Angular-encapsulated component rule. |

Specificity histogram of that 30 (baseline `:root`(0,1,0) + `[data-theme]`(0,1,0) = 2 units):

| Specificity | Count |
| --- | --- |
| (0,7,0) | **2** |
| (0,6,0) | **1** |
| (0,5,0) | 3 |
| (0,4,0) | 10 |
| (0,3,0) | 8 |
| (0,2,0) | 6 |

The three highest exist **only** to beat Angular's `[_ngcontent]` rewriting:

```
(0,7,0)  :root[data-theme='dark'] .index-list .index-row-shell:hover .index-item.active
(0,7,0)  :root[data-theme='dark'] .index-list .index-row-shell:focus-within .index-item.active
(0,6,0)  :root[data-theme='dark'] .book-grid .book-card:hover .cover-wrapper
```

**Your PR #94 is a worked example of the failure mode**, and the repo now documents it in comments *three times* (`cover-wrapper`, `index-item`, and the merge message). Your own commit body states it precisely:

> Scoped by Angular, those variants are `.index-row-shell[_ngcontent]:focus-within .index-item.active[_ngcontent]`, which is (0,6,0) — exactly what `:root[data-theme='dark']` + the two variants resolves to, **so the two TIE and the component wins on source order** (Angular appends component styles to `<head>` after this sheet). Measured on dark: rest `#2B323F`, but hover AND focus-within `#2D4B44` (green).

Two independent instances (`book-grid`, `index-list`) required an **enclosing-class added purely to walk up the specificity ladder**. That is a landmine, not a technique: it is invisible in review, it does not error, and it only manifests in one theme.

**Consequence:** the dark theme's fragile half is a specificity ratchet against framework encapsulation. Any consolidation that changes a selector, moves a rule between files, or deletes a now-redundant-looking rule can silently break dark while light stays perfect — and a light-only review cannot see it. This is the top risk for the whole project, and it is why the plan below makes "prefer a token over a specificity override" a first-class principle and adds a dedicated guard.

---

## 2. What the CSS actually says — measured (declaration level)

### 2.1 Scale

| Metric | Value |
| --- | --- |
| Stylesheets / lines | 23 / 11,229 (11,244 post-merge) |
| Rules / declarations | 1,290 / 5,561 (incl. `.ts` inline blocks) |
| Distinct declarations | 1,585 |
| Exact duplicates of a declaration already in `styles.css` | ~2,000 (**37%**) |
| Hardcoded colours outside `styles.css` | 40 hex + 78 rgba |
| CSS in `.ts` `styles: [...]` blocks | 436 lines / 4 components |
| `!important` | 136 |
| Theme tokens | 115 light / 80 dark / **1 dark-only** (`--color-secondary`) |
| Dark-only override selectors | **30** (above), 3 at ≥(0,6,0) |
| Gates | 297 unit tests (19s); `check` 0.46s; `build` 7.6s; Playwright minutes |

### 2.2 Duplication density by file (share of declarations that already exist in `styles.css`)

`concept-input` 59% · `audio-reader` 57% · `note-card` 50% · `confirm-modal` 49% · `concept-autocomplete` 49% · `workspace-layout` 46% · `settings` 44% · `epub-reader` 44% · `second-brain` 44% · `flat-tree` 44% · `add-book-modal` 44% · `reader-shell` 43% · `sidebar-collections` 43% · `home` 43% · `library` 42% · `writing-studio` 42% · `book-detail` 42% · `concept-map` 34% · `pdf-reader` 21% (protected) · `tinymce` 5% (protected)

### 2.3 Identical class, divergent implementation — the convergence targets

Verified against source and live computed values:

- **`.visually-hidden`** — 8-declaration block **byte-identical in 3 files**, plus a 4th copy renamed `.library-title`.
- **`.toggle-opt`** — identical body in `library.component.css:310` / `second-brain.component.css:186`, but each carries a *different* mobile block (`height:32px; padding:4px 8px` vs `min-height:44px; min-width:44px`).
- **`.sort-select`** — Library: no `min-height`; Brain: `min-height: 39px`. Measured live: `0px` vs `39px`.
- **`.icon-btn`** — **five** implementations: global (`32×32`, `all:unset`), Library (`28×28` + tooltip + `position:relative`), reader-shell (`44×44`, plus a mobile block reverting hover to `transparent`), Studio (`padding:4px`, `transition: all`), note-card (`border-radius:50%`).
- **`.modal-backdrop`** — `add-book-modal`: `top/left/width/height` + `z-index:100` + blur. `confirm-modal`: `inset:0` + `z-index:120` + no blur.
- **`.empty-state`** — four unrelated layouts (settings centred padding; flat-tree flex row with dashed border; reader-shell column `4rem 1rem`; Studio column `height:100%`).
- **`.divider`** — `border-bottom`/`2rem`/`opacity .6` vs `border-top`/`1.5rem`.
- **`.tab-btn`** — add-book-modal underline tab vs Studio segmented button (i.e. Studio's is really a `.toggle-opt`).

### 2.4 Structural drift the source comments already document

`.nav-item` / `.index-item` / `.tree-row` are three deliberate variants (pill via `::before` + shadow vs filled row vs tree row with a gutter chevron). The comments explain each choice. **Recommendation: document, do not unify.** Confirm (§6 Q4).

---

## 3. What the CSS actually says — measured (painted level)

Clustered over the painted DOM, ×4 surfaces ×**both themes**. Where light and dark share the *set*, that axis is theme-invariant.

### 3.1 Theme-invariant axes (identical in both themes)

| Axis | Distinct | Dominant values |
| --- | --- | --- |
| **Radius** | 10 | `0` 81% · `50%` 6% · `999px` 4% · `6px` 3% · `3px` 3% · `4px` 2% · `8px` · `12px` · `24px` · `5px` |
| **Weight** | **exactly 3** | 400 71% · 500 18% · 600 10% |
| **Family** | **exactly 2** | Hanken Grotesk 99% · Newsreader 1% |
| **Gap** | 14 | `4px` 28% · `16px` 20% · `2px` 17% · `6px` 11% · `10.4px` · `8px` · `12px` |
| **Padding** | 20 | `8px` 17% · `7.2px` 10% · `5px` 9% · `3px` 8% · `4px` 7% · `16px` 7% |
| **Duration** | 8 | **`0.2s` 38%** · `0.15s` 23% · **`0.16s` 19%** · `0.12s` 13% · `0.22s` · `0.32s` · `0.3s` |
| **Easing** | 5 | **`ease` 84%** · `cubic-bezier(0.16,1,0.3,1)` 10% · `linear` 3% · `--ease-standard` 2% · `--ease-spring` 2% |

**Effective type scale** (text-bearing elements only, 338 measured, 18 distinct — 9 cover 91%):

`10px` · `10.88` · `11.52` · `12` · `12.8` · `13.6` · `14.08` · `14.4` · `16` — plus `13.12`, `14`, `15.2`, `21.6`, `22.4`, `24`, `28`, `35.2`

### 3.2 Themed axes (invert; 12/11 ink, 15/18 surface, 6/6 shadow, hairline `rgb(228,225,219)`→`rgb(38,42,52)`)

### 3.3 Findings

**F1 — Motion tokens mostly bypassed, and the bypass is 84% plain `ease`.** `--motion-fast/base/slow` (160/220/320ms) and `--ease-standard/out/spring` exist; painted reality is 0.2/0.15/0.16/0.12s on `ease`. The token names promise a motion language the app does not speak. Also: `0.16s` (19%) and `0.15s` (23%) are two conventions for one thing. *Largest token↔reality gap.*

**F2 — Typography has four near-identical rungs.** `13.6` / `14` / `14.08` / `14.4` sit within 0.8px and are 21% of all text (i.e. `0.85` / `0.875` / `0.88` / `0.9rem` drift). `--text-base/lg/xl/2xl` are **declared and used zero times**.

**F3 — The segmented-control family is one control with five implementations, and the drift is functional.** Measured both themes (all matches enumerated, not first-match):

| Surface | Class | Inactive | Active fill (light → dark) | Active outline | H |
| --- | --- | --- | --- | --- | --- |
| Library | `.toggle-opt` | transparent | `#FFFFFF` → `#323A48` | 1px `--border-color` | 30 |
| Brain | `.toggle-opt` | transparent | `#FFFFFF` → `#323A48` | 1px `--border-color` | 30 |
| Studio | `.tab-btn` | transparent | `#FFFFFF` → **`#1B1E26`** | 1px `--border-color` | 31 |
| Settings | `.theme-opt` | transparent | `#FFFFFF` → **`#1B1E26`** | **none** | 31 |
| Studio | `.icon-btn` | **filled** | *no active state* | none | 36 |

**The dark column is the finding**: identical light appearance, two different dark fills. `styles.css` overrides `.toggle-opt.active` for dark; `.tab-btn.active` is not covered. Plus: Settings' missing active outline, and Studio's `.icon-btn` reading as permanently selected because it is filled while inactive.

**F4 — 22 focus rings, and a second focus colour.** `outline: 2px solid var(--focus-ring)` × 22 in 6 files with **five** offsets (`-3`,`-2`,`-1`,`1`,`2`). Separately three search surfaces focus with `box-shadow: 0 0 0 3px var(--color-accent-faint)` (clay) and three with `0 0 0 2px var(--border-focus)` (slate).

**F5 — `transition: all` on 23 elements**, including elements that change size on hover, so layout animates.

**F6 — Preflight is missing, so Chrome's UA `button` styling leaks.** Reset is `*{margin:0;padding:0;box-sizing:border-box}`; only `button{font-family:inherit}`. Measured at exactly `13.3333px`: **94 `button` + 94 `lucide-icon` + 94 `svg` = 517 painted nodes** running on the UA default. `styles.css` is the only unscoped sheet, so the fix there corrects every surface at once.

**F7 — 4 dead global classes, 21 dead tokens.** Dead classes (verified across `.html` **and** inline templates in `.ts`): `.btn-lg`, `.glass-panel`, `.gradient-edge`, `.wait-field--breath`. Dead tokens: all `--space-*` (5), `--text-base/lg/xl/2xl` (4), `--shadow-lg`, `--overlay-heavy`, `--glass-blur-strong`, `--editor-ui-bg-active`, `--gradient-accent`, `--gradient-pastel-soft`, all five `--pastel-*`.

**F8 — 11 shadow tokens hide in a `.ts` file.** `markdown-editor.component.ts` declares `--ink`, `--ink-soft`, `--ink-faint`, `--paper`, `--rule`, `--rule-strong`, `--code-bg`, `--code-ink`, `--link`, `--link-hover`, `--selection` — a second vocabulary for roles `styles.css` already names, invisible to `check-theme-tokens.mjs` (which reads `styles.css` only).

**F9 — Two components paint unthered literals.** `toast-container.component.ts`: 12 (`#1a1a1a`, `#e0e0e0`, `#ffffff`, `#f87171`, `#4ade80`, `#818cf8`, `#888`, `rgba(0,0,0,.1)`). `star-rating.component.ts`: `#fbbf24`, `#c5c7cc`. Verified live: toasts paint `rgba(18,18,18,.82)` in **both** themes.

**F10 — Some invariants are deliberate and must not be "fixed".** `rgba(255,255,255,.22)` paints on 20 borders in both themes — verified as `.format-badge`, a chip **on cover artwork**. Likewise `--cover-disc-*`, `--brand-*`, `--graph-node`, `--modal-scrim*`. A naive theming sweep would break these. They need a stated allowlist.

**F11 — Token names promise roles the values contradict.** `--color-primary` is a "legacy alias" whose dark value differs from `--primary-ink`/`--primary-fill` yet is read as a foreground. `--danger-ink` resolves to porcelain `#F0F2F5` on dark. Consult values, never names.

**F12 — Structural repetition NOT worth extracting.** `display:flex` 208×, `align-items:center` 176×, `color:var(--color-text-muted)` 79×, `position:relative` 67×, `cursor:pointer` 65×. One-to-three-declaration idioms that read clearly inline; extracting them adds a class attribute to hundreds of template nodes and makes the CSS less legible. **Out of scope.**

---

## 4. The design principles this audit implies

Derived from the CSS, stated so later phases cannot drift:

**P1 — Prefer a token over a specificity override.** When a theme needs to change how a component looks, the component should consume a *token* (re-declared on `:root`, specificity (0,1,0), no race) rather than a global rule having to out-specify Angular's `[_ngcontent]`. Most of the 30 dark override selectors are candidates. This is the single biggest complexity reduction available and it *structurally* removes the PR #94 bug class.

**P2 — Convergence, not relocation.** 37% of declarations already duplicate `styles.css`; the fix is that the component *drops* the duplicate and inherits, not that CSS moves between files. Moving rules changes no lines.

**P3 — Name what has no name; retire what is inert.** Add tokens for the focus ring, the pill/round radii, the motion step actually in use. Delete F7's dead entries.

**P4 — Both themes, every time.** Dual-theme is live and verified. Every colour token needs a dark counterpart; every phase captures both themes; **F3 proves a light-only review is blind to real drift.**

**P5 — The pixel diff is the acceptance test, not the build.** A CSS refactor compiles perfectly while changing every surface.

**P6 — Use the existing names.** The global vocabulary is unprefixed (`.btn`, `.badge`, `.tag`, `.icon-btn`, `.toggle-opt`). Promoting `.toggle-opt` into `styles.css` *is* the primitive. Inventing a `.ds-*` prefix would add a third convention to a codebase that has two.

**Excluded (YAGNI):** no preprocessor / Tailwind / token build step; no atomic utilities; no restructuring of F12 idioms; no template changes beyond a class attribute; no theme-system rework; and **protected from any sweep** — `src/tinymce-nostos.css`, `src/app/reader/pdf-reader/**`, the `::ng-deep` blocks in `writing-studio` and `second-brain`, the vendor skin in `markdown-editor.component.ts`.

---

## 5. Plan

Branch + PR per phase; never commit to `main`. Each task 2–5 minutes.

### Phase 0 — Re-baseline (mandatory; §1.1)

- **0.1** Rebuild and restart prod so `:5214` serves a **post-merge** bundle. Verify by reading the served CSS for PR #94's `index-list .index-row-shell` selector (the check I used). Tidy the three stale `wwwroot/styles-*.css`.
- **0.2** `scripts/capture-baseline.mjs`: CDP-driven captures → `evidence/baseline/<surface>-<viewport>-<theme>.png` **+** painted-value JSON. Both themes, desktop + mobile.
- **0.3** Record the exact build hash/selector fingerprint alongside the baseline, so every later diff states which build it measured.

### Phase 1 — Tokens: converge and retire (F1, F2, F7, F8, F11) — zero visual change

- **1.1** Publish the measured scales as tokens. **Motion**: two options for the 84%-`ease` reality — (a) add `--ease-plain: ease` and migrate the majority onto it (token becomes honest, zero pixels move), or (b) migrate onto `--ease-standard` (a *visible* easing change). **Recommend (a)** (§6 Q1). **Radius**: add `--radius-pill: 999px`, `--radius-round: 50%`. **Focus**: add `--focus-ring-width: 2px`; keep the five offsets but document which surface type each belongs to. **Type**: reconcile the four near-identical rungs (§6 Q2).
- **1.2** Retire F7's dead classes and tokens — delete both sides of any light/dark pair together. Verify: `npm run check && npm test`, then confirm no runtime reference in the built bundle.
- **1.3** Give the `.ts` tokens (F8) a home — map onto existing roles or declare them deliberately with a comment. **Do not leave them invisible to the guard**; that is the defect.
- **1.4** Write down the F10 invariant allowlist before any sweep touches the theme.
- Verify throughout: `npm run check` PASS; non-colour tokens go in `check-theme-tokens.mjs`'s **existing** `INVARIANT` regex, extended — not a second list.

### Phase 2 — Convergence

Per task: define the shared rule in `styles.css`, migrate surfaces, delete local duplicates, prove the diff **in both themes**.

- **2.1 `.toggle-opt` (F3, biggest win).** Promote the existing class; migrate Library, Brain, Studio's `.tab-btn`, Settings' `.theme-opt`; decide Studio's `.icon-btn`. Must resolve: the **dark fill divergence** (`#323A48` vs `#1B1E26`), Settings' missing active outline, and the always-filled icon button (§6 Q3).
- **2.2 `.icon-btn`** — five implementations onto `--control-h` + `--radius-sm`; keep the tooltip and circular variants as explicit modifiers; **preserve reader-shell's deliberate mobile hover-revert**.
- **2.3 The field family** — `.search-box` (two anatomies, and the clay-vs-slate focus split) + `.sort-select` (the `min-height` gap). Settle the focus treatment (§6 Q5).
- **2.4 The focus ring (F4)** — one rule on `--focus-ring-width`, documented inset/outset variants rather than flattening five offsets. **Preserve the two dark overrides** (`#A9B6C6` on the active nav row) — an inset ring on a *filled* row needs a lighter colour.
- **2.5 Kill `transition: all` (F5)** — 23 sites → explicit property lists. **Check each for a layout property before converting**; A/B the hover in both themes.
- **2.6 Preflight (F6)** — inherit rule for form controls in `styles.css`. **The one item expected to change pixels** (517 nodes). Own PR, per-surface before/after evidence.
- **2.7 The un-themed components (F9)** — visible on dark, so its own PR reviewed as a design change.
- **2.8 The structural fixes (P1)** — **the highest-leverage task in Phase 2.** For each remaining dark override that exists only to beat encapsulation, move the value into a token the component consumes and delete the override. Each one removes a specificity landmine *and* lines from `styles.css`'s fragile half. Verify per removal in dark.
- **2.9 `.modal-backdrop` / `.empty-state` / `.visually-hidden` / `.divider`** — measured duplicates, cosmetic differences only. `.visually-hidden` is byte-identical ×3 + 1 renamed; backdrop differs in z-index (100/120) and blur; empty-state keeps modifiers rather than flattening.

### Phase 3 — Enforcement

- **3.1 `scripts/check-design-drift.mjs` → `check:design`, appended to `check`.** Model on `src/app/ui/motion-contract.spec.ts`, **including its non-vacuity guards** (file-count floor, per-file size floor, "the global sheet must be inside the scan"). Rules, each naming its defect: (1) duplicate-selector scan with a reason-carrying allowlist for protected files; (2) literal-colour scan, **seeded from the real 118 sites** so it ships green and only shrinks; (3) motion scan — no `transition: all`, durations must be tokens; (4) undeclared-token scan that **must include `.ts` inline blocks** (where F8 hid), while letting the 33 legitimate component-local tokens pass; (5) theme completeness extended to `.ts` tokens.
- **3.2 `dark-override guard` (new, and the reason for §1.2).** Fail when a global `:root[data-theme='dark']` override and an Angular-encapsulated component rule resolve to the **same specificity on the same element** — i.e. detect latent ties, the exact defect class of PR #94. Approach: compute each override's effective specificity (add 1 per `[_ngcontent]` the component rule would carry) and flag ties, plus flag `!important`. **Prove it reddens against a deliberately-removed `.index-list`** — the pre-#94 selector — before trusting it.
- **3.3 Pixel-identity gate.** `e2e/design-identity.spec.ts` **+ a `mobile-`prefixed twin** (the Playwright config filters projects by **filename**, so a mis-named spec silently runs desktop-only). Max channel delta ≤1/255 vs baseline, both themes.
- **3.4 Docs + PR gate.** `docs/design/design-language.md` (measured scales, theme contract, invariant allowlist from 1.4, anti-patterns from F3/F5/F6, the P1–P6 principles) and `docs/design/tokens.md` generated from `styles.css`. Extend the PR template.

### Phase 4 — Migrate surface by surface (one PR each), lowest risk first

1. `ui/concept-input`, `ui/concept-autocomplete-panel`, `ui/note-card` (42–59% already global; also resolves Brain's 21 `:host ::ng-deep app-note-card` overrides)
2. `library/sidebar-collections` (43%)
3. `settings` (44%) — settles `.theme-opt` cheaply
4. `add-book-modal` + `ui/confirm-modal`
5. `writing-studio` (42%) — `.tab-btn` → `.toggle-opt`; zen `:host-context` stays
6. `library` (42%, 617 decls, 37.9kB, 219 `.btn` + 125 `.input`)
7. `second-brain` (44%, 900 decls, **50.4kB**) — **watch the 28kB warning / 30kB error component-style budget: migration must shrink this file**
8. `book-detail` (42%, 701 decls) — highest risk, last
9. `reader/*` (`pdf-reader` untouched)
10. the `.ts` inline-style components (dock, toast, star-rating, markdown-editor)

---

## 6. Gates, risks, open questions

| Gate | Command | Cost | When |
| --- | --- | --- | --- |
| CSS integrity | `npm run check:css` | <1s | every change |
| Theme graph | `npm run check:theme` | <1s | every change |
| **Design drift (new)** | `npm run check:design` | <1s | every change |
| **Dark-override guard (new)** | in `check:design` | <1s | every change |
| Unit (297) | `npm test` | 19s | before commit |
| Build | `npm run build` | 8s | before push |
| **Pixel identity (new)** | `npx playwright test design-identity` | ~30s | before each PR |
| Visual matrix | `npm run e2e` | minutes | on request |

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Breaking the dark specificity ladder** (§1.2) | **Critical** | P1 token-first; the 3.2 guard; per-removal dark verification. PR #94 is the proof this is real and recurring. |
| **Silent specificity inversion on delete** | High | Removing a local rule can activate a global (0,1,0) rule that was losing. Verify computed values live. |
| **A light-only review missing drift** | High | F3's dark-only divergence. Both themes in every phase. |
| **Measuring a stale build** (§1.1) | High | Phase 0 re-baseline + build fingerprint in every diff. |
| **The 30kB component-style error budget** | Medium | `second-brain` is 50.4kB source. Watch the warning after every file. |
| **"Fixing" a deliberate invariant** | Medium | F10 allowlist, written before any sweep. |
| **Preflight moving 517 nodes** | Medium | Isolated to 2.6. |
| **Vendor-override breakage** | Medium | Protected-file allowlist in 3.1. |
| **A guard passing vacuously** | Medium | Non-vacuity assertions; prove every rule reddens on the pre-fix tree. |
| **Concurrent writers, one worktree** | Medium | `AGENTS.md`: own branch, explicit `git add` paths, no stash/reset, commit once verified. |

### Open questions

1. **Motion:** name the existing `ease` as a token and migrate the 84% onto it (no pixel change), or migrate onto `--ease-standard` (visible change)? **Recommend the former.**
2. **Type:** leave the four near-identical rungs (`0.85`/`0.875`/`0.88`/`0.9rem`, 21% of text) and just document, or collapse them? Collapsing is the biggest consistency win but moves 0.8px on a fifth of the UI, so it cannot be a "refactor". How aggressive?
3. **The segmented control's dark split** — Library/Brain `#323A48` vs Studio/Settings `#1B1E26`. Which is correct? And is Settings' missing active outline intentional?
4. **`.nav-item` / `.index-item` / `.tree-row`** — document the three variants, or unify? **Recommend document.**
5. **Focus treatment** — clay `--color-accent-faint` 3px (Brain, Library search) vs slate `--border-focus` 2px (Studio search, add-book modal). Which is the house standard? Real taste call.
6. **Optional: product vocabulary for tokens.** The CSS has no product naming beyond `--brand-*`. If you want the design language documentable as a brand, I can add additive alias names over the existing ones, derived from the actual values and the app's lived palette. Say the word.
7. **Delegation:** worker CLI(s) with my review, or by hand in-session?

**Recommended first step:** **Phase 0 + Phase 1**, one zero-visual-change PR. Phase 0 is not optional given §1.1, and Phase 1 settles the vocabulary every later phase depends on.

### Caveat on my own numbers

My first pass contained three errors only re-measurement caught, and the pattern shapes how this must be verified: I reported `.app-dock-container`/`.dock-item`/`.bloom-art` as dead classes (they live in **inline templates inside `.ts` files**, invisible to an `.html`-only search); I reported Brain's toggle as permanently active (my probe took `querySelector`'s **first** match, which was the selected option); and I reported a 517-node font-size cluster as a design scale before confirming it was the UA default. I also measured a **pre-merge build** for a full session before catching it. Every claim above has been re-measured since — but any future count taken by a script needs the same scepticism, and **a guard must be shown to fail on real violations before it is trusted.**

### Tradeoff, stated plainly

The CSS will **not** get dramatically smaller. Realistic net: **10–20% fewer lines**, plus a large drop in *distinct ways to do the same thing* — and, via P1, a measurable reduction in the fragile `styles.css` half that keeps producing PR-#94-class bugs. That third item is the biggest real win, and it is not measured in lines.
