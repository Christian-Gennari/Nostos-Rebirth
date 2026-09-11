# Library Filter Cross-Fade + Toolbar Stability Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Isolate in a git worktree (never edit the live `main` checkout while a worker runs); the owner commits on `main` afterward, no feature branch is required for *delivery*, but implementation must not race with the current uncommitted `book-detail` changes in the main checkout.

**Goal:** Replace the jittery ghost/skeleton reload and the title-driven toolbar shift on the library page with one cinematic, layout-stable transition: the old results blur and fade out while the new ones fade in, and the title cross-fades inside a reserved box that never moves the search bar.

**Architecture:** Two independent defects with two independent fixes, both landing in the existing `library` component.
1. *Loading model:* the component currently treats every data refresh as a first paint (`loading` → skeleton). Split it into **initial load** (skeleton, allowed exactly once) and **refresh** (`swapping` → in-place blur/fade of the *existing* results, no skeleton, no DOM replacement until the out-phase has finished). A monotonic request sequence number makes the held-back commit safe under rapid filter changes.
2. *Toolbar geometry:* `.toolbar` is `display:flex; justify-content:space-between`, so the `h1` is a content-sized flex item and `.search-bar-container { flex: 1 }` absorbs whatever is left — the search field's left edge is a function of the title string length. Convert the desktop toolbar to a 3-track CSS grid whose title track is a fixed fraction and whose search track is `minmax(280px, 480px)`; the search field's position then depends only on the viewport width. The title text itself is animated with the *native* Angular animation API (`animate.enter` / `animate.leave`, already used by `sidebar-collections` and `second-brain`) inside an absolutely-positioned, fixed-height stack, so old and new titles cross-fade in the same box.

**Tech Stack:** Angular 21.2 standalone components + signals, `ChangeDetectionStrategy.OnPush`, native `animate.enter`/`animate.leave` (no `@angular/animations` dependency — it is intentionally not installed), plain component CSS with the existing `--motion-*` / `--ease-*` tokens, Vitest through the Angular test builder (`npx ng test --watch=false`), Playwright visual/geometry harness (`npm run e2e`).

---

## 1. Root-cause audit (verified against the current source)

All line numbers are the state of `main` at plan time (`git status`: only `book-detail.*` modified, plus untracked `ui/delete-book-modal/`).

| # | Symptom the user reports | Cause | Evidence |
|---|---|---|---|
| A | "fake ghost loading, very jittery" on filter | `loading` is set to `true` by **every** refresh, and the template swaps the entire results DOM for a skeleton branch | `library.component.ts:249-252` (`if (showSkeleton) this.loading.set(true)`), `library.component.html:89` (`@if (loading())`) vs `:146` (`@if (!loading())`) |
| B | Same jitter | The skeleton is a *different* subtree: 12 grid items (`library.component.html:130`) / 10 list rows (`:99`) versus the real first page of **20** items (`library-preferences.service.ts:19` → `pageSize: 20`, `library.component.ts:266`), so the document height and the scrollbar flip twice per filter change |
| C | Same jitter | Skeleton metrics ≠ real card metrics: `.skeleton-line` is `height:1.5rem; margin-bottom:.75rem` (`css:752-755`) while real `.meta-title`/`.meta-author` are `1rem`/`.85rem` with `0.2rem` gap (`css:702-713`) — even at equal item counts the last row's bottom edge moves |
| D | "Pushes the rest of the UI — especially the search bar — left and right" | `.toolbar` is `display:flex; justify-content:space-between` (`css:63-79`), `h1` is content-sized with no basis (`css:81-89`), `.search-bar-container { flex: 1; max-width: 480px }` (`css:136-142`) → the search field's `x` is a direct function of `pageTitle()`'s rendered width |
| E | "Library view jumping around" (chips) | `@if (activeFilterChips().length > 0)` mounts/unmounts a ~2.2rem row per filter toggle (`html:60-69`), shifting the whole grid |
| F | *(not reported, but adjacent)* | Rapid filter clicks can land a stale response last — `refreshBooks` has no sequence guard, last-write-wins by network order |

Nothing about the *result ordering*, the API contract, the sidebar, or the infinite-scroll sentinel is broken. This plan does not touch them.

## 2. Interaction spec (the visual contract to implement)

**Results transition (`reset` refreshes only — filter, sort, search, chip clear, add/edit refresh):**

1. `t = 0 ms` — request fires, `swapping = true`. `.results-stage` transitions **to** blurred: `opacity 1 → 0.35`, `filter blur(0) → blur(5px)`, `transform scale(1) → scale(0.995)`, over **180 ms** (`--motion-out`). The old books are still on screen the whole time — no skeleton, nothing is unmounted.
2. `t = max(response, 180 ms)` — the response is already in hand, so the DOM is replaced *at the bottom of the blur*, invisibly, then `swapping = false`. The stage transitions **out of** the swap state over **260 ms** (`--motion-in`), so the new books resolve from blurred to sharp while fading up. Net effect: old blurs away, new resolves in, one continuous motion, zero flash.
   - Network time counts toward the 180 ms, so a fast local API (~30 ms) still gets the full out-phase instead of a 1-frame blink.
