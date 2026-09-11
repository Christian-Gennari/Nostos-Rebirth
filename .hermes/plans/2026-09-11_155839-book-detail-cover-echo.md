# Book Detail — Cover-First Hero (Cover Echo) Implementation Plan

> **For Hermes:** implement this task-by-task. Tasks 0, 8 and 11 are **not optional** —
> they are this plan's whole point. The three previous attempts were committed without
> ever looking at a rendered screenshot, and shipped a visible artifact three times.

**Goal:** Make the Book Detail page use the book's own cover art to "fill out" the top of
the page — a soft, cover-derived wash behind the cover and title — without remaking the
existing detail layout.

**Architecture:** A decorative, `aria-hidden`, pointer-inert layer (`.cover-echo`) anchored
**inside `.container.md`** (so it aligns with the cover column), containing a heavily
blurred, desaturated, low-opacity **thumbnail** of the cover, faded out by a single
radial-gradient mask whose radii are computed to be fully transparent at the layer's own
left/right/bottom edges. All page content paints above it via `position: relative; z-index`.

**Tech Stack:** Angular 20 standalone components + signals, component CSS (emulated
encapsulation), Vitest/`ng test`, Playwright e2e visual harness (`e2e/`), `ng serve` +
API proxy for the real library.

---

## 1. What the reference image is actually doing

`/home/dev/.hermes/cache/images/img_47cfdf2bf968.png` (Oxford *Devils*, captured against
our own running app) shows exactly three cover-related ideas:

1. **The cover is a physical object**: full art, complete, uncropped, drop shadowed — it
   reads as a book lying on paper, not as an `<img>` in a box.
2. **A blurred, desaturated, slightly scaled echo of the cover art bleeds out from behind
   the cover/title region and dissolves into the warm page background.** It is a *wash*,
   not a shape: no visible boundary anywhere. It is visibly recognisable as the cover's
   forms, not just a colour smear.
3. **The title/author block sits beside the cover**, top-aligned with it, sharp dark text
   on the wash.

Ideas 1 and 3 are already true of our page. **Only idea 2 is in scope.** Do not restructure
the grid, the metadata, the actions, the status chip, the notes feed, or the modals.

## 2. Root cause: why the last three attempts failed

Read this before writing any CSS — it is the difference between attempt 4 working and not.

**Attempt 1** (`b8c9c2a`) bound the URL with `[style.background-image]="'url(' + … + ')'"`.
Rendered as an **empty rectangle** in the deployed build (Angular's style sanitization /
`url()` binding), no cover art at all. **Lesson: never bind a URL through a style binding;
always use a real `<img [src]>`.**

**Attempt 2** (`d08222f`) switched to `<img>` but the layer was a child of `.layout-content`
with `left: 0; width: min(760px, 68vw)` and a corner-anchored mask:
`linear-gradient(135deg, #000 0 38%, transparent 82%)`.

**Attempt 3** (`390e32c`) kept a corner-anchored mask (`clip-path: ellipse(… at 18% 10%)`)
inside `.container.md`.

Both produced the user's "weird square in the upper left", and here is why:

- `.container.md` is `max-width: 800px; margin: 0 auto`. Inside a `~1180px` scroll area the
  content box is **centred**, so the cover art sits ~200–300px right of the scroll area's
  left edge. Attempt 2 pinned the echo to the scroll area's top-left → the wash appeared in
  empty page margin, **disconnected from the cover it echoes**.
- The masks were **brightest in the corner they were anchored to**, so the opaque part of
  the mask *was* a rectangle hugging the top-left corner, fading diagonally. A corner-anchored
  mask is a rectangle by construction. It never looked like a wash.

**Hard rules derived from this (violating any one re-creates the bug):**

1. The echo aligns with the **content container**, never with the scroll area or the viewport.
2. The mask must be **fully transparent at the layer's own left, right and bottom edges**.
   The top edge is allowed to be bright *only* because the container's top edge coincides
   with the scroll area's top edge at rest — verify this stays true (no header above it).
