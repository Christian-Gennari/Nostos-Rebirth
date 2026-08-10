# Reading Training Mobile Editorial Layout Implementation Plan

> **For Hermes:** Implement through bounded workers; main model owns design direction and final verification.

**Goal:** Replace the cramped, rounded-card Reading Training layout with a calm, flat, mobile-first reading sheet that exposes the current session first and uses straight rules—not curved containers—as its visual grammar.

**Architecture:** Preserve all Angular component boundaries and behaviour. Reorder existing page components for task priority, conditionally remove empty notices, and redesign the existing component CSS in place. No backend/API/model changes and no new UI library.

**Tech Stack:** Angular 20 standalone components, CSS, Vitest, Playwright.

---

## Design contract

### Register
Calm, editorial, practical. This is a personal reading instrument, not an analytics dashboard. Retain the existing Lora/Inter pairing and neutral palette.

### Signature
The three training modes are marked by one straight horizontal colour rule each. No curved coloured border, side stripe, glow, shadow, or hover lift.

### Explicit rejections
- no rounded card stacks for primary page sections;
- no card-inside-card nesting in Active books;
- no gradients, glass effects, decorative pills, shadows, or hover elevation;
- no shrinking controls below a 44px mobile touch target;
- no feature or copy changes beyond removing redundant empty-state framing.

### Target mobile order
1. Header + refresh
2. Plan/Capture toolbar
3. Today / open-session controls
4. Pending notices only when one or more exist
5. This week
6. Capacity lanes
7. Active books
8. Reading inbox
9. Session history

## Task 1: Lock mobile structure with tests

**Files:**
- Modify: `Nostos.Frontend/src/app/reading-training/reading-training.component.spec.ts`
- Modify: `Nostos.Frontend/e2e/reading-training.mobile.spec.ts`

**Steps:**
1. Add a component test proving an empty pending-notices collection does not render `app-pending-notices`; add a populated case proving it does.
2. Add Playwright assertions at 390x844 proving `.today-session` appears above `.capacity-lanes`, the page has no horizontal overflow, and each `.lane` has zero border radius and no side/bottom border while retaining a coloured top rule.
3. Add an assertion that the main section roots (`.week-strip`, `.today-session`, `.active-books`, `.reading-inbox`, `.session-history`) are not rounded card shells at mobile width.
4. Run the targeted tests and confirm the new expectations fail before implementation.

## Task 2: Reorder the page around the current action

**Files:**
- Modify: `Nostos.Frontend/src/app/reading-training/reading-training.component.html`
- Modify: `Nostos.Frontend/src/app/reading-training/reading-training.component.css`

**Steps:**
1. Move `app-today-session` and conditional feedback directly below the action toolbar.
2. Render `app-pending-notices` only when `store.pendingNotices().length > 0`.
3. Keep planner and other dialogs outside visual flow and preserve all focus-trap behaviour.
4. On mobile, reduce page horizontal padding to 16px, top padding to roughly 20px, header/action gaps, and section spacing while preserving bottom-nav clearance.
5. Preserve refresh-spinner geometry and all existing action bindings.

## Task 3: Replace dashboard cards with ruled sections

**Files:**
- Modify: `Nostos.Frontend/src/app/reading-training/components/week-strip/week-strip.component.css`
- Modify: `Nostos.Frontend/src/app/reading-training/components/today-session/today-session.component.css`
- Modify: `Nostos.Frontend/src/app/reading-training/components/pending-notices/pending-notices.component.css`
- Modify: `Nostos.Frontend/src/app/reading-training/components/reading-inbox/reading-inbox.component.css`
- Modify: `Nostos.Frontend/src/app/reading-training/components/session-history/session-history.component.css`
- Modify only if rendered inline: `Nostos.Frontend/src/app/reading-training/components/session-feedback/session-feedback.component.css`

**Steps:**
1. Remove outer background/border/radius card shells from the main section roots.
2. Give sections consistent vertical padding and a straight neutral top rule; the first actionable Today section should begin cleanly without excess top whitespace.
3. Tighten heading margins and body-copy measure; preserve legibility and empty-state direction.
4. On mobile, compact the week ledger into two rows without reducing text below existing readable sizes; keep Review week touch-safe.
5. Do not flatten modal/dialog form surfaces.

## Task 4: Redesign capacity as three straight ruled modes

**Files:**
- Modify: `Nostos.Frontend/src/app/reading-training/components/capacity-lanes/capacity-lanes.component.css`

**Steps:**
1. Remove lane background, rounded radius, side/bottom borders, shadow, transform, and hover transition.
2. Keep a 3px straight top border in the existing mode colour.
3. Desktop: retain three columns with quieter spacing and no fake card elevation.
4. Mobile: stack concise rows, reduce padding/min-height, and align mode name, target, and assigned-book line into a compact hierarchy.
5. Replace the rounded `VOLUME ONLY` pill with quiet utility text without a border or capsule.

## Task 5: Flatten Active books and improve mobile controls

**Files:**
- Modify: `Nostos.Frontend/src/app/reading-training/components/active-books/active-books.component.css`
- Modify HTML only if necessary for accessible grouping: `Nostos.Frontend/src/app/reading-training/components/active-books/active-books.component.html`

**Steps:**
1. Remove the outer card shell and mode-group rounded/background shells.
2. Give each mode group a straight coloured top rule matching the capacity modes. Use the same mode colours consistently across both components.
3. Remove queue-item rounded borders/background; use straight row separators.
4. Mobile: use a deliberate grid so position, title/source, reorder controls, and text actions align without a large blank action block. Keep every control at least 44px high.
5. Keep destructive `Finish training book` visually restrained and separate from primary actions.
6. Remove decorative pill borders for Default/Finished where plain utility text works.

## Task 6: Visual and behavioural verification

**Commands:**
- `npm exec -- ng test --watch=false`
- `npx playwright test`
- `npm run build`
- `git diff --check`

**Browser verification:**
1. Capture 390x844 viewport screenshots at the top, middle, and lower scroll positions using the deployed data shape containing Candide.
2. Compare against `/tmp/nostos-mobile-current-viewport.png`, `/tmp/nostos-mobile-scroll-1.png`, and `/tmp/nostos-mobile-scroll-2.png`.
3. Confirm Today is visible materially earlier, all content remains reachable above bottom navigation, no horizontal clipping appears, modal focus/Escape still works, and active-book controls remain usable.
4. Capture a 1440px desktop screenshot and ensure flattening did not create an unstructured wall of text.

## Task 7: Main-model review and deployment

1. Main model inspects the complete diff and fresh screenshots.
2. Dispatch an independent visual/code-quality reviewer after implementation is complete; repair any concrete findings.
3. Re-run backend only if TypeScript/templates changed in a way that touches contracts; otherwise frontend full suite + Playwright + production build are mandatory.
4. Commit, push to PR #28, update `/home/dev/coding/projects/nostos-rebirth`, rebuild, restart `PM2_HOME=/home/dev/.pm2 pm2 restart nostos --update-env`, and perform live 390px click-through verification.

## Risks / guardrails

- Do not use global overrides that alter unrelated Nostos pages.
- Preserve component encapsulation and existing CSS variables.
- Preserve all semantics, aria labels, keyboard/focus behaviour, and 44px touch targets.
- The untracked existing issue plan in `.hermes/plans/` is unrelated and must not be committed accidentally.
- Keep PR open and unmerged.