3. Never for `loadingMore()` (infinite scroll appends in place, untouched), never for `refreshBooks(true, false)` (`onBookUpdated` — an in-cell edit must not blur the list it just updated), never under `prefers-reduced-motion: reduce` (commit immediately).

**Title transition:** on every change of `pageTitle()`, the outgoing title plays `title-swap-out` (180 ms: fade + blur 8px + 3px rise) while the incoming one plays `title-swap-in` (260 ms from fade + blur + 3px drop). Both live in the identical absolute box inside a fixed-height `h1`, so **nothing in the toolbar can move** regardless of title length or transition state.

**Title animation technique:** `@for (t of [pageTitle()]; track t) { <span animate.enter animate.leave> }` — tracking by the title string means Angular creates a new block exactly when the title value changes (identical titles re-render nothing) and destroys the old one; `animate.leave` keeps the outgoing span mounted until its animation ends, giving a true cross-fade with **zero** TypeScript added and **synchronous** text updates (which the existing spec asserts).

**Non-goals:** no spinner, no progress bar, no change to the skeleton's own look (it stays for the genuine first paint), no new dependency, no Angular animations package, no `@defer`, no route/view-transition change.

---

## 3. Files in scope

- Modify: `Nostos.Frontend/src/app/library/library.component.ts`
- Modify: `Nostos.Frontend/src/app/library/library.component.html`
- Modify: `Nostos.Frontend/src/app/library/library.component.css`
- Modify: `Nostos.Frontend/src/app/library/library.component.spec.ts`
- Modify: `Nostos.Frontend/e2e/support/visual-capture.ts` (one new geometry check)
- Modify: `Nostos.Frontend/e2e/visual-regression.spec.ts` (call the new check in the two existing library tests)

