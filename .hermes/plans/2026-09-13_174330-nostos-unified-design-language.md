> ⚠️ **SUPERSEDED — do not implement from this document.**
> Replaced by `.hermes/plans/2026-09-13_183500-nostos-design-language-v3.md`.
> Two defects: (1) this draft decided what the design language *should* be from
> old documents (`design-manifesto.md`, the brand-kit token sheet, an earlier
> dark-mode plan) — Christian's correction is that the brand grew incrementally
> and **the CSS is the only source of truth**; (2) it was measured against a
> build that predated a merge to `main`.
> **Still valid here:** the raw reconnaissance numbers in §0 (scale, duplication,
> token gaps) — all re-confirmed in v3 — and the protected-file list in §0.8.

# Nostos Unified Design Language — Implementation Plan

> **For Hermes:** Use `subagent-driven-development` / expert-worker orchestration to implement this plan phase-by-phase. **Do not start Phase 0 before Christian says go.** This document is the deliverable of a read-only pass — no application file was modified.

**Goal:** Turn the existing CSS (11,229 lines across 23 stylesheets) into one documented, enforceable design language — a single source of truth for tokens, primitives, and roles — so that repeated styling collapses into shared vocabulary while the Nordic Editorial character stays exactly as it looks today.

**Architecture:** Three layers, layered from the bottom up, never a rewrite:

1. **Token layer** (values) — extend the existing `:root` graph with the missing semantic roles (elevation, focus, roles that currently have no name) and give the 39 currently-undeclared custom properties real homes.
2. **Primitive layer** (repeated structures) — promote the genuinely-duplicated *patterns* (toggle/segmented control, icon button, backdrop, empty state, visually-hidden, focus ring, transition recipes) into named classes in `styles.css`, then have components consume them.
3. **Enforcement layer** (guards) — extend the repo's existing `scripts/check-*.mjs` family so the framework cannot silently rot, and add a **pixel-identity gate** so a refactor is proven behavior-preserving before it merges.

**Tech Stack:** Angular 21 standalone + Signals, plain CSS custom properties (no preprocessor), Vitest (297 tests), Playwright visual matrix, custom Node guard scripts.

---

## 0. Read-only reconnaissance — measured findings

Every number below was measured in this session, not estimated.

### 0.1 Scale of the current stylesheet

| Metric | Value |
| --- | --- |
| CSS files under `src/` | 23 (21 component, `styles.css`, `tinymce-nostos.css`) |
| Total CSS lines | 11,229 |
| Rules | 1,290 |
| Declarations | 5,367 (1,585 distinct) |
| Rules whose exact declaration set already exists in `styles.css` | ~2,000 (37% of all declarations) |
| Hardcoded colours outside `styles.css` | 40 hex + 78 rgba |
| Inline CSS in `.ts` `styles: [...]` blocks | 436 lines across 4 components |
| `!important` | 136 (concentrated: pdf-reader 37, library 36, tinymce 35, studio 15) |

### 0.2 Where the repetition actually is

Top exact-duplicate declarations across ≥2 files:

- `display: flex` 203× (20 files), `align-items: center` 176× (18), `justify-content: center` 79× (16)
- `color: var(--color-text-main)` 108× (16 files), `color: var(--color-text-muted)` 79× (15), `color: var(--color-text-light)` 64× (12)
- `background: var(--bg-surface)` 65× (15), `background: var(--bg-hover)` 49× (13)
- `border: 1px solid var(--border-color)` 58× (14)
- `font-family: 'Hanken Grotesk', sans-serif` 47× (11)
- `cursor: pointer` 65× (16), `position: relative` 67× (19), `position: absolute` 54× (16), `overflow: hidden` 49× (17)
- `transition: all 0.2s ease` 14× / `transition: all <other>` 23× total `transition: all` sites
- `font-weight: 500` 35× **alongside** `font-weight: var(--fw-medium)` 27× — the token exists and is bypassed in more places than it is used
- `border-radius: 999px` 20× (10 files) but `--radius-lg: 6px`; and `border-radius: 2rem` / `50%` / `12px` / `8px` are also in use — five different pill/round conventions
- `outline: 2px solid var(--focus-ring)` 22× (6 files) with `outline-offset` varying between `-3px`, `-2px`, `-1px`, `1px`, `2px`

### 0.3 The genuinely duplicated components (same class name, different values)

These are the highest-value extraction targets — identical class names, near-identical intent, measurably drifted implementations:

