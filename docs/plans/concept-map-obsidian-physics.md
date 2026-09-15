# Plan — make the Nostos concept map use Obsidian's graph physics

Branch: `agent/graph-physics` (worktree `/home/dev/coding/projects/nostos-rebirth-graph-physics`)

## Why

Christian: "the nostos physics are super bugged and unrealistic in comparison."

That is measurable, and it is true. The current implementation is
`graphology-layout-forceatlas2` run **synchronously for 400 iterations and then
frozen** (`concept-map.component.ts:655-660`). Evidence from the live app
(`scripts/map-audit/drag-physics.mjs`, baseline in `/tmp/gp-audit/drag/BEFORE.json`):

| observation | measured |
| --- | --- |
| pointer travels 170.9px dragging a hub | the dragged node moves 168.8px (correct) |
| neighbours of the dragged hub | **51 of 52 move** during the gesture (correct) |
| after release, does the layout keep settling? | **0 nodes move, at every sample up to 2s** |
| does the layout ever settle "with inertia"? | no — nothing persists |
| idle drift | 0.0px (the loop genuinely stops) |

So dragging works, and the loop stops — but the graph **stops dead the instant
the pointer lifts**. There is no inertia, no continued relaxation, no second
settle. Combined with a *post-hoc per-axis stretch* of the frozen coordinates
(`MAX_FIT_ANISOTROPY`, `normalizeGraphPositions`), the geometry the user drags is
not the geometry the physics produced.

## What Obsidian actually does

Extracted from the real shipped bundle, not from documentation:
snap `obsidian 1.13.7` → `app/resources/obsidian.asar` → `sim.js` (the
"Graph Worker") and `app.js` (renderer). Full notes, constants and code excerpts:
**`docs/obsidian-graph-physics.md`** (already committed to this branch).

Summary:

- **d3-force** (velocity Verlet), compiled to WebAssembly with a pure-JS
  fallback in the same file, running in a **Worker**. Rendering is PIXI/WebGL.
- Force set = `forceX(strength)`, `forceY(strength)`, `forceLink`, `forceManyBody`,
  `forceCollide`. **No `forceCenter`** — centering is forceX/forceY at
  `centerStrength`.
- Defaults: `centerStrength 0.1`, `repelStrength 10` (→ `10³ = 1000` cube-mapped),
  `linkStrength 1`, `linkDistance 250`, `velocityDecay 0.6`,
  `alphaDecay = 1 - 0.001^(1/300)`, `alphaMin 0.001`.
- Fixed (not in the UI): `forceCollide().radius(60).strength(0.5)`,
  `forceManyBody().distanceMin(30)`.
- Lifecycle: on data/force change → `alpha = 0.3, run`. On **drag**: pin
  `node.fx/fy` to the pointer and post `alpha: .3, alphaTarget: .3` on **every
  pointermove**, so the simulation runs hot for the whole gesture. On release:
  `fx = fy = null` and `alphaTarget: 0`, so alpha decays and the graph settles
  **with inertia**, then the loop halts.
- **Positions are never rescaled into screen pixels.** The renderer does the fit
  (its own Pan/zoom). The physics stays in one consistent unit system.

## Design for Nostos

Replace ForceAtlas2 with the same five-force d3 simulation, run **live on rAF**,
and stop rescaling positions.

### Constants (in the component, named and commented)

```ts
/** Obsidian's graph forces, verbatim (docs/obsidian-graph-physics.md). */
const OBSIDIAN_FORCES = {
  centerStrength: 0.1,
  repelStrength: 1000,   // UI slider 10, cube-mapped: e*e*e
  linkDistance: 250,
  linkStrength: 1,
  collideRadius: 60,
  collideStrength: 0.5,
  distanceMin: 30,
  velocityDecay: 0.6,
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  alphaMin: 0.001,
} as const;

const SETTLE_ALPHA = 0.3;   // alpha set when data/forces change
const DRAG_ALPHA = 0.3;     // alphaTarget held for the duration of a drag
```

