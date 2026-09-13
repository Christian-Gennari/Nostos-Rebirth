> ⚠️ **SUPERSEDED — do not implement from this document.**
> Replaced by `.hermes/plans/2026-09-13_183500-nostos-design-language-v3.md`.
> Correct method (CSS-derived, no reliance on old docs), but it was measured
> against a **pre-merge build**: the app served on `:5214` was built at 17:22:10
> while commit `af719bc` landed at 17:54:01, so every screenshot and painted-value
> reading here is pre-PR-#94. Declaration-level findings survive unchanged (PR #94
> touched only dark override selectors in `styles.css`; token counts are identical
> before and after), **but `styles.css` line numbers here shift +15 after line 547**,
> and v3 adds the finding that matters most: the dark theme's second half is a
> 30-selector specificity ladder against Angular encapsulation.

# Nostos Unified Design Language — Implementation Plan (v2, CSS-derived)

> **Supersedes nothing — this is a fresh derivation.** The earlier draft (`2026-09-13_174330-nostos-unified-design-language.md`) is superseded: it leaned on `docs/design-manifesto.md`, `_brand-assets/06_Guidelines/brand-tokens.css` and an earlier dark-mode plan to decide what the design language *should* be. **Christian's correction: the brand grew incrementally, so old documents mislead. The CSS and the running app are the only source of truth.** This v2 derives every claim from the stylesheets and from values measured off live elements. No prior document is treated as authority.
>
> **Status: read-only. No application file was modified.** Plan: `.hermes/plans/2026-09-13_181500-nostos-design-language-css-derived.md`

**Goal:** Make the design language that *already exists* explicit, so repeated styling collapses into shared vocabulary and drifted duplicates converge — while the app's appearance is preserved and its uniqueness (a warm editorial palette, a serif/sans pairing, hairline borders, tight radii, a breathing wait-field) is left intact.

**Method (this matters):**
1. Read every declaration in every `.css` **and** in the 4 components whose CSS lives in `styles: [...]` blocks inside `.ts` files.
2. Measure what the app actually **paints** — a DOM sweep clustering computed values over 851+ live elements per surface, ×4 surfaces ×**both themes**.
3. Treat divergence between *declared intent* and *painted reality* as the finding, not the noise.
4. Invent no names. Where a primitive already has a name in the code, that name is the primitive.

---

## 1. What the CSS actually says — measured

### 1.1 Scale

| Metric | Value |
| --- | --- |
| Stylesheets | 23 → 11,229 lines |
| Rules / declarations | 1,290 / 5,561 (incl. `.ts` inline blocks) |
| Distinct declarations | 1,585 |
| Declarations that exactly duplicate one already in `styles.css` | ~2,000 (**37%**) |
| Hardcoded colours outside `styles.css` | 40 hex + 78 rgba |
| CSS living in `.ts` `styles: [...]` blocks | 436 lines / 4 components |
| `!important` | 136 |
| Theme token graph | 115 light / 80 dark; **1 dark-only token** (`--color-secondary`, no light counterpart) |
| Tests / gates | 297 unit tests (19s); `check:css` + `check:theme` (0.46s); `ng build` (7.6s); Playwright matrix (minutes) |

### 1.2 The design language, as painted

Measured on live elements across Library, Second Brain, Studio, Settings — light **and** dark. Where light and dark agree on the *set* of values, that is a theme-invariant axis.

**THEMED — colours invert, structure does not:**

| Axis | Painted values (distinct) |
| --- | --- |
| Ink | 12 light / 11 dark. Dominant: muted `rgb(92,90,85)`→`rgb(197,201,208)` 29%; main `rgb(28,27,26)`→`rgb(237,238,242)`; pine `rgb(40,55,45)`→`rgb(168,175,187)`; light `rgb(138,134,128)`→`rgb(148,156,169)`; placeholder `rgb(168,163,156)`→`rgb(74,82,96)`; faint `rgb(207,202,194)` |
| Surface | 15 light / 18 dark. `--bg-surface`, `--bg-hover`, `--bg-body`, `--bg-surface-alt` + 4 overlay/scrim values |
| Hairline | `rgb(228,225,219)` → `rgb(38,42,52)` — **the** 1px border, 47/43 sites |
| Shadows | 6 light / 6 dark. Dominant `rgba(0,0,0,.1) 0 2px 4px` (44%) |