**`.toggle-opt` / `.toggle-opt.active`** — identical rule bodies in `library.component.css:310` and `second-brain.component.css:186`, plus a *different* mobile block each (`height: 32px; padding: 4px 8px` in library vs `min-height: 44px; min-width: 44px` in brain). Live measurement confirms the divergence: on `/library` the unselected `.toggle-opt` computes `background: rgba(0,0,0,0)` and only `.active` is raised; on `/second-brain` the *same* selector already computes `background: rgb(50,58,72)` + `outline: rgb(38,42,52) solid 1px`.

**`.sort-select`** — library declares `border-radius: var(--radius-md)` and no `min-height`; brain declares `min-height: 39px` and inherits the radius. Measured live: library `min-height: 0px`, brain `min-height: 39px`.

**`.icon-btn`** — five distinct implementations: global (`32×32`, `all: unset`), library (`28×28` + tooltip positioning + `position: relative`), reader-shell (`44×44`, then a mobile block that *reverts* hover to `transparent`/`inherit`), writing-studio (`padding: 4px`, `transition: all 0.2s`), note-card (`.note-actions .icon-btn` → `border-radius: 50%`). 30 uses in templates.

**`.modal-backdrop`** — two independent implementations: `add-book-modal` uses `top/left/width/height` + `z-index: 100` + `backdrop-filter: blur(var(--modal-scrim-blur))`; `confirm-modal` uses `inset: 0` + `z-index: 120` + no blur. Both read `var(--modal-scrim)`, so they look *almost* the same — the difference is a z-index and a blur that no shared token governs.

**`.empty-state`** — four unrelated layouts: settings (`padding: 32px 20px; text-align: center`), flat-tree (`flex` row, `dashed` border, `gap: 7px`), reader-shell (column, `padding: 4rem 1rem`), writing-studio (column, `height: 100%`).

**`.visually-hidden`** — byte-identical 8-declaration block copy-pasted into 3 files; a 4th copy exists under the name `.library-title` in `library.component.css`, i.e. the same utility renamed to a local semantic name.

**`.divider`** — `border-bottom` + `margin: 2rem 0` + `opacity: .6` in book-detail vs `border-top` + `margin: 1.5rem 0` in add-book-modal.

**`.tab-btn`** — add-book-modal (`padding: .8rem 1rem`, `border-bottom: 2px solid transparent`) vs writing-studio (`flex: 1`, `padding: .4rem .6rem`, no underline — the active state is an outline + shadow, i.e. it is really a `.toggle-opt`).

**`.search-box`** — brain (`position: relative` wrapper, absolute icon, `box-shadow: 0 0 0 3px var(--color-accent-faint)` on focus) vs writing-studio (flex row, `border-color: var(--focus-ring)` + `box-shadow: 0 0 0 2px var(--border-focus)`).

### 0.4 Token-layer gaps

- **21 dead tokens** declared in `:root` and used nowhere: all of `--space-*` (5), `--text-base/lg/xl/2xl` (4), `--transition-normal`, `--shadow-lg`, `--overlay-heavy`, `--glass-blur-strong`, `--editor-ui-bg-active`, `--gradient-accent`, `--gradient-pastel-soft`, and the whole legacy `--pastel-*` family (5). The type scale and spacing scale exist but components use raw `rem`/`px` instead.
- **39 undeclared custom properties** are consumed in components and never defined — they fall back silently. 33 of them are component-local state variables declared in a component block (legitimate), but **6 are genuinely undeclared and leak**: `--radius-full` (used in `library.component.css:153`), `--panel-width` (declared twice, in two different components, as 300px and 380px), `--toolbar-height` (declared only in reader-shell but read from pdf-reader), `--sidebar-width` (declared twice, 300px and 72px), `--actions-w` (76px in brain, 76px and 140px in flat-tree).
- **A second, shadow token vocabulary exists in a `.ts` file.** `markdown-editor.component.ts` declares its own `--ink`, `--ink-soft`, `--ink-faint`, `--paper`, `--rule`, `--rule-strong`, `--code-bg`, `--code-ink`, `--link`, `--link-hover`, `--selection` — 11 tokens that duplicate the global roles under different names, invisible to `check-theme-tokens.mjs` (which reads `styles.css` only).
- **The toast + star-rating components are entirely un-themed:** `toast-container.component.ts` carries 12 raw literals (`#1a1a1a`, `#e0e0e0`, `#ffffff`, `#f87171`, `#4ade80`, `#818cf8`, `#888`, `rgba(0,0,0,.1)`) and `star-rating.component.ts` carries `#fbbf24`/`#c5c7cc`. None of these track the theme.
- **Brand-value drift against the guidelines.** `_brand-assets/06_Guidelines/brand-tokens.css` declares forest `#293E32` and clay `#A07859`; the app ships `--color-primary: #28372D` and `--color-accent: #8A6D58` (and `--brand-shape: #293E32` matches). Two pines, two clays — deliberate or not, nothing records which is authoritative.
- **`--color-secondary` is declared dark-only.** `check:theme` reports it as `dark-only (new)`; there is no light counterpart, so any light-mode use falls back to nothing.

