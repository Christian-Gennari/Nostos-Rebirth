# App-wide removal of the ghost skeleton → fades + lens blur

**Date:** 2026-09-12
**Scope:** `Nostos.Frontend/src` (Angular). Pure frontend, no backend/API change.
**Goal:** No ghost skeleton anywhere in the app. Every loading moment becomes a
fade / lens-defocus dissolve on already-present geometry. Premium, calm, zero jitter.
**Precedent:** `.hermes/plans/2026-09-11_151752-library-filter-crossfade-toolbar-stability.md`
shipped the library cross-fade (blur-out 180ms / resolve-in 260ms). That work
explicitly kept the skeleton for the genuine first paint — this plan is the
follow-up that removes it too.

---

## 1. What is actually on screen today (verified, with line numbers)

### Tier 1 — the real ghosts (pulsing placeholder blocks)

**1. Library, first paint only**
- `app/library/library.component.html:120-176` — `@if (loading())` branch: **10**
  ghost list rows (`:121-158`) or **12** ghost grid cards (`:160-176`).
- `app/library/library.component.css:838-895` — `@keyframes pulse` (`1.5s ease-in-out infinite`),
  `.skeleton-block / .skeleton-box / .skeleton-line` (`:847-866`), `.skeleton-block.list-cover-skeleton`
  (`:859`), `.skeleton-list-view .table-row` geometry (`:869-881`), and the
  skeleton's own fade-in selectors (`:890-893`), mirrored for reduced motion at `:1206-1209`.
- `.skeleton-card` (`html:162`) has **no CSS rule at all**.
- Reached only while `!hasLoadedBooks()` (`library-preferences.service.ts:41`, session-only signal).
- Why it jitters: pulses; renders 10/12 items against a real first page of
  **20** (`library-preferences.service.ts:19`); and `.skeleton-line` metrics
  (`1.5rem` + `.75rem` margin) don't match real `.meta-title`/`.meta-author`
  (`1rem`/`.85rem`, `.2rem` gap) — so the bottom edge and the scrollbar move even
  at equal item counts.

**2. Book detail**
- `app/book-detail/book-detail.component.html:3-18` — `@if (store.loading())`
  branch: `.skeleton-line` ×3, `.skeleton-box.cover-size`, `.skeleton-block`.
- `app/book-detail/book-detail.component.css:1218-1257` — **duplicate**
  `@keyframes pulse` plus its own copy of the 5 skeleton rules.
- Why it jitters: it's a third hard cut on a page that otherwise fades
  (skeleton → book), and the ghost's cover box is a different subtree from the
  real cover frame.

### Tier 2 — loading copy / overlays shown by hard cut (`@if` teardown)

**3. Reader shell** — `app/reader/reader-shell.component.html:4-6`: `.loading`
"Loading book..." text, removed instantly. The shell *already* has the right
mechanism next to it: `.reader-layout { opacity: 0 }` → `.ready { opacity: 1 }`.

**4. EPUB reader** — `app/reader/epub-reader/epub-reader.component.html:5-8`:
`.loading-overlay` (css `:66-78`) — an **opaque white full-cover** panel with
"Opening book..." that vanishes in one frame, covering a viewer that is already
rendering underneath.

**5. Audio reader** — `app/reader/audio-reader/audio-reader.component.html:20-25`:
`.audio-loading` with `.audio-loading-icon` running
`animation: audio-loading-pulse` (css `:89-115`, opacity `0.4 ↔ 1`) — a literal
pulse, i.e. exactly the jitter the user is objecting to.

**6. Second Brain** — `app/second-brain/second-brain.component.html:42-45`:
`.loading-state > .spinner`. **Neither class has any CSS anywhere in the app**
(verified: no `spinner` / `loading-state` rule in `second-brain.component.css`,
509 lines, or in `styles.css`) → it renders an empty div, i.e. an invisible
loading indicator. The real defect here is the hard cut, plus
`animate.enter="fade-in"` on `.concept-header` referencing keyframes (`fade-in`)
that **do not exist** — a dead animation.

### Tier 3 — the pops that the skeletons were masking (this is the "nice fades" work)

**7-9.** Cover/art `<img>` elements with no load state and no transition:
- `app/library/library.component.html:322-329` (`.cover-image`, grid)
- `app/library/library.component.html` (`.list-cover-img`, list view)
- `app/reader/audio-reader/audio-reader.component.html` (`img.cover-img`)
→ each pops in fully sharp the instant it decodes.

**10. Book detail is the only surface already doing it right**: `heroArtLoaded()`,
`coverLoaded()`, `onCoverLoad()` (`book-detail.component.ts:126-165`) drive
`.loaded` dissolves, and the hero has the full lens stack (defocused base →
progressive defocus → halation → grain → vignette → scrim → fade). This is the
reference implementation; the plan generalises it.

### NOT skeletons — identified so they are not swept up by mistake

- `--bg-skeleton` (`styles.css:11`) used as the **image ground** behind a cover:
  `library.component.css:635` (`.cover-wrapper`), `book-detail.component.css:385`
  (`.cover-frame`), `audio-reader.component.css:57` (`.placeholder-art`). Static
  warm paper behind an image, never animated. **Keep** (rename only, step 7).