### Key decisions, each backed by a measurement

1. **No position rescale into stage pixels.** `normalizeGraphPositions` is
   deleted. Measured (`scripts/map-audit/live-loop-behaviour.mjs`): rescaling the
   settled layout to stage units and then running the live loop at constants × k
   grows the graph **2.03×** on a portrait stage and **1.40×** on desktop, versus
   **1.03×** with no rescale. The forces are not scale-invariant (the collide
   radius is in sigma units and penetrates), so a rescale silently inflates the
   layout the moment a user drags. Obsidian avoids this by never rescaling.

2. **The renderer does the fit; the fit stays uniform.** `MAX_FIT_ANISOTROPY` and
   the per-axis branch in `normalizeGraphPositions` are deleted. The graph settles
   to its natural aspect and the camera fits it uniformly (`fitCameraState`,
   unchanged — it is already an exact oracle against Sigma's own maths).
   Measured cost of dropping the shear, portrait phone 369x707:
   fillY **0.426 → 0.436** (a 1% gain, because shearing changed the extent
   `uniform = min(scaleX, scaleY)` is computed from). So the stretch bought
   nothing and distorted isotropic geometry while doing it.

3. **Live loop driven by rAF, stepped while `alpha > alphaMin`.** Unlike
   ForceAtlas2 — whose `assign()` rebuilds its matrices every call and discards
   the previous call's velocity (`LIVE_LAYOUT_ITERATIONS`'s whole reason for
   existing at 6 instead of 1) — d3-force keeps `vx`/`vy` between ticks. One
   `tick()` per frame is therefore correct and cheap. `LIVE_LAYOUT_ITERATIONS`,
   `SETTLE_ITERATIONS` and `layoutSettings()` are deleted.

4. **Drag = pin + hold alpha at 0.3; release = unpin + alphaTarget 0.** This is
   Obsidian's exact contract, and it is what produces "neighbours follow, then the
   graph settles with inertia and stops". The loop keeps running during the decay
   phase and halts itself at `alphaMin`, so there is no permanent idle loop.