### 0.5 Theme-system state — dual-theme is live; one doc is stale

`docs/visual-verification.md` opens with: *"The app ships exactly one light rendering — the theme system was removed."* **That sentence is stale and refers to the theme system deleted in August** (`2d5d462`, `517af22`, `1ce311e`, `e2afacd`). Dark mode was then deliberately re-designed from scratch — see `.hermes/plans/2026-09-12_145434-nostos-dark-mode-design.md` ("Nordic Nocturne", a second attempt that cannot repeat the first failure) — and **has shipped**. Measured live this session:

- `theme.service.ts` exists, is the sole writer of `data-theme`, persists to `localStorage['nostos.theme']`, and the settings component renders a two-option `role="radiogroup"` toggle labelled "Colour theme".
- The app booted with `data-theme="dark"` (OS preference) and the dark block resolved correctly: `--bg-body: #15181F`, `--primary-ink: #EDEEF2`, `--danger-ink: #F0F2F5`.
- Switching to light resolved `--bg-body: #FDF8F6` / `--color-text-main: #1C1B1A` — both themes are real, live, and user-selectable.

**Consequence for this plan — settled as a hard constraint, not an open question:** the design language must be **dual-theme**. Every new colour token requires a dark counterpart or `check:theme` fails. Every phase captures both themes. `docs/visual-verification.md`'s opening line is a documentation defect to fix in Phase 3 (Task 3.4) — it currently tells any future agent that dark mode does not exist, which is exactly the kind of stale doc that produces a light-only refactor.

### 0.6 Guards that already exist (extend, don't reinvent)

- `npm run check:css` — `scripts/check-css-integrity.mjs`, parses every stylesheet and fails on unbalanced braces / a truncated rule body / a collapsed rule count. ✔ passing (23 sheets).
- `npm run check:theme` — `scripts/check-theme-tokens.mjs`, light↔dark counterpart completeness, with `INVARIANT` and `DERIVED` allowlists. ✔ passing (115 light / 80 dark tokens).
- `src/app/ui/motion-contract.spec.ts` — a repo-wide source scan asserting no `skeleton` and that the library draws nothing while loading. **This is the proven template for a new design-system guard**, including its non-vacuity protection (`files.length > 30`) and its "the global stylesheet must be inside the scan" assertion.
- `e2e/visual-regression.spec.ts` — the 15-image matrix + geometry JSON.

### 0.7 Gate costs (measured)

- `npm run check` — **0.46s**
- `npm test` (Vitest, 23 files / 297 tests) — **18.9s** wall
- `ng build` (production) — **~7.6s**
- `npm run e2e` — minutes (fresh temp DB + real backend + Playwright). On demand only.

### 0.8 Protected files — excluded from any global sweep

`src/tinymce-nostos.css`, `src/app/reader/pdf-reader/pdf-reader.component.css`, plus the `::ng-deep` blocks in `writing-studio.component.css` and `second-brain.component.css`, and the vendor skin inside `markdown-editor.component.ts`. These override third-party DOM (TinyMCE `tox-*`, PDF.js `#viewerContainer`/`.treeItem`) where the host app does not own the markup; a global primitive sweep would break them. They may adopt **tokens**, never restructured **primitives**.

---

## 1. Proposed approach

**Principles (these are the constraints, not preferences):**

1. **Evolution, not redesign.** Layout, routes, interactions, responsive behaviour and the Nordic Editorial look stay pixel-identical. The measurable acceptance criterion is a **pixel diff of ~0** against the baseline captures, not a passing build.
2. **Consume, don't centralize-by-moving.** Where a component's rule already matches a global one (37% of declarations), the fix is that the component *drops* the duplicate and inherits — not that the CSS is relocated. Moving rules between files changes no lines of CSS.
3. **Tokens before primitives before enforcement.** A primitive built on an unresolved token bakes in a value that will need re-doing.
4. **Name the roles, not the colours.** The repo already learned this the hard way (`--primary-ink` / `--primary-fill` / `--on-primary` split, `--danger-*` family). Every new token must state which of ink / fill / on-fill / hairline it is, and no token may be both.
5. **Angular encapsulation is the real ceiling.** `Emulation`-encapsulated component styles mean a global class only helps where the component *opts in* by using the class in its template. That is a strength here (no specificity wars) but it caps the achievable reduction: this is a **vocabulary + drift-elimination** project, not a file-size project. Say so plainly — do not promise "the CSS gets much smaller".
6. **Every phase is independently revertable** and lands as its own PR on its own branch, per `AGENTS.md`. Nothing merges itself.