- `settings.component.css:346-357` — `.spin` / `@keyframes spin`: genuine
  imperative progress. Keep.
- `app.component.css` — `.route-progress` navigation bar. Keep.
- `add-book-modal` — `uploadProgress()` "Uploading... N%" is real upload
  progress. Keep.
- `library.component.html:448` — `@if (loadingMore())`: infinite-scroll appends
  in place, already correct. Keep.

### Noticed but OUT OF SCOPE (separate tickets, listed only)

- `second-brain.component.css:417` — `.note-card { animation: slideUpFade .4s … forwards }`:
  `forwards` pins `opacity`/`transform`, silently killing later opacity rules,
  and it re-runs on every render.
- `app/route-transitions.css` — **orphaned**: imported nowhere (not in `src`, not
  in `angular.json`).
- `@keyframes pulse` is declared twice under the same name in two component
  stylesheets (library + book detail).

---

## 2. The replacement: one motion contract, three primitives

Global motion tokens already exist in `styles.css:86-91` (`--motion-fast: 160ms`,
`--motion-base: 220ms`, `--motion-slow: 320ms`, `--ease-standard`, `--ease-out`,
`--ease-spring`) — reuse them, and add only two: `--motion-bloom: 420ms` and
`--motion-wait: 2600ms` (the ambient breath period). The library keeps its local
`--library-swap-*` aliases so `SWAP_OUT_MS`/`SWAP_IN_MS` in
`library.component.ts` stay the single source.

**A. Stage swap — leaving.** Already shipped and approved in the library.
Out: `opacity 1→0.35`, `filter: blur(5px) saturate(.92)`, `scale(1→.995)`, 180ms,
`pointer-events: none`. In: 260ms back to sharp. Becomes the app-wide default for
*any* in-place content replacement.

**B. Lens bloom — arriving art.** `opacity 0→1`, `filter: blur(12px)→blur(0)`,
`scale(1.03)→1`, **420ms** `--ease-out`. This *is* the "lens blurring": an image
resolves out of defocus instead of popping. Applied to covers and full-bleed
backdrops only.

**C. Wait field — waiting for data.** Replaces every skeleton and every
"Loading…" label. One shared, **structureless** full-cover field (page paper
tone, `backdrop-filter: blur(6px)` where supported) carrying a **slow, low-amplitude
ambient breath**: `--motion-wait: 2600ms`, `ease-in-out`, opacity `0.62 ↔ 0.78`,
on a pseudo-element layer. No rows, no bars, no shimmer — there is no structure
to jitter and no metrics to mismatch. When content lands the field dissolves out
over `--motion-slow` (320ms) and the breath stops at that moment so the two
motions never compound. *This is the "premium field pulsing" the user asked for:
a soft breathing surface, not rows blinking.*

The distinction that matters: the ghost skeleton pulsed **structure** (rows
appearing/disappearing at a different rhythm and different metrics from the real
content) — that is what read as jitter. The wait field breathes **light**, is
layout-inert, and can neither move anything nor disagree with the content it is
covering.

The same softer treatment applies to the audio reader's icon: today it runs
`audio-loading-pulse 1.2s` at opacity `0.4 ↔ 1` (fast, deep = blinks). It becomes
`--motion-wait` 2.6s at `0.62 ↔ 0.78` — the same breath as the field, so the app
has one waiting rhythm everywhere.

**Guard rails.**
- `prefers-reduced-motion: reduce` → no breath, no veil dissolve, no bloom;
  content commits instantly (consistent with the existing global block at
  `styles.css:117` and the library rule at `css:1206-1209`).
- Coarse pointer / mobile → no `filter: blur()` on any full-grid subtree; the
  field and bloom degrade to opacity only.
- A field/bloom element must always be dismissed on **both** `load` and `error`,
  so a failed image can never leave content invisible (the failure mode the
  skill flags).

---

## 3. Per-surface replacement spec

| Surface | Today | Replaced with |
|---|---|---|
| Library first paint | 10 ghost rows / 12 ghost cards, pulsing | Delete both branches + all skeleton CSS. `.results-stage` holds a session-remembered `min-height` (from the last populated render) so the scrollbar cannot flip. **Wait field** covers the stage while `!hasLoadedBooks()`, dissolving out under the arriving results (A in-phase) |
| Book detail | Skeleton branch (html `3-18`) + duplicate pulse | Delete branch + skeleton CSS. Mount the real layout immediately (null-safe on `book()`); hero band renders `.no-art` paper, art **blooms** in (B) when the payload lands, cover dissolves via the existing `.loaded`. **Wait field** over the wrapper during the cold load |
| Reader shell | `.loading` text, hard cut | Delete the text. The existing `.reader-layout opacity 0 → .ready opacity 1` becomes the only transition; **Wait field** over the frame while `!ready()` |
| EPUB reader | Opaque white overlay, one-frame removal | Keep the element, drive it with `[class.is-hidden]` instead of `@if`, so it fades + blurs off (opacity 0, `blur(10px)`, 260ms) revealing the page already rendered beneath; `visibility: hidden` + `pointer-events: none` when hidden so it can't trap input |
| Audio reader | Pulsing icon + "Loading audio…" | Delete `audio-loading-pulse` (icon becomes static + dimmed), label fades; cover gets bloom (B); keep the `.placeholder-art` ground |
| Second Brain | Dead invisible `.spinner` + hard cut | Delete `.loading-state`/`.spinner` markup. The detail pane dissolves in on arrival using A, replacing the dead `animate.enter="fade-in"` |
| Covers app-wide (grid, list, audio, home Reading Room) | Pop on decode | Bloom (B), bound to `(load)` **and** `(error)`; one shared helper (small directive or `(load)` + class toggle) rather than per-component one-offs |
| PDF reader | ngx-extended-pdf-viewer's own spinner | **Out of scope** (user decision 2026-09-12) — vendor spinner untouched |
| `--bg-skeleton` token | Name implies a skeleton | Keep value, rename to `--surface-image-ground` (3 usages) — removes the last "skeleton" hit from the codebase |