3. No URL through a style binding. `<img [src]>` only.
4. The layer must never exceed the container's width (a horizontal scrollbar is a real
   hazard: `.layout-content` is `overflow-y: auto`, which makes `overflow-x` compute to
   `auto` too).

## 3. Verified facts this plan depends on (re-checked, not assumed)

Run against the live library at `http://localhost:5214` (74 books, 73 with covers):

| Fact | Value |
| --- | --- |
| Book Detail route | `/library/:id` (`app.routes.ts:37`) |
| Reference book (same one in the screenshot) | `Devils` → `ab9da97e-fab0-46d5-90c1-a0f8fea26f7e` |
| `coverUrl` shape | `/api/books/<id>/cover` (relative, same-origin) |
| Full cover | `HTTP 200`, `image/jpeg`, 99 251 B, **659×1000** |
| `coverUrl + /thumbnail?width=320` | `HTTP 200`, `image/webp`, 33 870 B |
| `coverUrl + /thumbnail?width=128` | `HTTP 200`, `image/webp`, **5 964 B**, 128×194 |
| Library already uses this pattern | `library.component.ts:532` → `${coverUrl}/thumbnail?width=320` |
| Container | `.container.md` → `max-width: 800px; padding: 2rem; margin: 0 auto` |
| Scroll container | `.layout-content` → `flex: 1; height: 100dvh; overflow-y: auto` |
| Theme system | **gone** — one light rendering only (no dark/`prefers-color-scheme` work) |
| Existing CSS budget | `anyComponentStyle` warn `16kB`; `book-detail.component.css` is **16.05 kB — already over** |

**Use `thumbnail?width=320`** for the echo (33 KB, and 320px → ~2.5× upscale at desktop,
which keeps the forms recognisable under a 38px blur). `width=128` is the fallback if the
blurred layer ever shows up in a performance trace.

## 4. Files to change

| File | Change |
| --- | --- |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.html` | Add `.cover-echo` as the first child of `.container.md` |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.css` | `.cover-echo` rules + stacking fix (lines 1–4, 6, 22, 28 today) |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.ts` | `coverEchoFailed` signal + `onCoverEchoError()` |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.spec.ts` | 4 new unit tests (it currently has 11) |
| `Nostos.Frontend/e2e/support/visual-capture.ts` | `findLibraryCoverBook()`, `checkBookDetailCoverEcho()` |
| `Nostos.Frontend/e2e/book-detail-visual.spec.ts` | **new** — 2 captures + geometry checks |
| `Nostos.Frontend/e2e/visual-evidence/book-detail-hero-{desktop,mobile}.{png,json}` | **new** evidence |
| `Nostos.Frontend/angular.json` | `anyComponentStyle` budget bump (line 50–52) |
| `docs/visual-verification.md` | New artifacts + new check row + 2 vision criteria bullets |

**Do not touch** the uncommitted Library/filter work in the tree (`library.component.*`,
`library-preferences.service.ts`) or `Nostos.Frontend/verify-reentry*.cjs`. Commit
book-detail files only.

---

## Task 0 — Baseline evidence (do this FIRST; ~10 min)

**Objective:** prove the post-revert baseline is clean and set up the fast iteration loop
from `docs/visual-verification.md` §How to run. Without this there is no "before".

**Step 0.1** — confirm the baseline is the revert, not a half-reverted tree:

```sh
cd /home/dev/coding/projects/nostos-rebirth
git log --oneline -1          # expect 9bc269c revert(book-detail): remove ambient cover background
git diff --quiet 900c323 -- Nostos.Frontend/src/app/book-detail/book-detail.component.{html,css} && echo "baseline OK"
grep -rn "cover-ambient\|cover-echo" Nostos.Frontend/src/app/book-detail/ || echo "no echo remnants"
```