**THEME-INVARIANT — identical in both themes:**

| Axis | Painted values |
| --- | --- |
| **Radius** | 10 distinct: `0` (81%), `50%` (6%), `999px` (4%), `6px` (3%), `3px` (3%), `4px` (2%), `8px`, `12px`, `24px`, `5px` |
| **Weight** | **exactly 3**: 400 (71%), 500 (18%), 600 (10%) |
| **Family** | **exactly 2**: Hanken Grotesk 99%, Newsreader 1% |
| **Gap** | 14 distinct: 4px (28%), 16px (20%), 2px (17%), 6px (11%), 10.4px, 8px, 12px… |
| **Padding** | 20 distinct: 8px (17%), 7.2px (10%), 5px (9%), 3px (8%), 4px (7%), 16px (7%), 9.6px, 14px… |
| **Duration** | 8 distinct: **0.2s** (38%), 0.15s (23%), **0.16s** (19%), 0.12s (13%), 0.22s, 0.32s, 0.3s |
| **Easing** | 5 distinct: **`ease`** (84%!), `cubic-bezier(0.16,1,0.3,1)` (10%), `linear` (3%), plus `--ease-standard` and `--ease-spring` at 2% each |

**The effective type scale (text-bearing elements only, 338 measured):** 18 distinct sizes, but 9 cover 91%:

`10px` · `10.88px` · `11.52px` · `12px` · `12.8px` · `13.6px` · `14.08px` · `14.4px` · `16px` — plus `13.12`, `14`, `15.2`, `21.6`, `22.4`, `24`, `28`, `35.2`

### 1.3 The findings that matter

**F1 — The motion tokens are largely bypassed, and the bypass is 84% `ease`.**
`--ease-standard`, `--ease-out`, `--ease-spring` exist. Measured on painted elements, **84% of transitions run on plain `ease`** — only 10% use `--ease-out`. `--motion-fast/base/slow` (160/220/320ms) are bypassed too: the painted durations are 0.2s, 0.15s, 0.16s, 0.12s, 0.22s, 0.32s, 0.3s. The token names promise a motion language the app does not speak. **This is the single largest token-vs-reality gap.** It also means "0.16s" (19%) and "0.15s" (23%) are two conventions for the same thing.

**F2 — The typography scale has four near-identical rungs.**
`13.6` / `14` / `14.08` / `14.4` are four sizes within 0.8px of each other and together are 21% of all text. Similarly `10` / `10.88` / `11.52` / `12` sit within 2px. These are almost certainly not deliberate distinctions — they are drift (0.85rem vs 0.88rem vs 0.9rem). The tokens `--text-xs` etc. are declared and **never used** (`--text-base/lg/xl/2xl` = 0 uses; only `--text-xs`/`--text-sm` are used at all).

**F3 — The segmented-control family is one control with five implementations, and the drift is *functional*, not cosmetic.**
Measured on both themes:

| Surface | Class | Inactive | Active fill | Active outline | Height |
| --- | --- | --- | --- | --- | --- |
| Library | `.toggle-opt` | transparent | `--bg-surface` | **1px `--border-color`** | 30px |
| Brain | `.toggle-opt` | transparent | `--bg-surface` | **1px `--border-color`** | 30px |
| Studio | `.tab-btn` | transparent | `--bg-surface` | 1px `--border-color` | 31px |
| Settings | `.theme-opt` | transparent | `--bg-surface` | **none** | 31px |
| Studio | `.icon-btn` | `--bg-surface` | *no active state* | none | 36px |

Two things to note. **(a)** In `light`, Library/Brain/Studio resolve `active` to exactly the same values; in `dark` the same three resolve to **two different fills** (`#323A48` for Library/Brain vs `#1B1E26` for Studio) because `styles.css` overrides `.toggle-opt.active` for dark but `.tab-btn.active` is not covered. Same light appearance, different dark appearance — the classic shape of drift that a light-only review cannot see. **(b)** Settings' `.theme-opt` is the same control minus the active outline, and Studio's `.icon-btn` is the odd one out: it carries a **surface fill while inactive**, so it reads as permanently selected next to the toggles.