---

## 4. Phases (each independently shippable, build + tests green)

1. **Primitives, no behaviour change** — `--motion-bloom` / `--motion-wait`
   tokens, the Wait-field component, the shared image-bloom helper. Verify: `npx ng build` green, nothing visually different.
2. **Covers bloom everywhere** — kills the pops the skeletons were hiding; the
   highest-value visible win, and it lands *before* any skeleton is deleted so
   no surface is ever left abruptly blank. Verify: screenshots of grid, list,
   audio, home.
3. **Library first paint** — delete skeleton markup + CSS, stage `min-height`,
   Wait field. Verify: cold load on throttled Slow 3G (no blank flash, no scrollbar
   flip), filter change still cross-fades, re-entry from another route does not
   flash.
4. **Book detail** — delete the skeleton branch, mount real layout, Wait field,
   art bloom.
5. **Readers** — reader-shell text → shell fade; EPUB overlay → class-driven
   dissolve; audio icon/label.
6. **Second Brain** — delete the dead spinner + its dead `animate.enter="fade-in"`
   attribute (same line being replaced; the keyframes it names never existed),
   dissolve the detail pane.
7. **Cleanup + gates** — token rename, rewrite the specs, add a repo-wide gate
   that `skeleton` appears nowhere in templates/stylesheets, update
   `docs/visual-verification.md`, re-shoot the 10 visual artifacts.
8. **Later** — add-book modal upload progress softening.

## 5. Tests & docs

- `app/library/library.component.spec.ts` — 14 skeleton references. Rewrite:
  assert no `.skeleton-*` element ever appears; keep "never returns to the ghost
  skeleton after the first load"; the existing swap / sequence-number /
  stale-response tests are unchanged.
- `app/book-detail/book-detail.component.spec.ts` — skeleton refs become
  "mounts immediately, hero band carries `.no-art` while in flight".
- New gate: `skeleton` must not appear in any `.html` or `.css` under `src/`.
- `docs/visual-verification.md` + the 10 visual-capture artifacts: re-shoot;
  expected diffs on library cold, book-detail cold, second-brain.

## 6. Verification

- Per phase: `npx ng build` and `npx ng test --watch=false`.
- Live: backend `dotnet run -c Release` (`Nostos.Backend`, :5214) + `ng serve`.
  Check cold load under Slow 3G, a filter change for the intact cross-fade,
  `prefers-reduced-motion: reduce` for instant commits, and mobile emulation.
  Per the skill: DevTools device emulation does **not** match touch media
  queries — verify the coarse-pointer branch on the real device via the
  Tailscale dev server, not in emulation.
- Evidence: before/after screenshots per surface, attached to the report.
- Rollback: pure frontend, one commit per phase, `main`, no branches.

## 7. Decisions (locked 2026-09-12)

1. **Cold first paint — Wait field.** One shared structureless field with a slow
   ambient breath, dissolving out when content lands. Not blank paper.
2. **Bloom weight — 12px / 420ms.** Richer lens resolution on arriving art.
3. **PDF vendor spinner — out of scope** this pass.
4. **Adjacent findings.** User's intent restated: *no skeletons anywhere,
   replaced by soft premium pulsing / fades / blur fades, for both transitions
   and load-waiting.* Therefore:
   - **In:** the dead `animate.enter="fade-in"` attribute in second-brain — it
     sits on the exact line being replaced and names keyframes that never
     existed. Deleted as cleanup, not as new scope.
   - **Out (separate tickets, untouched):** `.note-card { animation: … forwards }`
     in `second-brain.component.css:417`, and the orphaned
     `app/route-transitions.css`.

### Not-yet-built context for the reader
There is an existing **`@keyframes library-content-in`** entry fade
(`library.component.css:896+`, `both` fill) applied to both the skeleton and the
results, plus a documented reason the animation lives on the content blocks
rather than on `.results-stage` (a filled animation there would out-specify the
swap state's dim/blur on the same property). Any new arrival animation must
respect that constraint: put the fade on the content block, never on the stage
that carries the swap state.