**Step 0.2** — start the real-backend dev loop (the documented local recipe):

```sh
cd Nostos.Frontend
cat > src/proxy.local.json <<'JSON'
{ "/api": { "target": "http://localhost:5214", "secure": false, "changeOrigin": true } }
JSON
npx ng serve --port 4310 --proxy-config src/proxy.local.json
```

**Step 0.3** — capture the baseline PNGs (1440×900 and 390×844) of that exact book:

```sh
cd Nostos.Frontend
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=3000 \
  http://localhost:4310/library/ab9da97e-fab0-46d5-90c1-a0f8fea26f7e /tmp/baseline-desktop.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=3000 \
  http://localhost:4310/library/ab9da97e-fab0-46d5-90c1-a0f8fea26f7e /tmp/baseline-mobile.png
```

**Step 0.4 — MANDATORY:** load both PNGs with `vision_analyze` and describe what you see
(cover art present, title beside it, no stray rectangles, no horizontal scrollbar). If you
cannot describe the page accurately, you cannot judge the change. State the baseline verdict
in the PR.

---

## Task 1 — Failing unit test: no cover ⇒ no echo

**Files:** test `Nostos.Frontend/src/app/book-detail/book-detail.component.spec.ts`

The spec's fixture book has `coverUrl: null` (line 36), so the default state must render
no echo at all.

**Step 1.1** add to the Book Detail `describe`:

```ts
it('renders no cover echo when the book has no cover', () => {
  const fixture = TestBed.createComponent(BookDetailComponent);
  fixture.componentInstance.spec = 1; // (keep whatever the existing setup uses)
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.cover-echo')).toBeNull();
});
```

**Step 1.2** run it, expect FAIL/absent-element:

```sh
cd Nostos.Frontend && npx ng test --watch=false --include='src/app/book-detail/**/*.spec.ts'
```

> Copy the surrounding setup from the existing 11 tests in that file — do not invent a new
> TestBed pattern. The point of this task is the `.cover-echo` selector contract.

---

## Task 2 — Add the echo to the template

**File:** `book-detail.component.html` — insert as the **first child of `.container.md`**,
i.e. immediately after `<div class="container md">` (currently line 3).

```html
<div class="container md">
  @if (store.book()?.coverUrl && !coverEchoFailed()) {
  <!-- Decorative cover-derived wash. Thumbnail, not the full cover: it is blurred to
       mush anyway, and this keeps the layer cheap. -->
  <div class="cover-echo" aria-hidden="true">
    <img
      [src]="store.book()!.coverUrl + '/thumbnail?width=320'"
      alt=""
      loading="eager"
      fetchpriority="low"
      decoding="async"
      (error)="onCoverEchoError()"
    />
  </div>
  }
```

**Why inside `.container.md`:** it must align with the cover column. See Root cause §2.1.
**Why the error guard:** a failed `<img>` with explicit width/height paints Chrome's broken
image glyph; hide the layer instead. 4 lines, one test.

---

## Task 3 — Component state for the error guard

**File:** `book-detail.component.ts` — beside the existing signals (e.g. near `showDeleteConfirm`):

```ts
/** True when the decorative cover thumbnail failed to load — the wash is hidden. */
readonly coverEchoFailed = signal(false);

onCoverEchoError(): void {
  this.coverEchoFailed.set(true);
}
```

**Test (add to the spec):**

```ts
it('hides the cover echo when its thumbnail fails to load', () => {
  // arrange a book WITH a cover, then:
  const img = fixture.nativeElement.querySelector('.cover-echo img') as HTMLImageElement;
  img.dispatchEvent(new Event('error'));
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.cover-echo')).toBeNull();
});

it('uses the thumbnail endpoint for the echo, not the full cover', () => {
  // arrange a book WITH a cover, then:
  const img = fixture.nativeElement.querySelector('.cover-echo img') as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('/api/books/test-id/cover/thumbnail?width=320');
});
```

---