**Out of scope / protected (must show an empty diff):**
`sidebar-collections/**`, `core/services/books.service.ts`, `core/services/library-preferences.service.ts`, `library-filter.service.ts`, `styles.css`, `route-transitions.css`, `book-detail/**`, `ui/delete-book-modal/**`.
Do not add a new PNG artifact to the visual matrix (that would require editing `docs/visual-verification.md`'s documented 10-image matrix); wire the new check into the existing `library-filters-desktop` / `library-filters-mobile` tests instead.

---

## 4. Tasks

### Task 1: Introduce the swap timing contract

**Objective:** Name the two durations in one place per runtime so CSS and TS cannot silently drift.

**Files:** Modify `Nostos.Frontend/src/app/library/library.component.ts` (top, after `VIEW_MODE_STORAGE_KEY`).

**Step 1: Add the constants**

```ts
/**
 * Results cross-fade timings. The out-phase is deliberately the *same*
 * wall-clock budget as `--library-swap-out` in library.component.css
 * (one visual contract, two runtimes — keep them equal).
 */
const SWAP_OUT_MS = 180;
const SWAP_IN_MS = 260;

/** True when the OS asks for reduced motion; the swap then commits instantly. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
```

**Step 2: Verify** — `npx ng build` green (constants unused yet; `SWAP_IN_MS` is used in Task 6).

No commit yet (Task 2 uses them); commit at the end of Task 2.

---

### Task 2: Split "initial load" from "refresh" and hold the commit until the out-phase ends

**Objective:** The skeleton renders for the first paint only; later refreshes blur the existing results instead, and a stale response can never land.

**Files:** Modify `Nostos.Frontend/src/app/library/library.component.ts` (`import` block, fields near `:141-147`, `refreshBooks` at `:249-297`).

**Step 1: Write the failing spec first** — append to `library.component.spec.ts` (needs `Subject` from `rxjs`, already imported in the component, not the spec — add `import { Subject, of } from 'rxjs';`, and keep `of`):

```ts
it('does not show ghost/loading skeleton on a filter change after the first load', () => {
  expect(component.loading()).toBe(false); // beforeEach already flushed the first response

  component.filters.toggleStatus('reading');
  TestBed.flushEffects();

  expect(component.loading()).toBe(false); // no skeleton swap
  expect(component.swapping()).toBe(true); // cross-fade instead
});

it('holds the new results until the out-phase elapses, then reveals them', () => {
  vi.useFakeTimers();
  try {
    const book = { id: 'b1', title: 'Held', isFavorite: false, progressPercent: 0 } as never;
    listSpy.mockReturnValueOnce(of({ items: [book], totalCount: 1 } as never));

    component.filters.toggleStatus('finished');
    TestBed.flushEffects();
    expect(component.rawBooks()).toEqual([]); // still the old (empty) page

    vi.advanceTimersByTime(200);
    expect(component.rawBooks()).toEqual([book]);
    expect(component.swapping()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('ignores a stale response that arrives after a newer filter change', () => {
  const pending: Subject<PaginatedResponse<never>>[] = [];
  listSpy.mockImplementation(() => {
    const subject = new Subject<PaginatedResponse<never>>();
    pending.push(subject);
    return subject;
  });

  component.filters.toggleStatus('reading');
  TestBed.flushEffects();
  component.filters.toggleStatus('finished');
  TestBed.flushEffects();

  const newer = { id: 'new', title: 'Newer' } as never;
  const stale = { id: 'old', title: 'Stale' } as never;
  pending[1].next({ items: [newer], totalCount: 1 } as never);
  pending[1].complete();
  pending[0].next({ items: [stale], totalCount: 1 } as never); // late, must be dropped
  pending[0].complete();

  expect(component.rawBooks()).toEqual([newer]);
});
```

**Step 2: Run to verify failure** — `npx ng test --watch=false` → the three new specs fail (`swapping` is not a function / no timer hold). Record the exact failures.

**Step 3: Implement.** Add `PaginatedResponse` to the `../core/dtos/book.dtos` import. Replace the state fields and `refreshBooks`:

```ts
  loading = signal(true); // first paint only — the skeleton's single legitimate use
  loadingMore = signal(false);
  /** True while the existing results blur out before the new page is swapped in. */
  swapping = signal(false);

  private hasLoadedOnce = false;
  private requestSeq = 0;
  private swapStartedAt = 0;
```

```ts
  refreshBooks(reset = true, showSkeleton = true): void {
    if (reset) {
      this.currentPage.set(1);
      if (!this.hasLoadedOnce) {
        if (showSkeleton) this.loading.set(true);
      } else if (showSkeleton) {
        // A filter/sort/search change on an already-populated page: blur the
        // current results out instead of tearing them down for a skeleton.
        this.swapping.set(true);
        this.swapStartedAt = performance.now();
      }
    } else {
      this.loadingMore.set(true);
    }

    const seq = ++this.requestSeq;
    const status = this.filters.status();
    const format = this.filters.format();
    const collectionId = this.filters.collectionId();
    const sort = this.activeSort();
    const search = this.searchQuery();
    const page = this.currentPage();
    // (unchanged responsive page-size comment + expression)
    const pageSize = window.innerWidth < 768 ? Math.min(this.pageSize(), 12) : this.pageSize();

    this.booksService
      .list({
        filter: status === 'all' ? undefined : status,
        sort,
        search,
        page,
        pageSize,
        collectionId: collectionId ?? undefined,
        groupByWork: this.preferences.groupByWork(),
        format: format === 'all' ? null : format,
      })
      .subscribe({
        next: (data) => {
          if (seq !== this.requestSeq) return; // stale: a newer request owns the view
          this.commitResults(data, reset, seq);
        },
        error: () => {
          if (seq !== this.requestSeq) return;
          this.loading.set(false);
          this.loadingMore.set(false);
          this.swapping.set(false);
          this.toast.error('Failed to load books');
        },
      });
  }

  /** Replaces the visible page. Deferred to the end of the out-phase when the
   *  stage is blurred, so the DOM swap is never visible to the user. */
  private commitResults(data: PaginatedResponse<Book>, reset: boolean, seq: number): void {
    const apply = () => {
      if (seq !== this.requestSeq) return;
      if (reset) {
        this.rawBooks.set(data.items);
      } else {
        this.rawBooks.update((current) => [...current, ...data.items]);
      }
      this.totalItems.set(data.totalCount);
      this.hasLoadedOnce = true;
      this.loading.set(false);
      this.loadingMore.set(false);
      this.swapping.set(false); // releases the CSS in-phase (new books resolve in)
    };

    if (!reset || !this.swapping() || prefersReducedMotion()) {
      apply();
      return;
    }

    // Network time already spent counts toward the out-phase.
    const elapsed = performance.now() - this.swapStartedAt;
    setTimeout(apply, Math.max(0, SWAP_OUT_MS - elapsed));
  }
```

**Step 4: Run to verify pass** — `npx ng test --watch=false` → all specs in `library.component.spec.ts` green, including the pre-existing "exactly one books request" / "hydrates a stored viewMode" / title tests.

**Step 5: Commit**

```bash
git add Nostos.Frontend/src/app/library/library.component.ts Nostos.Frontend/src/app/library/library.component.spec.ts
git commit -m "feat(library): replace per-refresh skeleton with a deferred cross-fade swap"
```

---

### Task 3: Wrap the results in a transition stage (HTML + CSS)

**Objective:** Give the cross-fade a single element to animate, with no layout or paint side effects.

**Files:** Modify `library.component.html:146` and `library.component.css` (new section before `/* --- SKELETON --- */`).

**Step 1: Template** — wrap the two non-loading branches (do **not** move the infinite-scroll sentinel inside the stage):

```html
      @if (!loading()) {
      <div class="results-stage" [class.is-swapping]="swapping()" [attr.aria-busy]="swapping()">
        @if (viewMode() === 'list') { …unchanged table-view… }
        @if (viewMode() === 'grid') { …unchanged book-grid… }
      </div>
      }
```

The `@empty` empty-state blocks are already nested inside `.table-view` / `.book-grid`, so "nothing matches these filters" fades in with the same motion for free.

**Step 2: CSS**

```css
/* --- RESULTS STAGE: cinematic filter/sort cross-fade ---------------
   The stage is the only element that animates. Out-phase duration is kept
   equal to SWAP_OUT_MS in library.component.ts. */
.results-stage {
  --library-swap-out: 180ms;
  --library-swap-in: 260ms;
  transition:
    opacity var(--library-swap-in) var(--ease-out),
    filter var(--library-swap-in) var(--ease-out),
    transform var(--library-swap-in) var(--ease-out);
  will-change: opacity, filter;
}

.results-stage.is-swapping {
  opacity: 0.35;
  filter: blur(5px) saturate(0.92);
  transform: scale(0.995);
  /* A blurred list must not accept clicks on the books it is discarding. */
  pointer-events: none;
  transition-duration: var(--library-swap-out);
}
```

**Step 3: Guard the two known paint/stacking traps (do this now, not after a bug report)**
- `filter`/`transform` on an ancestor creates a containing block, so `position: fixed` descendants would break — there are none inside the stage (verified: only `.table-row`'s `.actions-cell` and `.cover-wrapper`'s `.format-badge`, both `absolute` against a closer `position: relative` ancestor).
- The stage's `filter` makes it a stacking context, but `.toolbar` (sticky, `z-index: 5`) is a *sibling of `.container.lg`*, not a descendant, so the existing badge-vs-header paint fix (`css:504-510`) is unaffected. Do not raise any `z-index` here.

**Step 4: Verify** — `npx ng build` green; `npx ng test --watch=false` green (a wrapper div must not break the `.container.lg .books-empty-state` / `.toolbar button` selectors in the spec).

**Step 5: Commit** — `feat(library): animate filter/sort results on a single transition stage`

---

### Task 4: Reduced-motion and mobile performance fallbacks

**Objective:** The blur must never cost a low-end mobile paint budget, and reduced-motion users get an instant swap.

**Files:** Modify `library.component.css` (inside the existing `@media (max-width: 768px)` block at `:776` and a new `@media (prefers-reduced-motion: reduce)` block at the end).

**Step 1: CSS**

```css
@media (max-width: 768px) {
  /* Blurring a full grid of cover images is the expensive part on mobile;
     the fade alone carries the transition there. */
  .results-stage { will-change: auto; }
  .results-stage.is-swapping {
    opacity: 0.45;
    filter: none;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .results-stage,
  .results-stage.is-swapping {
    transition-duration: 1ms;
    filter: none;
    transform: none;
  }
}
```

**Step 2: Verify** — the TS side already skips the hold under reduced motion (Task 2); confirm in DevTools → Rendering → "Emulate prefers-reduced-motion: reduce" that a filter change swaps instantly with no blur (manual check belongs to Task 12).

**Step 3: Commit** — `perf(library): opacity-only swap on mobile, instant swap under reduced motion`

---

### Task 5: Stabilize the toolbar so the search bar cannot move

**Objective:** The search field's geometry becomes a function of the viewport only.

**Files:** Modify `library.component.css` (`.toolbar` at `:63-79`, `.toolbar-right` at `:216-221`, mobile `.toolbar` at `:833-839`).

**Step 1: Desktop tracks** — replace the flex declaration block:

```css
.toolbar {
  position: sticky;
  top: 0;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  z-index: 5;
  padding: 1.5rem 3rem;
  border-bottom: 1px solid var(--glass-border);
  /* Three fixed tracks: the title track no longer sizes to its text, so the
     search field's x/width depend only on the viewport. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 480px) auto;
  align-items: center;
  margin-bottom: 2rem;
  gap: 2rem;
}
```

Add `justify-self: end;` to `.toolbar-right` and keep `flex-shrink` (harmless in grid). Leave `.search-bar-container { flex: 1; max-width: 480px }` as is — inside the grid track it is the single child and fills the track; the `max-width` now merely agrees with the track's max. (Optional tidy-up, not required: drop `flex: 1; max-width: 480px`.)

**Step 2: Preserve mobile exactly** — in the `@media (max-width: 768px)` toolbar block, add the display reset before the existing declarations so the current column layout is untouched:

```css
  .toolbar {
    display: flex;            /* overrides the desktop grid */
    flex-direction: column;
    align-items: stretch;
    height: auto;
    gap: 10px;
    padding: 12px 14px 10px;
  }
```

**Step 3: Verify** — `npx ng build` green. Manual/geometry proof comes in Task 11; do not claim the shift is fixed before that check runs.

**Step 4: Commit** — `fix(library): make toolbar tracks stable so the search bar cannot shift`

---

### Task 6: Cross-fade the dynamic title inside a reserved box

**Objective:** Premium fade/blur title change with zero layout movement and no TypeScript logic.

**Files:** Modify `library.component.html:13`, `library.component.css` (`.toolbar h1` at `:81-89`, mobile `h1` at `:849-856`).

**Step 1: Template**

```html
      <h1 id="library-title" class="title-stage" [attr.aria-label]="pageTitle()">
        @for (t of [pageTitle()]; track t) {
          <span
            class="title-swap"
            aria-hidden="true"
            animate.enter="title-swap-in"
            animate.leave="title-swap-out"
          >{{ t }}</span>
        }
      </h1>
```

Why this shape:
- `track t` (the title string) → a new span is created **only** when the title value actually changes, and the old span is retained by `animate.leave` until its animation ends → real cross-fade.
- `{{ t }}` renders in the same change-detection pass as the filter signal, so `#library-title.textContent` stays synchronous — this is what keeps the existing spec assertion (`spec:212`) valid.
- The visible text keeps its normal accessible name via `[attr.aria-label]` on the `h1` while the animated spans are `aria-hidden`, so a screen reader never reads the title twice during the cross-fade.

**Step 2: CSS** — replace the typography block on `.toolbar h1` with a stage/stack pair (keep `font-size` on the span so both stages agree):

```css
/* Title cross-fade: fixed-height absolute stack, so no title length can ever
   move a toolbar sibling. */
.title-stage {
  position: relative;
  display: block;
  height: 2.4rem;
  margin: 0;
  min-width: 0;
  overflow: hidden;
}

.title-swap {
  position: absolute;
  inset: 0;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 1.75rem;
  font-weight: var(--fw-medium);
  line-height: 2.4rem;
  color: var(--color-text-main);
}

.title-swap-in {
  animation: title-swap-in 260ms var(--ease-out) both;
}
.title-swap-out {
  animation: title-swap-out 180ms var(--ease-standard) both;
}

@keyframes title-swap-in {
  from { opacity: 0; filter: blur(8px); transform: translateY(3px); }
  to   { opacity: 1; filter: blur(0);   transform: none; }
}
@keyframes title-swap-out {
  from { opacity: 1; filter: blur(0); }
  to   { opacity: 0; filter: blur(8px); transform: translateY(-3px); }
}
```

**Step 3: Mobile + reduced motion**

```css
@media (max-width: 768px) {
  .title-stage { height: 1.9rem; }
  .title-swap { font-size: 1.25rem; line-height: 1.9rem; }
}

@media (prefers-reduced-motion: reduce) {
  .title-swap-in, .title-swap-out { animation-duration: 1ms; filter: none; transform: none; }
}
```

**Step 4: Spec** — add:

```ts
it('renders the dynamic title inside a cross-faded stack', () => {
  fixture.detectChanges();
  const title = fixture.nativeElement.querySelector('#library-title') as HTMLElement;
  expect(title.querySelector('.title-swap')!.textContent!.trim()).toBe('Library');

  component.filters.toggleStatus('reading');
  fixture.detectChanges();

  expect(title.querySelector('.title-swap')!.textContent!.trim()).toBe('In Progress');
  expect(title.getAttribute('aria-label')).toBe('In Progress');
});
```

**Step 5: Verify** — `npx ng test --watch=false` green, especially the pre-existing `reflects a status filter in the title and chips` and `combines format and collection in the title and chips`. **If `animate.leave` does not fire in this Angular version for `@for` blocks**, keep the `title-swap-in` enter animation and drop `animate.leave="title-swap-out"` + `@keyframes title-swap-out` (an enter-only fade is still the requested "smooth premium fade"; a lingering outgoing span is not acceptable). Record which of the two outcomes was verified.

**Step 6: Commit** — `feat(library): cross-fade the dynamic library title in a reserved box`

---

### Task 7 (optional, measure first): pin the stage height through the swap

**Objective:** Kill the residual document-height jump when a filter returns far fewer items (scrollbar appearing/disappearing while the blur plays).

**Files:** Modify `library.component.ts` / `.html` / `.css`.

Only do this if Task 11's geometry run shows the *document* height still flipping mid-transition; a `min-height` pin is a real tradeoff (it holds a temporary gap when the new result is shorter).

```ts
  @ViewChild('resultsStage') private resultsStage?: ElementRef<HTMLElement>;
  private readonly stageHeight = signal<number | null>(null);
  // in refreshBooks(), inside the `else if (showSkeleton)` branch, after swapping.set(true):
  this.stageHeight.set(this.resultsStage?.nativeElement.offsetHeight ?? null);
  // at the end of commitResults()'s apply(): release after the in-phase completes
  setTimeout(() => this.stageHeight.set(null), SWAP_IN_MS + 40);
```

```html
<div #resultsStage class="results-stage" [class.is-swapping]="swapping()" [style.min-height.px]="stageHeight()">
```

**Commit** — `perf(library): pin the results stage height across the filter swap` (or record "not needed" with the measured heights).

---

### Task 8 (optional): Smooth the chips row and the scroll reset

**Objective:** Remove the last two jumps around a filter change.

**Files:** Modify `library.component.html:60-69`, `library.component.css:91-97`, `library.component.ts` (`clearChip`/`setSort`/`refreshBooks`), `library.component.spec.ts:202`.

**Step 1:** Replace the `@if (activeFilterChips().length > 0)` mount/unmount with an always-mounted collapsible wrapper, so the row's height animates instead of popping:

```html
      <div class="filter-bar" [class.is-empty]="activeFilterChips().length === 0">
        <div class="filter-bar-inner">
          <div class="active-filters" role="status" aria-label="Active filters">
            @for (chip of activeFilterChips(); track chip.key) { …unchanged… }
          </div>
        </div>
      </div>
```

```css
.filter-bar {
  display: grid;
  grid-template-rows: 1fr;
  margin: -1rem 0 1.5rem; /* constant: the collapsed state consumes no extra margin */
  transition: grid-template-rows 220ms var(--ease-out);
}
.filter-bar.is-empty { grid-template-rows: 0fr; }
.filter-bar-inner { overflow: hidden; }
.active-filters { padding: 0 3rem; margin: 0; } /* margin moved to .filter-bar */
```

**Step 2:** Update `spec:202` honestly — the row now exists but is collapsed:

```ts
expect(fixture.nativeElement.querySelector('.filter-bar.is-empty')).not.toBeNull();
```

**Step 3:** On a reset refresh, return the scroll container to the top with the swap rather than letting the browser clamp it:

```ts
  // in refreshBooks(), alongside swapping.set(true):
  this.scrollContainer()?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
```

(`scrollContainer` = the `@ViewChild`'d `.library-right-side`, which is the element that actually scrolls; on mobile the page scrolls instead, so guard with the element's `scrollTop > 0` check and skip when the container is not scrollable.)

**Step 4: Verify** — `npx ng test --watch=false` green (the chips spec is the one intentional assertion change; call it out in the PR body).

**Step 5: Commit** — `fix(library): animate the filter-chip row and reset scroll with the swap`

---

### Task 9: Prove stability with a geometry check (do not rely on eyeballing)

**Objective:** A machine-checked regression test for symptom D, in the harness the repo already trusts.

**Files:** Modify `Nostos.Frontend/e2e/support/visual-capture.ts` (append after `checkLibraryFilterContract`), `Nostos.Frontend/e2e/visual-regression.spec.ts` (the two library tests at `:251` and `:272`).

**Step 1: Add the check** (reuse `passCheck`/`failCheck`/`GeometryCheck` exactly like `checkZenFillsViewport`):

```ts
/**
 * Library toolbar stability: the search field and the title box must not move
 * when the dynamic title changes length. Measured across a real filter click
 * in the sidebar/drawer, desktop and mobile.
 */
export async function checkLibraryToolbarStability(page: Page): Promise<GeometryCheck> {
  const search = page.locator('.search-input');
  await search.waitFor({ timeout: 30_000 });
  const before = await search.boundingBox();
  const titleBefore = await page.locator('#library-title').boundingBox();

  // Longest title wins: a collection + format combination renders far more text
  // than "Library".
  const labels = page.locator('.sidebar-panel nav.sidebar .nav-group').first().locator('span.label');
  await labels.last().click();
  await page.waitForTimeout(700); // out-phase 180 + in-phase 260 + margin

  const after = await search.boundingBox();
  const titleAfter = await page.locator('#library-title').boundingBox();
  if (!before || !after || !titleBefore || !titleAfter) {
    return failCheck('library-toolbar-stability', 'could not measure .search-input / #library-title');
  }

  const dSearchX = Math.abs(after.x - before.x);
  const dSearchW = Math.abs(after.width - before.width);
  const dTitleX = Math.abs(titleAfter.x - titleBefore.x);
  const ok = dSearchX <= 1 && dSearchW <= 1 && dTitleX <= 1;
  const metrics = {
    searchX: round(before.x), searchXAfter: round(after.x), dSearchX: round(dSearchX),
    searchW: round(before.width), dSearchW: round(dSearchW), dTitleX: round(dTitleX),
  };
  const msg =
    `search field x ${before.x.toFixed(1)} -> ${after.x.toFixed(1)} (Δ${dSearchX.toFixed(1)}px), ` +
    `width Δ${dSearchW.toFixed(1)}px, title x Δ${dTitleX.toFixed(1)}px over a title-length change ` +
    `(${ok ? 'stable' : 'SHIFTS'})`;
  return ok
    ? passCheck('library-toolbar-stability', msg, metrics)
    : failCheck('library-toolbar-stability', msg, metrics);
}
```

**Step 2:** In both library tests, push it after the existing checks, e.g. `checks.push(await checkLibraryToolbarStability(page));` (desktop test at `:265`, mobile at `:287` — on mobile the sidebar is a drawer; open it first using the same path the mobile test already uses, and note in the PR which viewport proved what). Add the import to the existing `from './support/visual-capture'` list.

**Step 3: Verify** — `npm run e2e` green (fixture-based library tests; reader surfaces may skip as documented). A failing `library-toolbar-stability` check must be treated as a real failure, and stale `e2e/visual-evidence/library-filters-*.json` reports must be regenerated so the committed evidence matches the new build.

**Step 4: Commit** — `test(library): assert toolbar geometry is stable across filter changes`

---

### Task 10: Regenerate visual evidence and vision-review it

**Files:** Modify (harness output only): `Nostos.Frontend/e2e/visual-evidence/library-filters-desktop.{png,json}`, `library-filters-mobile.{png,json}`.

**Steps:**
1. Capture the two library artifacts from the branch build with the harness's real-library mode (`VISUAL_QA_LIBRARY_URL` documented in `e2e/support/visual-capture.ts` and `docs/visual-verification.md`).
2. Compare pre/post PNGs in the same way the repo verifies paint faults: inspect the toolbar band (title + search) and one mid-swap frame. To capture a mid-swap frame, throttle the API to ~500 ms (DevTools network throttling) and screenshot during the blur — a mid-swap capture must show blurred/faded old books and **no skeleton rows**.
3. Record the verdict against the criterion list in `docs/visual-verification.md` (no clipping, no horizontal overflow, no overlap, empty states intentional). Do not add new files to the documented 10-image matrix.

---

### Task 11: Full verification gate

Run from `Nostos.Frontend` unless noted:

```bash
npx ng build                       # green
npx ng test --watch=false          # green, test count >= before (never lower)
npm run e2e                        # green, skips documented
git diff --check                   # clean
git diff --stat                    # only the files in section 3
```

Then confirm explicitly:
- [ ] `git diff` for every protected file in section 3 is **empty** (`git diff --name-only -- <paths>` prints nothing).
- [ ] The three pre-existing library specs that guard this component's contract still pass unmodified except the one intentional chips assertion in Task 8.
- [ ] No new dependency in `package.json` / `package-lock.json` (`git diff --stat` shows neither).

---

### Task 12: Manual behaviour QA (the user-visible acceptance test)

Start the app on the Nostos dev port and check by hand — a green build is not acceptance:

```bash
npx ng serve --port 5099          # outside the worktree if the main checkout serves the instance
```

Checklist (desktop 1440×900 and mobile 390×844):
- [ ] **No skeleton flash on filter/sort/search.** With DevTools network throttled to Fast 3G, change a filter: old books blur out, new books resolve in, the skeleton is never shown.
- [ ] **No title-driven shift.** Click through filters whose titles differ wildly in length; the search field's box does not move, and the title cross-fades with a blur.
- [ ] **Rapid clicking is safe.** Click three different sidebar filters within ~300 ms: no flicker, no torn page, and the final visible list matches the last click (leftover stale responses must not paint).
- [ ] **Infinite scroll unaffected.** Scroll to the bottom: appended pages do not blur or re-animate.
- [ ] **Edit-in-place unaffected.** Change a rating or favorite from the toolbar/modal: the list must not blur (that path passes `showSkeleton = false`).
- [ ] **Empty transition.** Filter to a combination with zero results: the empty state fades in, no skeleton, no jump to a broken layout.
- [ ] **Grid ⇄ list toggle** still renders correctly and the covers stay sharp at rest with hover-only badges (the user's existing visual rules).
- [ ] **Mobile:** grid/list, drawer open/closed, the toolbar's mobile order (title → controls → search) unchanged, and no blur cost visible while scrolling.
- [ ] **Reduced motion emulated:** filter change is instant, no blur, no linger.
- [ ] **Keyboard/AT:** tab order unchanged; the title reads once (aria-label) and does not double-announce during the cross-fade.

---

## 5. Risks and tradeoffs

1. **The out-phase is an intentional 180 ms floor.** A local API answering in 30 ms now shows new books at ~180 ms instead of ~30 ms (the old books are visibly blurring during that time, so it reads as motion, not lag). *If it feels sluggish in Task 12*, add a fast-path: when the response arrives in under ~80 ms, skip the hold and let only the in-phase play. That preserves snappiness for cached/local responses while keeping the cinematic transition for slower ones. Decide with the user, not unilaterally.
2. **Blur is a paint cost** over a full cover grid. Mitigated by a small radius (5 px), by opacity-only on mobile, and by `will-change` scoped to the stage. If Task 12 shows jank on the Shield/mobile target, drop the blur to desktop-only with `@media (min-width: 769px)`.
3. **`track t` on the title** means two titles that are equal strings do not re-animate — correct for the visual language, but it also means an in-place text *change that renders identically* (e.g. a collection renamed to the same string) shows nothing. Acceptable.
4. **`animate.leave` inside `@for`** is the only technically uncertain piece (native animate API + control flow in this Angular version). Task 6 Step 5 defines the fallback: enter-only animation, no lingering span.
5. **Task 7's height pin** holds a temporary blank gap when the new result is much shorter. Optional and measurement-gated for that reason.
6. **The uncommitted `book-detail` work in the main checkout** must not be disturbed: implementation runs in a worktree; the plan's commits touch only `library/**` and `e2e/**`.
7. **Visual evidence regeneration** needs a real library instance (`VISUAL_QA_LIBRARY_URL`); if it is unavailable, say so explicitly instead of shipping stale geometry JSON.

## 6. Open questions for the user

1. **Timing feel:** is 180 ms out / 260 ms in the right weight, or do you want it slower/more languid (e.g. 240/320) for a heavier cinematic feel? (One-line token change either way.)
2. **Blur on the results:** keep it on desktop only, or everywhere except mobile? (Default in this plan: desktop blur, mobile opacity-only.)
3. **Stagger:** should the new grid cards enter with a 20–30 ms per-card stagger (via `animate.enter` + an index delay), or resolve as one block? A stagger is more cinematic but costs a slightly longer perceived load.

---

## 7. Implementation outcome (executed 2026-09-11)

Decisions taken (the three open questions in §6 were delegated to the implementer):

1. **Timing:** 200 ms out / 300 ms in (mobile: 200 ms out / 260 ms in). Network time counts toward the out-phase, so a fast local API still gets a full, visible blur instead of a one-frame blink.
2. **Blur:** desktop only (`blur(5px) saturate(0.92)`); mobile is opacity-only (0.35 → 0.4 with no `filter`), because blurring a full grid of cover images is the expensive part on a phone.
3. **No per-card stagger.** The page resolves as one block so infinite-scroll appends never re-animate.

Deviations from the plan, each because verification proved the planned mechanism wrong or insufficient:

- **The title does not use `animate.enter`/`animate.leave`.** The planned `@for (t of [pageTitle()]; track t)` + `animate.leave` version ran, but the leaving span was **never removed** (3 stacked spans after 2 title changes, accumulating forever — verified in a real browser, and the visual looked correct, which is exactly why it would have shipped silently). Replaced with two persistent layers flipped by a `linkedSignal`: nothing is created/destroyed, the new text is in the DOM on the same tick as the filter signal (heading never stale, existing assertions still valid), and `aria-label` on the `h1` keeps the accessible name single while both layers are `aria-hidden`.
- **A fourth defect was found and fixed: the scrollbar gutter.** The toolbar was stable against title length, but an 8 px shift remained because a short/empty result set removes the styled 8 px scrollbar: desktop (`.library-right-side`) and mobile — where the *document* scrolls — needed `scrollbar-gutter: stable`. The mobile case is scoped by `body.nostos-library` (added/removed by the component, the same global-helper pattern as `body.nostos-zen`) inside a `max-width: 768px` media query so desktop is untouched.
- **Reduced motion skips the swap state entirely** (not just the hold): `swapping` is never set, so no dim flash is painted while the response is in flight.
- Task 7 (height pin) was not needed — the document height never moved (measured 900 → 900 → 900 through a swap).
- Task 8's scroll-reset was dropped: not part of the reported pain, and jumping the scroll position would have been a new behaviour. The chips-row collapse animation was kept at first, but the row-height reveal was wrong in practice: growing the row from zero height with `overflow: hidden` *uncovered* the first chip from the top while the row's negative margin slid it up, so the first chip appeared to rise out from under the toolbar. The row no longer animates at all — it appears/disappears in one frame, and each chip fades in on its own (`chip-in`, 180 ms), so the first chip behaves exactly like every chip added after it (verified frame-by-frame: bar height 0 → 29.6 px in one frame, chip opacity 0 → 1 over 180 ms, existing chips untouched).

Verification evidence (real browser, live library data, 1440×900 and 390×844):

- Frame-by-frame swap: old page stays mounted and blurs (opacity 1 → 0.35, blur 0 → 5 px) for the full 200 ms, the DOM commits at 221 ms with **zero skeleton frames**, then resolves in to `filter: none` at ~520 ms.
- Toolbar geometry: search field x/width and the title box x are **identical (±0.0 px)** across 20 → 0 → 14 → 7 → 10 results, 0/1/2 chips, and titles from `Library` to `Finished Audiobooks`, on desktop and mobile.
- Rapid clicks (3 filters in 200 ms) resolve to the last click; infinite scroll appends without blurring; reduced motion swaps instantly with no blur.
- `npx ng test --watch=false`: 208 passed (was 203). New Playwright geometry check `library-toolbar-stability` added to both library e2e tests.
