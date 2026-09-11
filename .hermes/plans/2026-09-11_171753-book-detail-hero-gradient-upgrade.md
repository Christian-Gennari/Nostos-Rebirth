# Book Detail Hero Gradient — Upgrade Plan

> **SUPERSEDED (same day) — read this first.**
>
> The plan was executed, and its central claim did not survive measurement.
> **"The real defect is a missing dither layer" (below) is WRONG.** No banding
> ever existed on this ramp: the 300px gradient resolves ~150-173 distinct 8-bit
> levels with a longest plateau of 5-7px, which is healthy. The dither layer was
> built, shipped behind a failing guard, measured, and **reverted** — it made the
> dark cover *worse* (173 -> 161 levels) and would have cost GPU for nothing.
> The blue-noise generator was abandoned too (void-and-cluster would not
> converge) and deleted. Do not redo Phase 1.
>
> Actual outcome per phase:
> - **Phase 0** — done. `tools/profile-fade.mjs` exists and is the thing that
>   found the real defect.
> - **Phase 1 (dither / blue noise)** — attempted, measured, **reverted**. Dead.
> - **Phase 2 (lightness-derived stops)** — **shipped** as `d6beeee`. The fade
>   now runs `.053/.193/.468/.764/.933`. This was the real win.
> - **Phase 3 (@paper-design/shaders spike)** — never run, no longer proposed.
>
> Two later episodes also belong to this file's history: an anamorphic
> SVG-filter blur was tried and **reverted** (`b5b1e37`) — it was never what made
> the blur read cheap — and the actual cause of "flat and cheap" turned out to be
> **colour**: stacked `saturate()` multipliers put the hero at 138% of its
> cover's own chroma, so a muted cover came out hotter than the artwork. That is
> fixed (`4444273`).
>
> Still valid and worth keeping: the `linear-gradient(in oklab, …)` no-op
> measurement below, the `ditherjs` CC-BY-SA licence rejection, and the profiler.

**Status:** Executed and superseded the same day — see the block above for the
outcome of each phase. Kept for the two findings that held up; do not action
Phase 1 or 3.

**Scope:** `Nostos.Frontend/src/app/book-detail/` hero band. Nothing else.

---

## Verdict up front

**No library is needed for the highest-value improvement, and the two "obvious" library/CSS moves for this gradient are dead ends.** Concretely:

- **Do NOT add `linear-gradient(in oklab, …)` to the fade.** Measured: it changes output by at most **1/255** on **0.8% of pixels** — a rounding artifact, not an improvement. Every stop in the fade, the scrim, and the vignette is *a single colour with varying alpha*, and premultiplied alpha interpolation of one colour returns that colour in any colour space. This would be a placebo change.
- **`ditherjs` is off the table** — CC-BY-SA-4.0 is share-alike, unsuitable for a commercial product.
- **The real defect is a missing dither layer**, and it is a few lines of CSS.
- **`@paper-design/shaders`** is the one library worth a genuine trial — but for the *hero artwork*, not the fade. It is a scoped, reversible Phase 3 with a go/no-go.

---

## Confirmed findings (all measured, not assumed)

### F1. `in oklab` / `in oklch` is a no-op for this gradient
Rendered two 400×300 ramps — `linear-gradient(180deg, rgba(253,248,246,0) → rgba(253,248,246,1))` with and without `in oklab` — over the measured backdrop, and diffed them.

```
max per-channel difference : 1
pixels differing at all     : 1350 of 160000   (0.8%)
```

Reason: with one colour `C` and varying alpha, premultiplied interpolation gives `C·α / α == C` at every step, in **any** interpolation space. Alpha itself is always interpolated linearly. So the interpolation space cannot matter.

Browser support (for the record, if it is ever needed where *two different hues* blend): Baseline since June 2024 — Chrome 111+, Safari 16.2+, Firefox 127+.

### F2. The alpha stops are a smoothstep in *alpha*, but the eye reads *lightness* (minor)
Compositing maps alpha to perceived lightness **non-linearly**, so an alpha smoothstep produces a front-loaded lightness ramp. Measured on the real render:

| stop | current lightness (norm.) | true smoothstep | error |
|---|---|---|---|
| 15% | 0.070 | 0.061 | +0.009 |
| 30% | 0.241 | 0.216 | +0.025 |
| 50% | **0.531** | 0.500 | **+0.031** |
| 70% | 0.803 | 0.784 | +0.019 |
| 85% | 0.945 | 0.939 | +0.006 |