## Task 4 — The CSS (the actual fix)

**File:** `book-detail.component.css` — replace the current lines 1–4 (`.container.md { … }`)
and add the layer + stacking fix. `back-nav`/`detail-grid` are at lines 6 and 22 today.

```css
.container.md {
  position: relative;          /* containing block for .cover-echo (aligns with the cover) */
  /* Clears the floating bottom dock at every scroll position. */
  padding-bottom: 8.5rem;
}

/* ── Cover echo ─────────────────────────────────────────────────────────────
   A blurred, desaturated echo of the cover art that bleeds out from behind the
   cover and dissolves into the paper background.

   The mask is a SINGLE radial gradient whose radii are deliberately smaller than
   the layer's left/bottom half-widths, so it is fully transparent at the layer's
   left, right and bottom edges and cannot read as a rectangle. (Regression: an
   earlier corner-anchored `linear-gradient(135deg, …)`/`clip-path: ellipse(… at
   18% 10%)` was bright in the corner it was anchored to — i.e. a rectangle by
   construction — and shipped as "a weird square in the upper left".)
   The top edge IS bright; that is intentional and only safe because the
   container's top edge is the top of the scroll area at rest.                */
.cover-echo {
  position: absolute;
  inset-inline: 0;             /* never wider than the container: no h-scrollbar */
  top: 0;
  height: 560px;
  overflow: hidden;            /* contains the blur bleed */
  pointer-events: none;
  z-index: 0;
  mask-image: radial-gradient(
    ellipse 30% 110% at 30% -6%,
    #000 0%,
    rgba(0, 0, 0, 0.55) 40%,
    transparent 92%
  );
  -webkit-mask-image: radial-gradient(
    ellipse 30% 110% at 30% -6%,
    #000 0%,
    rgba(0, 0, 0, 0.55) 40%,
    transparent 92%
  );
}

.cover-echo img {
  position: absolute;
  top: -16%;
  left: -16%;
  /* Explicit size: an absolutely positioned REPLACED element with width:auto takes
     its INTRINSIC width and ignores `right`, so `inset` alone would not stretch it. */
  width: 132%;
  height: 132%;
  object-fit: cover;
  object-position: 18% 16%;   /* frame the art's upper-left, where the cover leads */
  filter: blur(38px) saturate(0.62);
  opacity: 0.28;
}

/* Everything the reader reads paints above the wash. */
.back-nav,
.detail-grid {
  position: relative;
  z-index: 1;
}
```