**F4 — 22 focus rings, plus a second focus treatment that is a different colour.**
`outline: 2px solid var(--focus-ring)` appears 22× across 6 files, with `outline-offset` taking five values (`-3px`, `-2px`, `-1px`, `1px`, `2px`). Separately, three search surfaces focus with `box-shadow: 0 0 0 3px var(--color-accent-faint)` (a clay ring) while another three use `0 0 0 2px var(--border-focus)` (a slate ring) — visually different treatments for the same state.

**F5 — `transition: all` on 23 elements, including elements that change size on hover.**
23 sites. Because `all` includes layout properties, a hover that changes padding or width animates layout. The repo has this documented as a defect elsewhere; the CSS still carries the pattern. Painted `transition-property: all` confirmed on `.sort-select`, `.btn-secondary` and others.

**F6 — Preflight is missing, so Chrome's UA `button` styling leaks.**
The reset is `* { margin:0; padding:0; box-sizing:border-box }`. There is no `font: inherit` on controls — only `button { font-family: inherit }` in `styles.css`. Measured at `13.3333px`: **94 `button` elements plus their 94 `lucide-icon` and 94 `svg` children** — 517 painted nodes resolving to Chrome's UA default rather than a designed size. The `<svg>`/`<path>` children inherit it, so one unpinned parent fans out across the tree. `styles.css` is the only sheet in the app without `:host` scoping, so putting the fix there corrects every surface at once.

**F7 — 4 global classes are dead; the `--space-*` and `--text-*` scales are inert.**
Dead classes (verified by searching `.html` **and** the inline templates inside `.ts`): `.btn-lg`, `.glass-panel`, `.gradient-edge`, `.wait-field--breath`. Dead tokens (21): every `--space-*` (5), `--text-base/lg/xl/2xl` (4), `--shadow-lg`, `--overlay-heavy`, `--glass-blur-strong`, `--editor-ui-bg-active`, `--gradient-accent`, `--gradient-pastel-soft`, and all five legacy `--pastel-*`.

**F8 — 11 shadow tokens live in a `.ts` file, invisible to the token guard.**
`markdown-editor.component.ts` declares `--ink`, `--ink-soft`, `--ink-faint`, `--paper`, `--rule`, `--rule-strong`, `--code-bg`, `--code-ink`, `--link`, `--link-hover`, `--selection` — a second vocabulary for roles `styles.css` already names. `check-theme-tokens.mjs` reads `styles.css` only, so these are unguarded and unthemed by construction.

**F9 — Two components paint raw literals that do not track the theme.**
`toast-container.component.ts`: 12 literals (`#1a1a1a`, `#e0e0e0`, `#ffffff`, `#f87171`, `#4ade80`, `#818cf8`, `#888`, `rgba(0,0,0,.1)`). `star-rating.component.ts`: `#fbbf24`, `#c5c7cc`. Verified live: toasts paint `rgba(18,18,18,.82)` **in both themes**.

**F10 — Some theme-invariance is deliberate and must not be "fixed".**
`rgba(255,255,255,0.22)` paints on 20 borders in **both** themes — verified as `.format-badge`, a chip that sits **on cover artwork**, not on the page ground. It correctly does not invert. Likewise `.cover-disc-*`, `--brand-shape`/`--brand-doorway`, `--graph-node` and the `--modal-scrim` family are theme-aware but intentionally constant across the app's own surface ladder. **A naive "make everything themed" sweep would break these.** They belong on an explicit invariant list.

**F11 — Token names promise roles the values contradict.**
`--color-primary` is declared as "legacy alias" pointing at a *different* value from `--primary-ink`/`--primary-fill` in dark, and is read as a foreground by many rules. `--danger-ink` resolves to `#F0F2F5` (porcelain) on dark — its one consumer is a mark on a filled danger surface. Both are load-bearing traps: the name suggests a hue, the value is a role. Any migration must consult values, never names.

**F12 — Structural repetition that is *not* worth extracting.**
`display: flex` 208×, `align-items: center` 176×, `color: var(--color-text-muted)` 79×, `position: relative` 67×, `cursor: pointer` 65×. These are one-to-three-declaration idioms that read clearly inline. Extracting them would add a class attribute to hundreds of template nodes and make the CSS less legible. **Deliberately out of scope** — see §2.