Stops derived by inverting the compositing function for a *lightness* smoothstep:

```
0.000 @ 0%   0.053 @ 15%   0.193 @ 30%   0.468 @ 50%   0.764 @ 70%   0.933 @ 85%   1.000 @ 100%
```

**Honest caveat: this is a ~3% effect. It is a refinement, not the win.** It must not be sold as the fix.

### F3. THE REAL DEFECT — the fade is the only layer with no dither above it
The dither (`.art-grain`) sits *below* the fade in paint order. From the template:

```
42: <img class="art-base">
43: <div class="art-prog">
44: <img class="art-bloom">
45: <div class="art-grain">     ← the dither
46: <div class="art-vig">
47: <div class="art-scrim">
50: <div class="art-fade">       ← z-index: 2  → paints OVER the dither
```

`.art-fade` carries `z-index: 2`. So the 300px ramp — the single most banding-prone surface on the page — is composited as a clean 8-bit ramp with **none** of the page's dithering on top of it. Every other part of the hero is dithered; the fade is not. This is the classic gradient-banding setup and it is present right now.

### F4. The dither itself is the wrong *kind* of noise
Current: `feTurbulence type=fractalNoise baseFrequency=0.85`, opacity `0.055`, `mix-blend-mode: overlay`, on a 160px tile.

White/fractal noise is the **worst** dither for large soft gradients: it is visible at low strength and needs high strength to actually break a band. Blue noise / interleaved gradient noise (IGN) reads considerably cleaner at equal strength, so you can dither harder with less visible texture. Also, dithering only works near 1:1 device pixels — a fixed 160px tile stretched across DPR 1–3 and browser zoom is a moiré risk.

### F5. The fade passes through near-neutral grey (the "muddy" reading)
Measured OKLab chroma across the fade: **0.0400 → 0.0060**, monotonically falling. The lower half is effectively achromatic. Fading a warm dark scene to a near-white page (`--bg-body: #FDF8F6`) must cross grey — it is geometric, not a bug. Changing it means putting *hue* into the fade path, which is the only place a colour-space change would genuinely apply (two different colours blending) — and it is a design decision, not a technical fix.

### F6. Library landscape

| package | version | license | unpacked | runtime? | verdict |
|---|---|---|---|---|---|
| `@paper-design/shaders` | 0.0.80 | Apache-2.0 | 853 KB | yes (WebGL) | **only real candidate** — zero deps, vanilla entry, static modes |
| `ditherjs` | 0.10.0 | **CC-BY-SA-4.0** | — | yes | **reject** — share-alike license |
| `culori` | 4.0.2 | MIT | 1.1 MB | **dev-only** | good — generates stops at build time, zero runtime cost |
| `simplex-noise` | 4.0.3 | MIT | 109 KB | yes | only if we go canvas for blue noise |
| `mesh-gradient` | 1.1.0 | ISC | — | yes | skip — pulls `chroma-js` + `twgl.js`, low activity |
| `colorjs.io` | 0.7.1 | MIT | 15.8 MB | — | overkill |

`@paper-design/shaders` specifics: 3.4k★, 382 commits, last commit Aug 2026, **zero runtime dependencies**, Apache-2.0 with commercial use explicitly permitted. Ships `mesh gradient`, `static mesh gradient`, `static radial gradient`, `dithering`, `grain gradient`, and a vanilla `createShader()` API. `speed: 0` gives a non-animated (battery-safe) shader. Vendor warning from the README: *"Please pin your dependency — we will ship breaking changes under 0.0.x versioning."*

---

## Proposed approach

Four phases, ordered by value-per-risk. **Each phase is independently shippable and independently abandonable.** Phases 1–2 add no runtime dependency at all.

---

## Phase 0 — Measurement harness (prerequisite, ~15 min)

Everything above came from ad-hoc scripts. Make it repeatable before changing anything, so each phase can be judged on numbers rather than on impressions.

### Task 0.1: Add a reusable fade-profiler script

**Files:**
- Create: `Nostos.Frontend/tools/profile-fade.mjs` (a real, committed tool — not a scratch `tmp-*.mjs`)

**Objective:** given a screenshot, print the OKLab lightness ramp, chroma profile, per-block slopes, and the smoothstep deviation for the fade region.