**Mask math (verify, don't trust):** layer = 800×560 at desktop. Centre at `30% -6%`
= (240, −34). Radii = (0.30·800, 1.10·560) = (240, 616).
Left edge distance 240 = exactly the X radius → the gradient is at the 92 %-transparent
stop → invisible. Right edge 560 ≫ 240 ✓. Bottom edge 594 vs 616 → beyond 92 % ✓.
Cover art spans x 32–272 in the layer, i.e. right on the bright zone ✓.

**Mobile (`@media (max-width: 900px)` — insert into the existing block at line 870):**
the cover column is centred and the container is full width, so the layer's left/right
edges coincide with the screen edges and a centre-anchored mask is safe and better:

```css
  .cover-echo {
    height: 430px;
    mask-image: radial-gradient(
      ellipse 62% 104% at 50% -8%,
      #000 0%,
      rgba(0, 0, 0, 0.5) 42%,
      transparent 92%
    );
    -webkit-mask-image: radial-gradient(
      ellipse 62% 104% at 50% -8%,
      #000 0%,
      rgba(0, 0, 0, 0.5) 42%,
      transparent 92%
    );
  }
  .cover-echo img {
    opacity: 0.24;
    filter: blur(30px) saturate(0.6);
    object-position: 50% 12%;
  }
```

**Step:** `npx ng build` — expect the `anyComponentStyle` budget warning to reappear
(see Task 9).

---

## Task 5 — Geometry check helper

**File:** `Nostos.Frontend/e2e/support/visual-capture.ts` — add at the end:

```ts
/** Finds a book that has cover art (the echo needs a real cover). */
export async function findLibraryCoverBook(): Promise<{ id: string; title: string } | null> {
  const res = await fetch(`${LIBRARY_URL}/api/books?pageSize=200`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${LIBRARY_URL}/api/books -> ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { items?: Array<{ id: string; title: string; coverUrl?: string | null }> };
  const match = (data.items ?? []).find((b) => !!b.coverUrl);
  return match ? { id: match.id, title: match.title } : null;
}

/**
 * Cover echo must be aligned with the content container (the original defect was an
 * echo pinned to the scroll area's top-left, ~250px away from the cover it echoes),
 * must not introduce horizontal overflow, and must paint BELOW the page content.
 */
export async function checkBookDetailCoverEcho(page: Page): Promise<GeometryCheck> {
  const echo = page.locator('.cover-echo');
  const container = page.locator('.container.md').first();
  const cover = page.locator('.detail-cover-col .cover-img, .detail-cover-col .placeholder-cover').first();
  const title = page.locator('.book-title').first();

  await cover.waitFor({ timeout: 30_000 });
  const echoBox = await echo.boundingBox();
  const cBox = await container.boundingBox();
  const coverBox = await cover.boundingBox();
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    contentScroll: document.querySelector('.layout-content')?.scrollWidth ?? 0,
    contentClient: document.querySelector('.layout-content')?.clientWidth ?? 0,
  }));
  // Hit-test the title: proves content, not the wash, owns the pixel.
  const titleHit = await page.evaluate(() => {
    const el = document.querySelector('.book-title');
    if (!el) return '<absent>';
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit ? (hit.className || hit.tagName) : '<null>';
  });

  const metrics = { echoBox, cBox, coverBox, overflow, titleHit };
  if (!echoBox || !cBox || !coverBox) return failCheck('book-detail-cover-echo', 'echo/container/cover not measurable', metrics);

  const aligned = Math.abs(echoBox.x - cBox.x) <= 2;
  const noOverflowX = overflow.docScroll <= overflow.docClient + 1 && overflow.contentScroll <= overflow.contentClient + 1;
  const covers = echoBox.x <= coverBox.x + 2 && echoBox.x + echoBox.width >= coverBox.x + coverBox.width - 2;
  const contentOnTop = typeof titleHit === 'string' && /book-title/.test(titleHit);
  const ok = aligned && noOverflowX && covers && contentOnTop;

  const msg =
    `echo x ${r1(echoBox.x)} vs container x ${r1(cBox.x)} (${aligned ? 'aligned' : 'MISALIGNED'}), ` +
    `spans cover ${covers ? 'yes' : 'NO'}, h-overflow ${noOverflowX ? 'none' : 'PRESENT'}, ` +
    `title owns its pixel: ${contentOnTop ? 'yes' : `NO (${titleHit})`}`;
  return ok ? passCheck('book-detail-cover-echo', msg, metrics) : failCheck('book-detail-cover-echo', msg, metrics);
}
```

Also extend `CaptureMeta['surface']` with `'book-detail'`.

## Task 6 — The capture spec

**File (new):** `Nostos.Frontend/e2e/book-detail-visual.spec.ts`

```ts
import { test } from '@playwright/test';
import {
  capturePng, checkBookDetailCoverEcho, DESKTOP_VIEWPORT, findLibraryCoverBook,
  LIBRARY_URL, MOBILE_VIEWPORT, newCapturePage, writeGeometryReport,
} from './support/visual-capture';

const RUN_REASON =
  'book detail needs a real book with cover art; the isolated fixture has no covers and ' +
  'the harness never invents assets. Run with `VISUAL_QA_LIBRARY_URL=<origin>` ' +
  '(see docs/visual-verification.md §Book detail).';

for (const [name, viewport, mobile] of [
  ['book-detail-hero-desktop', DESKTOP_VIEWPORT, false],
  ['book-detail-hero-mobile', MOBILE_VIEWPORT, true],
] as const) {
  test(name, async ({ browser }) => {
    test.skip(!LIBRARY_URL, RUN_REASON);
    const book = await findLibraryCoverBook();
    test.skip(!book, `no book with cover art at VISUAL_QA_LIBRARY_URL (${LIBRARY_URL})`);

    const { context, page } = await newCapturePage(browser, viewport, mobile);
    try {
      await page.goto(`${LIBRARY_URL}/library/${book!.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.book-title').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);   // cover + echo settle
      const png = await capturePng(page, name);
      const check = await checkBookDetailCoverEcho(page);
      await writeGeometryReport(name, [check], {
        name, surface: 'book-detail', viewport, state: 'cover-echo',
      });
      test.expect(check.pass, check.message).toBe(true);
      test.expect(png).toContain(name);
    } finally {
      await context.close();
    }
  });
}
```

Run: `VISUAL_QA_LIBRARY_URL=http://localhost:5214 npm run e2e -- book-detail-visual.spec.ts`