---

## 2. What "unified design language" means here

You asked to *preserve uniqueness while reducing repetitive styling*. Given F12, the honest framing is:

**This is a vocabulary + convergence project, not a file-size project.** Expect roughly **10–20% fewer CSS lines**, and a much larger reduction in *the number of distinct ways the app does the same thing* — which is the actual complaint. Specifically:

- **Converge**, don't rewrite: bring the drifted implementations of an existing, already-named control onto one implementation.
- **Name what has no name**: the focus ring, the hairline, the motion steps.
- **Retire what is inert**: F7's dead classes and tokens.
- **Leave the character alone**: the palette, the serif/sans pairing, the hairlines, the tight radii and the wait-field are load-bearing identity. Nothing here changes them.
- **Do not invent a prefix or a parallel naming scheme.** The existing global classes are unprefixed (`.btn`, `.badge`, `.tag`, `.icon-btn`, `.toggle-opt`). New primitives adopt the **existing** names — `.toggle-opt` already exists in two files; promoting it is the primitive. Inventing `.ds-*` would add a third convention to a codebase that has two.

**Excluded on purpose (YAGNI):**
- No preprocessor, no Tailwind, no token build step.
- No atomic utility classes.
- No restructuring of `display`/`position`/`cursor` idioms (F12).
- No template restructuring beyond adding a class attribute.
- No theme-system change: dual-theme is live and verified, so every colour token needs a dark counterpart.
- Protected from any sweep: `src/tinymce-nostos.css`, `src/app/reader/pdf-reader/**`, the `::ng-deep` blocks in `writing-studio` and `second-brain`, and the vendor skin inside `markdown-editor.component.ts` — these override third-party DOM (`tox-*`, PDF.js `#viewerContainer`) that the app does not own.

---

## 3. The plan

Branch + PR per phase; never commit to `main`. Each task is 2–5 minutes.

### Phase 0 — Make the baseline trustworthy

**0.1 Capture the baseline properly, both themes.** I captured 8 screenshots this session into `.hermes/plans/evidence/` (library/brain/studio/settings × desktop/mobile) plus `painted-values.json`. Formalise it as `scripts/capture-baseline.mjs` driving CDP, writing `evidence/baseline/<surface>-<viewport>-<theme>.png` **and** the painted-value JSON. Run: `npm start` then `node scripts/capture-baseline.mjs`. Expected: 16+ PNGs stable across two consecutive runs.
**Why first:** a CSS refactor compiles perfectly while changing every surface. Without a pixel baseline, every later phase is unverifiable.

**0.2 Pin the served build to the source.** Confirm `npm run prod` is not serving a stale bundle before interpreting any measurement (grep the served CSS for a token the change introduces).

### Phase 1 — Tokens: converge and retire (F1, F7, F8, F11) — zero visual change

**1.1 Publish the measured scales as tokens.** In `styles.css`, name what the app already paints:
- **Motion**: keep `--motion-fast/base/slow` and `--ease-standard/out` but **document the painted reality** — 84% of transitions use `ease`. Two options, Christian's call (§5 Q1): (a) add `--ease-plain: ease` and migrate the 84% to it so the value is at least named and centrally changeable, or (b) migrate the 84% onto `--ease-standard`/`--ease-out`, which is a *visible* easing change. **Recommend (a)** — it makes the token honest without touching pixels.
- **Radii**: add `--radius-pill: 999px` and `--radius-round: 50%` (they cover 10% of painted radii and are currently magic numbers). Keep `--radius-sm/md/lg` values as-is; they are used.
- **Focus**: add `--focus-ring-width: 2px`; keep the five offsets but document which surface type each belongs to, since the variation is partly intentional.
- **Type**: reconcile the four near-identical rungs (F2). **This is a taste decision** (§5 Q2) — the options range from "do nothing, just document" to "collapse 13.6/14/14.08/14.4 to two".
- Verify: `npm run check:theme` → PASS. Non-colour tokens must be added to the `INVARIANT` regex in `check-theme-tokens.mjs`, **extending the existing pattern, not adding a second list**.

**1.2 Retire the inert.** Delete the 4 dead classes and the 21 dead tokens (F7). Delete both sides of any light/dark pair together or `check:theme` will complain.
- Verify: `npm run check && npm test`. Expected: PASS. Then grep the built bundle to confirm no runtime reference existed.