**What "unified design language" concretely means here — five deliverables:**

| # | Deliverable | Form |
| --- | --- | --- |
| D1 | **Token contract** | Extended `:root` graph + `docs/design/tokens.md` documenting every token's role, both-theme values, and invariants |
| D2 | **Primitive library** | ~10 named classes in `styles.css` for the structures that measurably repeat (see §3 Phase 2) |
| D3 | **Roles & rules doc** | `docs/design/design-language.md` — when to use which token/primitive, plus the anti-patterns the repo has already been bitten by (`transition: all`, `animation-fill-mode: forwards` on state elements, drag-and-drop duplicate class) |
| D4 | **Guards** | `check:design` (drift scanner) + a pixel-identity spec, wired into `npm run check` and the PR gate |
| D5 | **Migration** | Components consuming D2/D3, one surface per PR, each proven by the pixel gate |

---

## 2. Explicit non-goals (YAGNI)

- **No CSS preprocessor, no Tailwind, no design-token build step.** A build-time token emitter would be a new dependency for something plain custom properties already do.
- **No class-per-element atomic utility system** (`.flex`, `.mt-8`). The manifesto forbids looking like a utility framework, and `display: flex` 203× is not a problem worth a `.row` class in every template — it is *readable* CSS. Only patterns that are 4+ declarations and semantically named get extracted.
- **No theme-system removal or rework.** See the open question in §0.5 — that is a separate decision.
- **No touching the protected vendor-override files.**
- **No component-template restructuring** beyond adding a class attribute.

---

## 3. Step-by-step plan

Each task is 2–5 minutes of focused work. Branch + PR per phase; never commit to `main`.

### Phase 1 — Token contract (D1) — no visual change

**Task 1.1 — Freeze a visual baseline.**
- Files: create `.hermes/plans/evidence/baseline-*.png` (already captured this session for library/brain/studio/settings × desktop/mobile, both themes).
- Add `scripts/capture-baseline.mjs` that drives the running app via CDP and writes `evidence/baseline/<surface>-<viewport>-<theme>.png` + a `geometry.json`.
- Run: `npm start` then `node scripts/capture-baseline.mjs`
- Expected: 12+ PNGs, stable across two consecutive runs.

**Task 1.2 — Define the missing semantic role tokens.**
- Modify: `src/styles.css` `:root` block (and mirror every colour into `:root[data-theme='dark']`).
- Add, with a comment stating the role and both theme values:
  - `--elevation-0..3` (the 3 `--shadow-*` tiers are referenced through 5 ad-hoc glass variants today).
  - `--radius-pill: 999px` and `--radius-round: 50%` — replacing the 20 bare `999px` and 4 bare `50%`.
  - `--focus-ring-width: 2px`, `--focus-ring-offset: -2px` — replacing the 22 literal `outline: 2px solid` sites and the 5 inconsistent offsets.
  - `--control-h-sm/md/lg` (28 / 32 / 44px) — the measured icon-button and toggle heights.
  - `--control-min-touch: 44px` — the accessibility floor the mobile blocks hand-roll.
  - `--panel-w-sidebar: 300px`, `--panel-w-rail: 72px`, `--panel-w-reader: 380px` — the currently-leaking `--sidebar-width`/`--panel-width`.
  - `--toolbar-h: 60px` — promote reader-shell's local `--toolbar-height`.
- Run: `npm run check:theme`
- Expected: PASS; dark token count rises by exactly the number of added colour tokens. **Non-colour tokens go in `INVARIANT`'s regex** in `check-theme-tokens.mjs` (extend the existing pattern, don't add a second list).

**Task 1.3 — Retire the 21 dead tokens.**
- Modify: `src/styles.css`.
- Remove `--pastel-*` (5) and `--gradient-pastel*`/`--gradient-accent` (3): verified 0 uses anywhere in `src/`. **This is also the only place the legacy gradient vocabulary is reached**, so removing it is what deletes the "two brands" ambiguity in the CSS itself.
- Decide per token for the other 13: either wire it up (`--space-*` and `--text-*` are worth adopting — see 1.4) or delete.
- Run: `npm run check:theme && npm test`
- Expected: PASS. If `check:theme` complains about a dark counterpart disappearing, delete both sides together.