---

## Task 7 — **Vision review + iterate** (the task that was skipped three times)

For **each** artifact, load the PNG with `vision_analyze` and answer these, explicitly:

- Is the cover art fully visible, uncropped, with its shadow?
- Is the wash **behind the cover and title**, recognisable as the cover's tones/forms?
- Is there **any** visible edge, seam, rectangle, band or corner where the wash stops?
  Look at: the container's left edge (≈32px left of the cover), the right end of the wash,
  the bottom of the wash, and directly under the app dock.
- Is the title/author/synopsis text still the most legible thing on the page?
- Mobile: does the dock or the wash make the cover/header muddy?

Then tune **in this order, one variable at a time**, re-capturing after each change:
`opacity` (0.28 → 0.20 → 0.16) → `blur` (38 → 30px) → mask centre X (30% → 24%) →
`height` (560 → 460px). Stop on the first pair of settings you would defend in a review.

**If it still reads badly after V1 tuning, use the fallback ladder — do not keep guessing:**

- **V2:** shrink the wash to an aura behind the cover card only — mask
  `radial-gradient(ellipse 26% 60% at 22% 18%, #000 0%, transparent 88%)`, `height: 420px`,
  `opacity: 0.22`. Guaranteed subtle, guaranteed edge-free.
- **V3:** ship nothing. Revert to the `9bc269c` baseline and report honestly that a cover
  echo could not be made to look better than the clean page.

**Rule:** two consecutive vision PASSes, then and only then commit. Never commit an
artifact you have not looked at. Never tell the user it looks good based on a passing build.

---

## Task 8 — Budget

**File:** `Nostos.Frontend/angular.json` lines 43–53. `book-detail.component.css` is already
`16.05 kB` against a `16kB` warning. Book Detail is the richest page in the app (cover,
status dropdown, editions grid, synopsis, notes, two modals):

```json
{ "type": "anyComponentStyle", "maximumWarning": "20kB", "maximumError": "24kB" }
```

Add the reason in the commit message. Do not silence it by deleting styles.

## Task 9 — Deploy hygiene

The previous round left two orphaned hashed chunks in `wwwroot` (`chunk-YV5JFVF3.js`,
`main-3PQ3DSN2.js`) after a partial manual deletion. Sweep instead of hand-picking:

```sh
cd /home/dev/coding/projects/nostos-rebirth
rsync -a --delete --dry-run Nostos.Frontend/dist/Nostos.Frontend/browser/ Nostos.Backend/wwwroot/   # inspect first
rsync -a --delete Nostos.Frontend/dist/Nostos.Frontend/browser/ Nostos.Backend/wwwroot/
diff <(cd Nostos.Backend/wwwroot && find . -type f | sort) \
     <(cd Nostos.Frontend/dist/Nostos.Frontend/browser && find . -type f | sort) && echo "wwwroot == dist"
```