**1.3 Give the `.ts` tokens a home (F8).** Either map `markdown-editor`'s 11 tokens onto the existing global roles, or declare them deliberately in `styles.css` with a comment saying they are editor-chrome-local. **Do not leave them invisible to the guard** — that is the actual defect.
- Verify: `npm run check && npm test && npm run build`.

**1.4 Do not "fix" the invariants (F10).** Write down the deliberate theme-invariant list — `.format-badge` on artwork, `.cover-disc-*`, `--brand-*`, `--graph-node`, `--modal-scrim*` — so a later sweep has a stated allowlist instead of a judgement call.

### Phase 2 — Convergence: one implementation per control

Each task: define the shared rule in `styles.css`, migrate the surfaces, delete local duplicates, prove the pixel diff for **both themes**.

**2.1 `.toggle-opt` — the segmented control (F3, the biggest win).**
Promote the existing `.toggle-opt` + `.toggle-opt.active` into `styles.css`; migrate Library, Brain, Studio's `.tab-btn`, Settings' `.theme-opt`, and decide Studio's `.icon-btn`.
Must resolve first: **the dark-mode divergence** (Library/Brain `#323A48` vs Studio `#1B1E26`) and **whether `.theme-opt`'s missing active outline is intended** (§5 Q3). Also decide Studio's `.icon-btn` — I read its always-filled inactive state as a defect, but it may be deliberate for a toolbar button.
Impact: 4 surfaces, 2 implementations, one unresolved light/dark split.

**2.2 `.icon-btn` (F3/F12).** Five implementations today: global (`32×32, all: unset`), Library (`28×28` + tooltip), reader-shell (`44×44` + a mobile block that reverts hover to `transparent`), Studio (`padding:4px`, `transition: all`), note-card (`border-radius: 50%`). Unify onto `--control-h` + `--radius-sm`; keep tooltip and circular variants as explicit modifiers. Verify the reader-shell mobile hover-revert is preserved (it is documented as deliberate).

**2.3 The field family.** `.search-box` (Brain: absolute icon + 3px clay focus ring; Studio: flex row + 2px slate focus ring) and `.sort-select` (Library: no `min-height`; Brain: `min-height: 39px`). Unify the field anatomy **and settle the focus treatment** (§5 Q4) — this is the one place where two genuinely different visuals are both in production.

**2.4 The focus ring (F4).** One rule consuming `--focus-ring-width`, with documented inset/outset variants rather than flattening the five offsets. Preserve the two dark-theme overrides (`#A9B6C6` on the active nav row) — they exist because an inset ring on a *filled* row needs a lighter colour.

**2.5 Kill `transition: all` (F5).** Replace all 23 with explicit property lists. Highest-risk item for size-changing hovers: **check each one for a layout property before converting**, and A/B the hover in both themes.

**2.6 Preflight the leak (F6).** Add an inherit rule for form controls to `styles.css` (the only unscoped sheet). **This is the one item I expect to change pixels** — 517 nodes move from 13.3333px to their inherited size — so it must be its own PR with before/after evidence per surface, not folded into a token change.

**2.7 The un-themed components (F9).** `toast-container` (12 literals) and `star-rating` (`#fbbf24`) onto tokens. This is a *visible* change on dark, so it is its own PR reviewed as a design change, not a refactor.

**2.8 `.modal-backdrop` / `.empty-state` / `.visually-hidden` / `.divider`.** Lower-priority convergence: measured duplicates, all cosmetic-only differences. `.visually-hidden` is byte-identical in 3 files with a 4th copy renamed `.library-title`; `.modal-backdrop` differs only in z-index (100 vs 120) and whether it blurs; `.empty-state` has 4 unrelated layouts (keep as modifiers, do not flatten).

### Phase 3 — Enforcement