**Task 1.4 — Repoint the bypassed scales.**
- Modify: the top ~8 component files by `font-weight`/`border-radius` literals.
- Replace `font-weight: 500|600` → `var(--fw-medium|--fw-semibold)`; `border-radius: 999px` → `var(--radius-pill)`; `border-radius: 2rem|8px|12px` → the nearest named radius.
- Run: `npm run check && npm test && npm run build`
- Expected: PASS + pixel diff 0 (a token whose value equals the literal cannot change pixels — **assert that per group before moving on**, don't assume).

**Task 1.5 — Give the leaked properties owners.**
- Files: `library.component.css`, `sidebar-collections.component.css`, `reader-shell.component.css`, `pdf-reader.component.css`, `second-brain.component.css`, `flat-tree.component.css`.
- Move `--sidebar-width`, `--panel-width`, `--toolbar-height` up to `:root`; keep `--actions-w`/`--indent-*` component-local but rename with a component prefix so a future drift scan can tell a local from a global.
- Delete the bare `var(--radius-full)` use (rename to `--radius-pill`).
- Run: `npm run check && npm test`
- Expected: PASS.

**Task 1.6 — Publish the token contract.**
- Create: `docs/design/tokens.md`, generated in part by a small script from `styles.css` so it cannot go stale silently.
- Content per token: name, role (ink/fill/on-fill/surface/border/radius/motion), light value, dark value, consumers count.
- Run: `node scripts/doc-tokens.mjs --check` (fails if `styles.css` has a token the doc does not).

**Phase 1 exit criteria:** `check`, `test`, `build` green; both themes captured; pixel diff 0 vs baseline; `docs/design/tokens.md` complete.

### Phase 2 — Primitive library (D2)

For each primitive: (a) write the shared rule in `styles.css`, (b) add it to the templates that already duplicate it, (c) delete the local duplicate, (d) pixel-diff.

**Task 2.1 — `.ds-visually-hidden`** (3 byte-identical copies + 1 renamed: `.library-title`). Lowest risk; proves the workflow end to end.

**Task 2.2 — `.ds-focus-ring`** — one rule consuming `--focus-ring-width`/`--focus-ring-offset`. Migrate the 6 files with `outline: 2px solid var(--focus-ring)`. **Careful:** the repo deliberately uses *different* offsets for different surfaces (inset `-2px` for tiles vs outset `2px` for chips), so ship **two** variants (`.ds-focus-ring--inset`, `.ds-focus-ring--outset`) rather than flattening a real distinction. The two dark-theme overrides in `styles.css` (`#A9B6C6` for the active nav row) must survive.

**Task 2.3 — `.ds-icon-btn`** — unify the 5 implementations onto `--control-h-sm/md/lg` + `--radius-sm`. Keep the library's tooltip positioning as a modifier (`.ds-icon-btn--tip`), keep reader-shell's mobile hover-revert as its own documented exception (it is deliberate: see the existing comment), and keep note-card's circular variant as `.ds-icon-btn--round`.

**Task 2.4 — `.ds-toggle-group` / `.ds-toggle-opt`** — the segmented control. Extract the shared `.toggle-opt` + `.toggle-opt.active` block (identical in library + brain), keep `min-height`/`min-width` differences as a modifier, and migrate writing-studio's `.tab-btn` (which is the same control wearing a different name). **This is the single largest drift win** — 3 surfaces, 2 implementations, 2 different mobile blocks.

**Task 2.5 — `.ds-field`** — the search/select/input family. Unifies `.search-box` (2 impls), `.sort-select` (2 impls), `.input`/`.select-input`. **Must resolve first:** brain focuses with `--color-accent-faint` (a 3px clay ring) while writing-studio focuses with `--border-focus` (a 2px slate ring) — these are visually different, so this needs your call (see Open Questions) before it is a mechanical migration.

**Task 2.6 — `.ds-backdrop`** — one scrim recipe (`--modal-scrim` + `--modal-scrim-blur` + one z-index tier). Migrate add-book-modal and confirm-modal. **Must resolve:** the two currently differ in z-index (100 vs 120) and in whether they blur at all.

**Task 2.7 — `.ds-empty-state`** + `.ds-empty-state__title/__text/__icon`. Four layouts today. Ship a base with modifiers rather than flattening them; the manifesto's "empty states are part of the design system" rule makes this worth doing properly.

**Task 2.8 — `.ds-divider`**, **`.ds-transition`** recipes (`--transition-interactive`, `--transition-fade`, `--transition-reveal`) to kill the 23 `transition: all` sites — replacing each with an **explicit property list** (the repo has already been bitten by `transition: all` causing a fade/flicker instead of a crisp change).

**Task 2.9 — Ship the migration for the un-themed components.** `toast-container.component.ts` (12 literals) and `star-rating.component.ts` (`#fbbf24`) into tokens. **These are the only two genuinely broken-on-dark surfaces found** — worth doing as a visible win. `app-dock.component.ts` has only 2 warm-shadow literals and is already token-based.

**Phase 2 exit criteria:** each primitive has exactly one definition; migrated surfaces pixel-identical; `check`, `test`, `build` green; a per-primitive list in the PR body of what was migrated and what was deliberately left.

### Phase 3 — Enforcement (D4)

**Task 3.1 — `scripts/check-design-drift.mjs`, wired as `npm run check:design` and appended to `check`.**
Model it on `motion-contract.spec.ts` — including its non-vacuity guards. Rules, each with a comment naming the incident it prevents:

1. **Duplicate-primitive scan.** Fail if a file under `src/app/**` redeclares a selector that `styles.css` now owns (e.g. `.toggle-opt`, `.visually-hidden`, `.modal-backdrop`). Allowlist the protected vendor files and an explicit per-file exception list with reasons.
2. **Literal-colour scan.** Fail on any hex/rgba outside `styles.css` unless the line carries an `/* ds-ignore: <reason> */` marker. **Seed the allowlist from the 118 real sites** so the guard ships green on day one and the list only ever shrinks.
3. **Bypassed-scale scan.** Fail on `font-weight: <number>` where a `--fw-*` token exists; same for bare `999px` radii and `transition: all`.
4. **Undeclared-token scan.** Collect every `var(--x)` across `src/` and fail on any `x` that is neither in `styles.css` nor declared in the same file. **This is the rule that has to be written carefully** — 33 legitimate component-local tokens must pass, so the check is "declared somewhere reachable", and it must include the `.ts` inline-style blocks (where the 11 shadow tokens hide).
5. **Theme-completeness for `.ts` tokens.** Extend `check-theme-tokens.mjs` to also parse `styles: [...]` blocks, closing the hole that let `markdown-editor`'s 11 tokens exist unthemed.

Assert non-vacuity in every rule (file count floor; each claimed file present and above a size floor). **Confirm each rule actually goes red on the pre-fix source** before trusting it — a rule whose allowlist already contains the violations it looks for guards nothing.

**Task 3.2 — The pixel-identity spec.**
- Create: `e2e/design-identity.spec.ts` (desktop + a `mobile-` prefixed twin so both Playwright projects pick it up — the config filters by **filename**, so a mis-named spec silently runs only on desktop).
- Capture each surface, compare against committed baseline PNGs, assert per-pixel delta ≤ 1/255.
- **A refactor PR must fail this if it changes a pixel** — a passing build proves nothing about a CSS refactor.
- Store baselines under `e2e/visual-evidence/design-baseline/` alongside the existing 15-image matrix.

**Task 3.3 — PR template + docs.**
- Extend `.github/PULL_REQUEST_TEMPLATE.md` (or create it) with a "CSS/design change" block: which tokens/primitives changed, the pixel-diff result, the `check:design` result, and the exact commands run.
- Update `AGENTS.md` §5 to point at `docs/design/tokens.md` and the new `check:design` gate (it currently documents only `check:theme`).

**Task 3.4 — Fix the stale theme statement in the docs.**
- Modify: `docs/visual-verification.md` opening paragraph, which still claims *"the app ships exactly one light rendering — the theme system was removed."* That was true of the theme system **deleted in August**, not of the **Nordic Nocturne** dark mode shipped since (plan: `.hermes/plans/2026-09-12_145434-nostos-dark-mode-design.md`). Verified live: both themes render, dark is the OS default, the settings toggle works.
- Decide with Christian whether the 15-image visual matrix should then gain dark captures, or whether an explicit note ("the matrix is fixed-light by scope, dark is covered by the design-identity spec") is the honest resolution. Do **not** silently expand the matrix — that is a separate scope decision.

**Phase 3 exit criteria:** `npm run check` runs all design gates; a deliberately-reverted duplicate makes `check:design` fail; a deliberately-nudged token makes the pixel spec fail; both demonstrated, not asserted.

### Phase 4 — Migration sweep (D5), one PR per surface, in this order

Ordered by measured duplication density (highest first) and by risk (lowest first within that):

1. `ui/concept-input` + `ui/concept-autocomplete-panel` + `ui/note-card` — 42–59% of declarations already exist globally. Also resolves second-brain's 21 `:host ::ng-deep app-note-card` overrides, several of which exist only because note-card's own styles were never promoted.
2. `library/sidebar-collections` (43%) — includes the `.nav-item` ↔ `.index-item` ↔ `.tree-row` three-way drift documented in the source comments.
3. `settings` (44%) — small, self-contained, good place to settle the `.ds-field` focus question.
4. `add-book-modal` + `ui/confirm-modal` — settles `.ds-backdrop` and `.ds-empty-state`.
5. `writing-studio` (42%) — `.tab-btn` → `.ds-toggle-opt`; the zen-mode `:host-context` block stays as is.
6. `library` (42%) — the largest single file (617 declarations, 37.9kB) and the biggest template consumer (87 `.btn`, 38 `.input`). Do it after the primitives have settled.
7. `second-brain` (44%) — the largest stylesheet (900 declarations, 50.4kB). **Watch the 28kB `anyComponentStyle` warning budget**: this file is already 50.4kB of source, so a *growing* stylesheet would hit the build budget. Migration must shrink it.
8. `book-detail` (42%) — 701 declarations, and it carries the `.ds-*` hero/cover stack the skill notes describe at length. Highest regression risk; last.
9. `reader/*` — reader-shell, epub, audio. Keep `pdf-reader` untouched (protected).
10. The `.ts` inline-style components (dock, toast, star-rating, markdown-editor).

**Phase 4 exit criteria:** `check:design` green with a **shrinking** allowlist; every surface pixel-identical; net CSS line count lower than the 11,229 baseline; each PR merged by you, not by the agent.

---

## 4. Files likely to change

**Created:**
- `Nostos.Frontend/docs/../` → `docs/design/tokens.md`, `docs/design/design-language.md`
- `Nostos.Frontend/scripts/check-design-drift.mjs`, `scripts/doc-tokens.mjs`, `scripts/capture-baseline.mjs`
- `Nostos.Frontend/e2e/design-identity.spec.ts`, `e2e/mobile-design-identity.spec.ts`
- `Nostos.Frontend/e2e/visual-evidence/design-baseline/*.png`
- `.github/PULL_REQUEST_TEMPLATE.md` (if absent)

**Modified (heaviest first):**
- `src/styles.css` (token graph, primitives, retirement)
- `src/app/second-brain/second-brain.component.css` (50.4kB), `library.component.css` (37.9kB), `book-detail.component.css` (37.2kB)
- `src/app/ui/flat-tree/flat-tree.component.css`, `writing-studio.component.css`, `sidebar-collections.component.css`
- `src/app/reader/reader-shell.component.css`, `audio-reader.component.css`, `epub-reader.component.css`
- `src/app/settings/settings.component.css`, `add-book-modal.component.css`, `ui/confirm-modal`, `ui/note-card`, `ui/concept-*`, `second-brain/concept-map`
- `src/app/layout/app-dock/app-dock.component.ts`, `ui/toast-container`, `ui/star-rating`, `ui/markdown-editor` (inline blocks)
- `scripts/check-theme-tokens.mjs`, `package.json` (`check` script), `AGENTS.md`, `docs/visual-verification.md`
- The `.html` templates for each migrated primitive (class attribute only)

**Explicitly not touched:** `src/tinymce-nostos.css`, `src/app/reader/pdf-reader/**`, the `::ng-deep` vendor skins.

---

## 5. Tests & validation

| Gate | Command | Cost | When |
| --- | --- | --- | --- |
| CSS integrity | `npm run check:css` | <1s | every change |
| Theme graph | `npm run check:theme` | <1s | every change |
| **Design drift (new)** | `npm run check:design` | <1s | every change |
| Unit | `npm test` (297) | 19s | before each commit |
| Build | `npm run build` | 8s | before push |
| **Pixel identity (new)** | `npx playwright test design-identity` | ~30s | before each PR |
| Full visual matrix | `npm run e2e` | minutes | on request |

**The load-bearing test is the pixel diff, not the build.** A CSS refactor compiles perfectly while changing every surface; only a pixel gate can prove behaviour preservation. Each phase's PR body must carry the measured diff (expected: max channel delta ≤ 1, on 0 pixels above threshold) plus a before/after screenshot pair for any surface whose diff is non-zero.

Also assert **structural invariants** that a pixel diff of a single state would miss, per phase:
- token count parity both themes (`check:theme`)
- no selector appears in both `styles.css` and a component (new guard)
- computed-value spot checks read from the live DOM (the measured `.toggle-opt` divergence above is exactly the kind of thing a screenshot at rest can hide)

---

## 6. Risks, tradeoffs, open questions

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Dark theme regressions** | High | Dual-theme is enforced by `check:theme`; every phase captures both themes; token additions require a dark counterpart. |
| **Specificity inversion when a local rule is deleted** | High | `Emulation` encapsulation already isolates most rules, but `styles.css` global rules are `(0,1,0)` and lose to component `(0,2,0)`. Deleting a local rule can *silently activate* a global one that was previously losing. Verify computed values live, not just screenshots. |
| **The 28kB `anyComponentStyle` budget** | Medium | `second-brain` is 50.4kB of source. Migration must shrink, never grow. Check the build warning after every file. |
| **Vendor-override breakage** | Medium | Protected-file list, enforced by the drift guard's allowlist. |
| **Scope creep into a redesign** | Medium | Pixel-identity is the gate; a "nicer" value is a build failure, and any intentional visual change becomes its own explicitly-requested PR. |
| **Two writers, one worktree** | Medium | `AGENTS.md`: own branch, explicit `git add` paths, never stash/reset. |
| **A guard that scans source can pass vacuously** | Medium | Non-vacuity assertions in every rule (file floor, per-file size floor, "the global sheet is inside the scan"), and prove each rule reddens against the pre-fix tree. |
| **Baseline drift from a stale build** | Medium | `service-runtime-alignment` discipline: before interpreting a diff, grep the served bundle for a token the change introduced. |

### Tradeoffs

- **The CSS will not get dramatically smaller.** Realistic reduction: 37% of declarations are exact duplicates of global ones, but many are 1–2 declarations (`display:flex`) that are clearer inline. Expected net: **10–20% fewer lines**, and a much larger reduction in *distinct ways to do the same thing* — which is the actual goal you stated.
- **More files, more indirection?** No — primitives live in `styles.css` (one owner), and docs live in `docs/design/`. Nothing new to load.
- **A guard with a seeded allowlist is weaker than a guard with none.** Deferred deliberately: 118 literal-colour sites cannot be fixed in one PR without a pixel-diff risk on each. The allowlist is a burn-down list, and the guard's job in v1 is to stop the number growing.

### Open questions — I need your call before implementing

1. **`.ds-field` focus treatment.** Brain/search uses a 3px `--color-accent-faint` (clay) ring; writing-studio and add-book-modal use a 2px `--border-focus` (slate) ring. These read differently on purpose or by accident — I cannot tell which from the comments. **Which is the house standard?** Clay reads warmer/editorial; slate reads more like the utility focus ring. This is a taste call and it changes what several surfaces look like after migration.
2. **`.ds-backdrop` blur.** add-book-modal blurs (`--modal-scrim-blur: 2px`), confirm-modal does not, and their z-index tiers differ (100 vs 120). The manifesto explicitly rules out frosted-glass gimmicks. **Unify on blur or on no-blur?**
3. **Brand-value drift.** The guidelines kit says forest `#293E32` / clay `#A07859`; the app ships `#28372D` / `#8A6D58`. **Which is authoritative?** If the kit, that is a deliberate visual change and needs its own PR (it will not pass a pixel gate).
4. **Extraction depth.** Should I also lift `.nav-item` / `.index-item` / `.tree-row` into one `.ds-row` primitive? The source comments document a deliberate three-way divergence (a pill with a shadow vs a filled row vs a tree row with a gutter chevron) that reads as intentional. **My recommendation: no — document it, don't unify it.** Confirm.
5. **The un-themed components.** `toast-container` (12 raw literals) and `star-rating` (`#fbbf24`) are the only two surfaces genuinely broken on dark. Both are currently visible/applied to content, so tokenising them is a *visible* dark-mode change, not a pixel-identical refactor. **Do you want them in this project (own PR, reviewed visually) or left alone?**
6. **Delegation.** Do you want this implemented by worker CLI(s) with my review, or made directly in-session? (Your standing preference is orchestration, but you sometimes want UI work by hand.)

**What I recommend approving first:** Phase 1 only (token contract + baseline + docs), as one PR. It is zero-visual-change, it is the prerequisite for everything else, and it settles the token vocabulary that every later phase depends on.