Then verify the served bundle hash changed on both origins (`localhost:5214` and
`https://omenhub.tail87a215.ts.net:5215/`), and note in the report that the PWA may need a
hard reload / reopen (service worker) before the echo appears for the user.

## Task 10 — Docs

`docs/visual-verification.md`:

- Add `book-detail-hero-desktop` / `book-detail-hero-mobile` to the artifact tables
  (§The 10-image matrix becomes 12, §How to run: real-library only, same
  `VISUAL_QA_LIBRARY_URL` recipe, with a §Book detail subsection naming the reason).
- Add the check row: `book-detail-cover-echo` | Book detail captures | echo aligns with
  `.container.md` (±2px), spans the cover, no horizontal overflow, `.book-title` owns its
  own pixel (content paints above the wash).
- Add two bullets to §Vision review: "no visible edge/seam/rectangle where the cover wash
  stops" and "the wash sits behind the cover and title, and text remains the most legible
  element".

## Task 11 — Tests, build, commit

```sh
cd Nostos.Frontend
npx ng test --watch=false            # expect 11 + 4 book-detail tests, 0 failures
VISUAL_QA_LIBRARY_URL=http://localhost:5214 npm run e2e -- book-detail-visual.spec.ts
npx ng build                          # no new budget warning
cd .. && git diff --check
git add Nostos.Frontend/src/app/book-detail/ \
        Nostos.Frontend/e2e/support/visual-capture.ts \
        Nostos.Frontend/e2e/book-detail-visual.spec.ts \
        Nostos.Frontend/e2e/visual-evidence/book-detail-hero-* \
        Nostos.Frontend/angular.json docs/visual-verification.md
git commit -m "feat(book-detail): cover-derived hero wash behind cover and title"
```

Leave the uncommitted Library work alone. Report the vision verdicts and both bundle hashes.

---

## Verification summary

| Gate | Command | Expected |
| --- | --- | --- |
| Unit tests | `npx ng test --watch=false` | all pass; book-detail 11 → 15 |
| Geometry | `VISUAL_QA_LIBRARY_URL=http://localhost:5214 npm run e2e -- book-detail-visual.spec.ts` | `book-detail-cover-echo` pass on both viewports |
| Build | `npx ng build` | green, no new budget warning |
| Vision | `vision_analyze` on both PNGs | PASS recorded per artifact (§Vision review) |
| Deploy | `rsync -a --delete` + origin check | both origins serve the new hash; `wwwroot == dist` |

## Risks / tradeoffs

- **Wash readability.** Mitigated by opacity ≤ 0.28, `saturate(0.62)`, and the mask
  concentrating it behind cover+title. If text contrast drops, lower opacity first.
- **Blur cost.** One 800×560 layer, `blur(38px)`, static, `fetchpriority="low"`. If it
  ever shows in a trace, switch the source to `?width=128` (5.9 KB) — the blur hides it.
- **Top edge brightness** assumes the container starts at the scroll area's top. If a
  header/breadcrumb is ever added above `.container.md`, the top must be masked too.
- **Mask support.** Single `radial-gradient` + `-webkit-` prefix; no `mask-composite`,
  so a partial failure degrades to a hard edge, never to an unclipped rectangle.
- **Subjective outcome.** This is a taste change; the ladder in Task 7 is the honest exit.
  Task 7's V3 (ship nothing) is a real, acceptable outcome.

## Open questions (ask before Task 7's commit, not before Task 0)

1. Should the wash also pick up a faint warm tint on the page's own background (reference
   shows the paper warming toward the cover), or stay strictly a local wash? (Current plan:
   local wash only — no global background change.)
2. Optional, cover-adjacent, **not in this plan**: make the desktop cover column
   `position: sticky` so the cover stays visible while scrolling a long notes list. Say the
   word and I'll add it as its own task with its own capture.