5. **Camera zoom must preserve node spacing.** Measured on the live app: at
   `ratio 2.09`, 30 of 53 nodes overlapped; at the fitted `ratio 1.247`, 0 did.
   In Sigma, `itemSizesReference: 'screen'` alone keeps radii fixed while
   positions scale as `1/ratio`, so zooming in shrinks the drawn gap until nodes
   collide. Set `zoomToSizeRatioFunction: Math.sqrt` (Sigma's own default, and
   Obsidian's `nodeScale = Math.sqrt(1/scale)`) so radii follow the positions.

6. **Seeding — Obsidian's own.** New nodes spawn on a jittered ring of radius
   `linkDistance + sqrt(rand)*sqrt(60*N*60)` (or beside already-placed
   neighbours in Obsidian). The current hash-based uniform square seed is
   replaced, which also removes the need for the stage-aspect seed scaling that
   only existed to work around it.

### Preserved exactly (not in scope)

- All visual constants: `NODE_SIZE_MIN/MAX` 4–16, `EDGE_*`, `NODE_ALPHA_DIM`,
  `EDGE_ALPHA_DIM`, `LABEL_RENDER_MIN_SIZE`, `EDGE_ALPHA_MIN/RANGE`, the theme
  tokens, the `drawThemeNodeHover` drawer, `labelDensity 1.6`.
- The node/edge reducers, hover/selection model, action rail, search, fullscreen,
  `fitGraph`/`centerSelected`/`zoomIn`/`zoomOut`/`resetView` public API.
- `__nostosSigma` / `__nostosGraph` diagnostic handles (add `__nostosLayout`).

### The invariant that replaces the deleted stretch

> The camera fit must be *uniform*, so on-screen distance is graph distance × (1/ratio).
> Every geometric guarantee is then an invariant of the layout, independent of
> stage size and camera state:
> `min graphNN / collideRadius = min screenNN / (collideRadius/ratio) = constant`.

Verified on the settled layout: the minimum node-centre distance is **125–127**
against a collide radius of **60** in *every* configuration tested — so the
collision term is genuinely doing its job, and `minNN / collideRadius ≈ 2.1`
holds at any stage size.

## Two defects found while doing this (reported, and fixed only where in scope)

1. **Per-node `labelSize` is dead.** The component writes a per-node `labelSize`
   (line 597/608) but Sigma's `drawDiscNodeLabel` reads **only**
   `settings.labelSize` (`sigma/dist/index-fad77a13.esm.js:643-650`). Every node
   renders at the global `12`, and `fitOccupancy()` reserves gutter based on the
   per-node value (10–16). In scope because the fit's job is to keep labels from
   being clipped, so the gutter must use the size actually drawn — use
   `settings.labelSize` (12).
2. **`fitOccupancy`'s comment describes a different model.** It says labels are
   "centered on its node" and computes a half-width overhang, while
   `drawDiscNodeLabel` draws from `data.x + data.size + 3` — a right-side offset.
   The formula happens to be in the right ballpark; the comment is wrong. Correct
   the comment, keep the bound.

## Files

| file | change |
| --- | --- |
| `Nostos.Frontend/package.json` | + `d3-force@^3.0.0`, + `@types/d3-force@^3.0.10` (already installed on this branch) |
| `src/app/second-brain/concept-map/concept-map.component.ts` | the physics rewrite |
| `.../concept-map.component.spec.ts` | replace the ForceAtlas2 mock with a d3-force mock; keep every existing behavioural assertion; add physics guards |
| `src/app/second-brain/second-brain.component.spec.ts` | its `vi.mock('graphology-layout-forceatlas2')` is now unused — remove |
| `e2e/brain-map-stage.spec.ts` | keep the 0-overlap / p25NN guards (they must still pass) |
| `e2e/brain-physics.spec.ts` | **new** — live drag relaxation, inertia then stop, zoom preserves spacing |
| `scripts/map-audit/*` | the 6 probes used for this work, + README entries |
| `docs/obsidian-graph-physics.md` | the extraction notes (done) |

## Acceptance criteria (must all be shown with real output)

1. `npm run check` clean; `npm test` green; `npm run build` succeeds.
2. `scripts/map-audit/drag-physics.mjs` against the running map:
   - neighbours move while dragging (non-zero, as before);
   - **after release, nodes keep moving (inertia) and then reach 0 idle drift** —
     this is the bug being fixed;
   - idle drift 0.0px over several seconds (no permanent loop).
3. `scripts/map-audit/crowding-at.mjs` at 1440x900 and 390x844: 0 overlapping
   pairs, `p25NN >= 12`, `offscreen === 0`, and portrait `medianNN` clearly
   better than the BEFORE baseline (19.0 → target ≥25).
4. `e2e/brain-map-stage.spec.ts` and `e2e/brain-map-framing.spec.ts` pass.
5. 1:1 captures of the map in both themes, attached as before/after evidence.

## Baselines to beat (captured before any change)

```
1440x900 stage 990x730: minNN 39.9  p25NN 48.9  medianNN 60.5  overlaps 0  offscreen 0  fillX 0.701 fillY 0.880 labels 43
 390x844 stage 369x707: minNN 12.0  p25NN 15.2  medianNN 19.0  overlaps 0  offscreen 0  fillX 0.616 fillY 0.426 labels  6
drag: nodeTravel 168.8 of pointerTravel 170.9; after release 0 nodes move at every sample; idle drift 0.00
```

**Expected after** (from `scripts/map-audit/ship-calibration.mjs`, on the real
53-node graph): desktop `medianNN ~62` (unchanged, no regression), portrait
`medianNN ~29.6` (+56%), 0 overlaps, 0 offscreen, fillY 0.436.