**3.1 `scripts/check-design-drift.mjs` → `npm run check:design`, appended to `check`.**
Model it on `src/app/ui/motion-contract.spec.ts`, the repo's proven template — **including its non-vacuity guards** (file-count floor, per-file size floor, and "the global sheet must be inside the scan"). Rules, each naming the defect it prevents:
1. **Duplicate-selector scan** — fail if a component redeclares a selector `styles.css` owns. Allowlist the protected vendor files with reasons.
2. **Literal-colour scan** — fail on hex/rgba outside `styles.css` unless the line carries an ignore marker. **Seed the allowlist from the real 118 sites** so the guard ships green and the list only shrinks.
3. **Motion-token scan** — fail on `transition: all` and on durations that are not a token.
4. **Undeclared-token scan** — every `var(--x)` must resolve in `styles.css` or in its own file, **and the scan must include the `.ts` inline-style blocks** (that is where F8 hid). 33 legitimate component-local tokens must still pass, so the rule is "declared somewhere reachable".
5. **Theme completeness for `.ts` tokens** — extend `check-theme-tokens.mjs` to parse `styles: [...]` blocks.

**Every rule must be proven red against the pre-fix tree before it is trusted.** A rule whose allowlist already contains its own violations guards nothing.

**3.2 Pixel-identity gate.** `e2e/design-identity.spec.ts` **plus a `mobile-`prefixed twin** — the Playwright config filters projects by **filename**, so a mis-named spec silently runs desktop-only. Assert max channel delta ≤1/255 against the committed baseline, both themes.

**3.3 Docs + PR gate.** `docs/design/design-language.md` (the measured scales, the role/surface contract, the invariant list from 1.4, the anti-patterns from F3/F5/F6) and `docs/design/tokens.md` generated from `styles.css` so it cannot go stale. Extend the PR template with a CSS-change block: tokens touched, pixel-diff result, exact commands.

### Phase 4 — Migrate surface by surface, one PR each

Ordered by measured duplication density, lowest risk first:

1. `ui/concept-input`, `ui/concept-autocomplete-panel`, `ui/note-card` (42–59% of declarations already exist globally; also resolves Brain's 21 `:host ::ng-deep app-note-card` overrides)
2. `library/sidebar-collections` (43%)
3. `settings` (44%) — settles the `.toggle-opt`/`.theme-opt` question cheaply
4. `add-book-modal` + `ui/confirm-modal` — settles backdrop + empty-state
5. `writing-studio` (42%) — `.tab-btn` → `.toggle-opt`; the zen `:host-context` block stays
6. `library` (42%, 617 declarations, 37.9kB source, 219 `.btn` + 125 `.input` uses)
7. `second-brain` (44%, 900 declarations, **50.4kB source**) — **watch the 28kB `anyComponentStyle` warning / 30kB error budget: migration must shrink this file, never grow it**
8. `book-detail` (42%, 701 declarations) — highest regression risk, last
9. `reader/*` (reader-shell, epub, audio) — `pdf-reader` stays untouched
10. the `.ts` inline-style components (dock, toast, star-rating, markdown-editor)

---

## 4. Files likely to change

**Created:** `docs/design/design-language.md`, `docs/design/tokens.md`, `scripts/check-design-drift.mjs`, `scripts/doc-tokens.mjs`, `scripts/capture-baseline.mjs`, `e2e/design-identity.spec.ts` + `e2e/mobile-design-identity.spec.ts`, `e2e/visual-evidence/design-baseline/*`, `.github/PULL_REQUEST_TEMPLATE.md`.

**Modified (heaviest first):** `src/styles.css`; `second-brain.component.css` (50.4kB); `library.component.css` (37.9kB); `book-detail.component.css` (37.2kB); `ui/flat-tree`; `writing-studio`; `sidebar-collections`; `reader/reader-shell`, `audio-reader`, `epub-reader`; `settings`; `add-book-modal`; `ui/confirm-modal`, `ui/note-card`, `ui/concept-*`; `second-brain/concept-map`; the inline blocks in `layout/app-dock`, `ui/toast-container`, `ui/star-rating`, `ui/markdown-editor`; `scripts/check-theme-tokens.mjs`; `package.json`; `AGENTS.md`; the `.html` templates for each migrated primitive (class attribute only).

**Not touched:** `src/tinymce-nostos.css`, `src/app/reader/pdf-reader/**`, the `::ng-deep` vendor skins.

---

## 5. Tests, risks and open questions

### Gates

| Gate | Command | Cost | When |
| --- | --- | --- | --- |
| CSS integrity | `npm run check:css` | <1s | every change |
| Theme graph | `npm run check:theme` | <1s | every change |
| **Design drift (new)** | `npm run check:design` | <1s | every change |
| Unit (297) | `npm test` | 19s | before commit |
| Build | `npm run build` | 8s | before push |
| **Pixel identity (new)** | `npx playwright test design-identity` | ~30s | before each PR |
| Visual matrix | `npm run e2e` | minutes | on request |

Plus per-phase structural assertions a screenshot cannot make: token-name parity across themes; no selector in both `styles.css` and a component; computed values read from the live DOM (which is exactly how F3's dark-only divergence was found).

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Dark-theme regression** | High | Dual-theme verified live. Every phase captures both. F3 proves this risk is real: the toggle family already diverges *only* on dark. |
| **Silent specificity inversion** | High | Deleting a local rule can activate a global `(0,1,0)` rule that was previously losing. Verify computed values live, not screenshots. |
| **The 28kB component-style budget** | Medium | `second-brain` is 50.4kB of source. Check the build warning after every file. |
| **"Fixing" a deliberate invariant** | Medium | F10's allowlist, stated before any sweep. |
| **Preflight changing 517 nodes** | Medium | Isolated to 2.6, own PR, before/after evidence per surface. |
| **Scope creep into a redesign** | Medium | Pixel gate; any intentional visual change becomes its own explicitly-approved PR. |
| **A source-scanning guard passing vacuously** | Medium | Non-vacuity assertions in every rule; prove each rule reddens on the pre-fix tree. |
| **Concurrent writers in one worktree** | Medium | `AGENTS.md`: own branch, explicit `git add` paths, never stash/reset, commit as soon as a change is verified. |

### Open questions

1. **Motion: name the existing easing, or change it?** 84% of transitions run on plain `ease` while `--ease-out`/`--ease-standard` sit mostly unused. **My recommendation: add a token for `ease` and migrate the majority onto it** — the value becomes central and changeable without moving a pixel. The alternative (migrate onto `--ease-standard`) *is* a visible change across most of the app. Which do you want?
2. **Type scale: leave the four near-identical rungs, or collapse them?** `0.85` / `0.875` / `0.88` / `0.9rem` are within 0.8px and are 21% of all text. Collapsing to two is the single biggest legibility/consistency win available — but it changes text size by up to 0.8px on a fifth of the UI, so it cannot be a "refactor". Do nothing (document only), or collapse — and if collapse, how aggressively?
3. **The segmented control's dark divergence.** Library/Brain's active segment is `#323A48` on dark; Studio's is `#1B1E26`. Which is correct, and is Settings' missing active outline intentional? I cannot tell from the code.
4. **Focus treatment: two different visuals are in production.** Brain and Library search use a 3px clay ring (`--color-accent-faint`); Studio search and the add-book modal use a 2px slate ring (`--border-focus`). **Which is the house standard?** Clay is warmer/editorial, slate reads as a utility affordance. Real taste call, and it changes several surfaces after migration.
5. **Optional: product names for the tokens.** If you want the design language to be *documentable as a brand* (e.g. "paper", "pine", "clay", "mist", "slate"), I can add alias names over the existing ones — the CSS contains no product vocabulary beyond `--brand-*`, and you may want that. Zero risk, pure additive. Say the word and I'll propose names derived from the actual values.
6. **Delegation:** worker CLI(s) with my review, or by hand in-session?

**Recommended first step:** Phase 0 + Phase 1 only, as one zero-visual-change PR. It makes the vocabulary honest, deletes what is inert, and gives every later phase a baseline to prove itself against.

### One honest caveat

My first pass at this audit contained three errors that only re-measurement caught, and the pattern is worth stating because it shapes how this must be verified: I initially reported `.app-dock-container`, `.dock-item` and `.bloom-art` as dead classes (they live in **inline templates inside `.ts` files**, invisible to an `.html`-only search); I reported Brain's toggle as "permanently active" (my probe took `querySelector`'s *first* match, which happened to be the selected option); and I reported a font-size cluster of 517 as a design scale before confirming it was the UA default. **Every claim in §1 has been re-measured since; but any future count taken by a script needs the same scepticism, and a guard that scans source must be shown to fail on real violations before it is trusted.**