**Step 1:** Implement `srgbToLinear` → `oklabL()` (Björn Ottosson's matrices; the exact ones used for this research are in F2 above and are already written and validated).

**Step 2:** Print, for the fade band: normalised lightness per stop, per-30px slopes, deviation from smoothstep, and chroma min/max.

**Step 3 — verification:** run it against the current committed capture. It must reproduce the F2 numbers (`max deviation 0.031`). If it does not, the harness is wrong — fix it before trusting it for later phases.

**Step 4 — commit** (tool + `package.json` script `profile:fade`).

### Task 0.2: Add a dither-coverage assertion to the e2e check

**Files:**
- Modify: `Nostos.Frontend/e2e/book-detail-visual.spec.ts` (extend `checkBookDetailFade`)

**Objective:** assert in code that a dither layer paints **above** the fade — i.e. catch F3 automatically, so it cannot silently regress again.

**Step 1:** In `checkBookDetailFade`, add: for the fade's own bounding box, `document.elementFromPoint(x, y)` at several points inside the fade must return a dither element (or a dither layer must have a higher computed stacking order than `.art-fade`).

**Step 2 — verification:** run it **before** the fix. It must **FAIL**. A guard that passes against the broken state is worthless.

**Step 3:** Commit with the failing state? **No** — hold this assertion and commit it together with Task 1.1, so the suite is never knowingly red on `main`.

---

## Phase 1 — Dither the fade (no library; highest value)

This is the phase that addresses the actual defect.

### Task 1.1: Put a dither layer above the fade

**Files:**
- Modify: `Nostos.Frontend/src/app/book-detail/book-detail.component.html` (~line 50)
- Modify: `Nostos.Frontend/src/app/book-detail/book-detail.component.css` (`.art-fade`, new `.art-fade-grain`)

**Objective:** the fade region gets dithering of the same family as the rest of the hero.

**Step 1:** Note why the current structure hides the defect: `.art-fade` is a sibling *after* `.hero-art` and carries `z-index: 2`, so it paints above `.art-grain`. Give the fade its **own** dither child (or a sibling with higher z-index), rather than trying to lift the existing grain layer — the existing grain must stay under the scrim so the art keeps its texture.

**Step 2:** Keep the new dither *narrow*: it only needs to cover the fade band, not the whole hero.

**Step 3 — verification:** re-run Task 0.2's assertion → now **PASS**. Re-run Task 0.1's profiler → the OKLab ramp shape must be **unchanged** (dither must not shift the average ramp; if it does, the blend mode or opacity is wrong).

### Task 1.2: Upgrade the dither from fractal noise to blue noise / IGN

**Files:**
- Modify: `Nostos.Frontend/src/app/book-detail/book-detail.component.css` (both grain layers)

**Objective:** same band-breaking power with less visible texture (F4).

**Step 1:** Generate a seamless 64×64 or 128×128 **blue-noise** tile and embed it as a base64 data URI, replacing the `feTurbulence` filter for the fade dither. Blue noise is preferred over white/fractal for gradients precisely because its energy is concentrated at high frequencies that the eye discounts.

**Step 2:** Reduce opacity relative to the fractal version (start ~0.03) and re-measure; the target is a ramp that survives being viewed at 1:1 **without** the reference image's own noise floor becoming visible as texture.

**Step 3:** Guard against DPR moiré — the tile must be sized in device pixels, and verify at DPR 1, 2 and 3 (the capture harness runs DPR 1, so add an explicit DPR-2 capture).

**Step 4 — verification:**
- Task 0.1 profiler: ramp shape unchanged, no luminance dips.
- **1:1 pixel inspection is mandatory** — a screenshot scaled by the browser re-introduces the banding and hides the dither. Review the capture at 100%.
- Vision check on a dark cover *and* a light cover (the light cover is where a too-strong dither shows as dirty texture).

**Step 5:** Commit.

### Task 1.3: Consider whether the fade should keep the grain *below* it too

**Objective:** decide, from the render, whether dithering only above the fade is enough or whether the art under the fade also needs it. **This is an assessment task — measure, then decide, do not change both by default.**

---

## Phase 2 — Perceptual-stop refinement (no runtime dependency)

Small, optional, and honestly labelled: ~3% effect.

### Task 2.1: Derive the fade stops from a lightness smoothstep

**Files:**
- Modify: `Nostos.Frontend/src/app/book-detail/book-detail.component.css` (`.art-fade`)
- Modify: `Nostos.Frontend/src/app/book-detail/book-detail.component.spec.ts`

**Objective:** replace the alpha-smoothstep stops with stops that make the **lightness** ramp a smoothstep.

**Step 1:** Replace the stop alphas `.061/.216/.5/.784/.939` with `.053/.193/.468/.764/.933` (derived in F2), and update the comment to explain that the alphas are lightness-derived, not alpha-derived — the comment currently claims a pure smoothstep and would become wrong.

**Step 2:** Update the spec's slope assertions if the new values shift the end-slope/peak ratios (they are ~4% lower on the early segments, so the "ends ≤ half the peak" rule should still hold — **verify, do not assume**).

**Step 3 — verification:** Task 0.1 profiler must now show `max deviation < 0.01` (from 0.031). Both viewports green. Commit.

### Task 2.2 (OPTIONAL — design decision, not a fix): address the grey midpoint

**Objective:** decide whether to introduce a whisper of the cover's hue into the fade path so it does not land on flat grey (F5).

**Step 1:** This requires a **two-colour** fade (e.g. a faint warm tint in the lower half), which is the *only* place `in oklab` becomes meaningful. If adopted, use `linear-gradient(180deg in oklab, …)` here specifically, and prove it differs from `in srgb` with a pixel diff before claiming any benefit (see F1's method — the diff must show a *real* change, not 1/255).

**Step 2:** Judge it against a dark cover and a light cover, and confirm the title contrast is unaffected.

**Step 3:** If it does not visibly help, **do not ship it** and record why. Present finding to the user before implementing — this is a taste change, and the user asked for exactly one change at a time.

---

## Phase 3 — `@paper-design/shaders` for the hero artwork (the actual library option)

**This is optional, explicitly gated, and reversible.** It is the only place a library genuinely adds something the CSS stack cannot: a *static mesh/grain gradient derived from the cover's own colours*, which is richer than a blur of the cover and can be made cover-specific.

### Task 3.1: Time-boxed spike (throwaway)

**Objective:** answer "does a shader hero actually look better than the current 7-layer CSS lens stack?" **before** proposing it as real work.

**Step 1:** `npm i --save-exact @paper-design/shaders` in a **throwaway scratch directory, not the app** — the vendor ships breaking changes under 0.0.x, so nothing enters the real `package.json` until the spike passes.

**Step 2:** Build a single standalone HTML page: the current CSS stack on the left, a `StaticMeshGradient` / `GrainGradient` fed with 4–5 colours sampled from the *same* cover on the right. `speed: 0` (static).

**Step 3:** Render both, then judge: does the shader read as *this book's* atmosphere, or as generic abstract art? **If it does not read as cover-specific, stop — the current stack wins on identity.**

**Step 4 — verification:** also measure. Capture the hero band's frame time and GPU memory with the shader active vs the CSS stack. A shader that costs materially more on mobile for no visual gain is a rejection.

**Step 5:** Report the answer and **stop for a go/no-go decision.** Do not implement into the app without it.

### Task 3.2 (only if Task 3.1 passes): integrate behind a fallback

**Files:**
- Modify: `Nostos.Frontend/package.json` (pinned exact version)
- Modify: `book-detail.component.ts` / `.html` / `.css`
- Create: a `hero-shader` wrapper that owns the canvas lifecycle

**Requirements:**
- **Pin the exact version** (`--save-exact`); no `^`.
- **Static by default** — `speed: 0`, no continuous rAF loop, no battery drain.
- **Cap cost** — `minPixelRatio: 1`, a bounded `maxPixelCount`, and a hard `width`/`height` so the canvas cannot scale with the viewport unbounded.
- **Fallback is mandatory** — if WebGL is unavailable or the canvas errors, the existing CSS stack renders instead. The current hero must remain the default, not a fallback bolted on later.
- **`prefers-reduced-motion`** → static frame, never animated.
- **Lifecycle** — destroy the shader/context on component destroy. A leaked WebGL context is a hard browser limit (~16) and would eventually kill the hero after enough navigations.
- **Angular**: the app is bootstrapped with `bootstrapApplication` + `provideServiceWorker`; run the shader outside change detection and never let its rAF loop touch signals.
- **Service worker**: verify the new asset is precached or correctly runtime-cached — a canvas hero that fails offline is a regression on a PWA.

**Verification:** both viewports, both DPRs, offline load, `document.querySelectorAll('canvas')` count after navigating away and back (must not grow), and the full unit + e2e tiers.

---

## Files likely to change

| File | Phase |
|---|---|
| `Nostos.Frontend/tools/profile-fade.mjs` *(new)* | 0 |
| `Nostos.Frontend/package.json` | 0 (script), 3 (pinned dep) |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.css` | 1, 2, 3 |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.html` | 1, 3 |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.ts` | 3 |
| `Nostos.Frontend/src/app/book-detail/book-detail.component.spec.ts` | 2, 3 |
| `Nostos.Frontend/e2e/book-detail-visual.spec.ts` | 0, 1 |
| `Nostos.Frontend/e2e/visual-evidence/book-detail-hero-*.{png,json}` | all |
| `docs/visual-verification.md` | 1, 2 |

**Protected / out of scope:** everything under `src/app/library/`, `src/styles.css`, and the other writer's in-flight changes. At the time of writing, 10 files are modified in the worktree by another writer (`library.component.*`, `e2e/support/visual-capture.ts`, `visual-regression.spec.ts`, `library-filters-*` evidence). **Stage explicit paths only.**

---

## Tests / validation

- **Per phase:** `ng build` + the affected spec.
- **Before push:** full unit suite (currently 220 passing). **Note:** the worktree currently carries another writer's modified `library.component.spec.ts`; establish whether failures are yours before reporting.
- **e2e:** `VISUAL_QA_LIBRARY_URL=… npx playwright test book-detail-visual.spec.ts` — on demand only (it is the multi-minute tier).
- **Reuse the existing guards:** `checkBookDetailHero` and `checkBookDetailFade` already assert band geometry and fade *shape* from computed style. Phase 1 extends the latter with dither coverage rather than inventing a new check.
- **Dither cannot be validated from a downscaled screenshot.** Views at 1:1 are mandatory; a scaled capture re-introduces banding and will hide a bad dither.
- **Measure, do not eyeball:** every claim in this plan came from pixel maths. Vision review at full-page scale cannot see a 3% lightness deviation or judge dither strength.

---

## Risks, tradeoffs, and open questions

**Risks**
1. **Phase 2 may not be perceptible.** A 3% lightness deviation is at the edge of noticeability. Ship it as correctness, not as a feature.
2. **A stronger dither can look dirty.** Blue noise is cleaner, but too much is visible as texture — especially on the light/sepia cover. This is the likeliest way Phase 1 makes things *worse*; measure at 1:1 on both covers.
3. **DPR moiré** — a fixed-size tile across DPR 1–3 and browser zoom can produce interference. Test at DPR 2 explicitly; the existing harness only captures DPR 1.
4. **Phase 3 dependency risk** — `@paper-design/shaders` has not reached 1.0 and the vendor states breaking changes ship under `0.0.x`. Exact pinning is mandatory.
5. **Phase 3 WebGL cost** — an extra GPU context plus a canvas on a mobile page that already runs `backdrop-filter` blur stacks. Measure before shipping; the current stack is GPU-heavy already.
6. **Scope creep.** The user asked for exactly one change at a time. Phases must be presented and approved individually.

**Open questions (need a decision, not a guess)**
1. **Which phases to authorise?** Recommendation: **Phase 1 only** first — it fixes the real defect, adds no dependency, and its result can be seen immediately. Phase 0 rides along as its evidence.
2. **Is the grey midpoint (F5) actually what bothers you?** If the "harshness" is about the fade passing through grey rather than about banding, Phase 1 will not fix it and Phase 2.2 becomes the main line — and that is a taste change worth discussing before building.
3. **Is the hero art allowed to become a shader** (Phase 3), accepting an abstract mesh built from the cover's colours in place of a true lens blur of the artwork itself? This trades photographic fidelity for richness — the opposite call from the one made when the 7-layer lens stack replaced flat blur.

**Explicitly rejected**
- Adding `in oklab` / `in oklch` to the existing fade — measured no-op (F1).
- `ditherjs` — CC-BY-SA-4.0 share-alike license.
- `mesh-gradient`, `colorjs.io` — unnecessary dependencies/weight versus the alternatives.

---

## Recommended first step

Approve **Phase 0 + Phase 1**: build the measuring tool, then dither the fade and upgrade the noise to blue noise. No new runtime dependency, no design change, and it addresses the one defect that is genuinely a defect. Phase 2 and Phase 3 should be decided after seeing Phase 1 rendered at 1:1.
