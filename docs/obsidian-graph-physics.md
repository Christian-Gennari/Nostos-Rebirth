# Obsidian 1.13.7 graph physics — extracted from the real app bundle

Source: snap `1.13.7` → `app/resources/obsidian.asar` → `sim.js` (the "Graph Worker")
and `app.js` (renderer + settings). This is not documentation or a blog post; it is
the shipped code, so these values are authoritative.

## Engine

d3-force (velocity Verlet), compiled to **WebAssembly** (`simulate`, `complete`,
`visitCharge`, `visitCollide`, `manyBody`) with a **pure-JS d3-fallback** in the same
file that mirrors the WASM semantics. Runs in a Worker (`/sim.js`, name "Graph Worker").
Rendering is PIXI/WebGL; the worker only computes positions and posts a Float32Array.

## The worker's module-level constants (sim.js)

```js
var Q = 1,                            // alpha
    B = 1 - Math.pow(.001, 1/300),    // alphaDecay ≈ 0.02276
    y = 0,                            // alphaTarget
    c = .1,                           // centerStrength
    E = 1,                            // linkStrength (multiplier)
    v = 250,                          // linkDistance
    x = -1e3;                         // charge strength (= -repelStrength)
```

`velocityDecay` is `0.6` (in the tick: `t.x += t.vx *= .6`; the WASM path passes
`.6` to `complete()`).

## The force set (sim.js: `b = [_, N, q, R, k]`)

| force | built as | final value |
| --- | --- | --- |
| forceX | `.strength(.1)` | strength = **centerStrength** |
| forceY | `.strength(.1)` | strength = **centerStrength** |
| forceLink | `.id(d => d.id).distance(250)` | distance = **linkDistance**; strength = **linkStrength × 1/min(deg(src), deg(tgt))** |
| forceManyBody | `.strength(() => -1e3).distanceMin(30)` | strength = **−repelStrength**, distanceMin **30**, theta default 0.81 |
| forceCollide | `.radius(60).strength(.5)` | radius **60**, strength **0.5** |

Note there is **no `forceCenter`** and no `distanceMax` — centering is done by
forceX/forceY at strength `centerStrength`, i.e. a soft pull per-axis, not a hard
centroid snap.

## The step (sim.js)

```js
X = 1e3 / 60;                     // one frame = 16.67ms, via setTimeout not rAF

function W() {                    // the step
  O = null;
  if (Q > .001) {                 // alphaMin
    P();                          // schedule the NEXT frame
    if (M.length === 0) return;   // no nodes -> stop
    Q += (y - Q) * B;             // alpha decay
    K();                          // one tick: run all 5 forces with alpha Q, then integrate
    Y();                          // post positions back to the renderer
  }
}
function P() { O || (O = setTimeout(W, X)); }
```

Integration (per node, per tick):

```js
if (fx == null) { x += vx *= .6; vx = 0 } else { x = fx, vx = 0 }
if (fy == null) { y += vy *= .6; vy = 0 } else { y = fy, vy = 0 }
```

So: **velocity is persistent and damped by 0.6 each frame**; a pinned node is snapped
to `fx/fy` and its velocity zeroed. The loop stops entirely once alpha ≤ 0.001.

## Interaction → alpha (app.js renderer)

- **Set data** (`setData`, only when nodes/links actually changed):
  `postMessage({nodes, links, alpha: .3, run: true})`
- **Change a force** (`setForces`): `postMessage({forces, alpha: .3, run: true})`
- **Drag move** (renderer pointermove over a node):
  ```js
  node.fx = local.x; node.fy = local.y;
  worker.postMessage({ alpha: .3, alphaTarget: .3, run: true,
                       forceNode: { id, x: local.x, y: local.y } });
  ```
  i.e. pin the node hard at the pointer AND hold `alphaTarget = 0.3` so the
  simulation runs **hot and continuously** for the whole gesture. Neighbours relax in
  real time; the graph never freezes mid-drag.
- **Drag end** (pointerup / pointerupoutside):
  ```js
  node.fx = null; node.fy = null;
  worker.postMessage({ alphaTarget: 0, forceNode: { id, x: null, y: null } });
  ```
  Un-pin and drop `alphaTarget` back to 0 so alpha decays naturally and the layout
  **settles smoothly with inertia** — no snap-back, no freeze.
- **Click vs drag**: a click is only emitted if pointer travel² ≤ 25 (5px threshold).
- Panning/zooming is camera-only; it never touches node coordinates.

## Seeding of NEW nodes (app.js `setData`)

```js
var I = newNodes.length, L = 60*I*60,
    O = Math.sqrt(L/Math.PI + v*v) - v,   // v = sqrt(max r² over existing nodes)
    F = Math.sqrt(L);
for each new node f:
  gather already-positioned related nodes -> centroid (B/H, V/H), count H
  if H > 0:  f.x = centroidX + (rand-.5)*F ;  f.y = centroidY + (rand-.5)*F
  else:      angle = 2π*rand; r = v + sqrt(rand)*O;  f.x = r cos ; f.y = r sin
```

New nodes spawn **next to the neighbours they are already placed with** (jittered by
`sqrt(60*I*60)`), or on a ring of radius ≈ `v` for isolated ones. That is the
"springy big bang" people describe — NOT a uniform random square.

## Settings slider → parameter mapping (app.js)

Defaults (`g0`):

```js
{ centerStrength: u0(.1,.01), repelStrength: 10, linkStrength: u0(1,.01), linkDistance: 250 }
```

| UI slider | limits | posted value |
| --- | --- | --- |
| Center force | 0 – 1, any, step .01 | `centerStrength` directly (default **0.1**) |
| Repel force | 0 – 20, any, step .01 | `repelStrength: e*e*e` (default 10 → **1000**) |
| Link force | 0 – 1, any, step .01 | `linkStrength` directly (default **1**) |
| Link distance | 30 – 500, step 1 | `linkDistance` directly (default **250**) |

In the worker, `x = -repelStrength` and `Math.abs(repelStrength) < 1 && (x = -1)`.

Collide radius/strength is **not** exposed in the UI — it is fixed at 60 / 0.5.

## The user's own vault (for reference)

`~/obsidian/scriptorium/.obsidian/graph.json`:
`centerStrength 0.5187`, `repelStrength 10`, `linkStrength 1`, `linkDistance 250`,
`nodeSizeMultiplier 0.945`, `lineSizeMultiplier 1`. So Christian runs the stock
repel/link values with a much stronger center force and stock 250 link distance.

## Why this differs from the Nostos implementation

Nostos runs **graphology-layout-forceatlas2**: a different algorithm (its own
repulsion/attraction/gravity with adaptive speed), executed **synchronously for 400
iterations** and then frozen, with the settled positions rescaled into stage pixels.
FA2's `assign()` also rebuilds its matrices per call and discards the previous call's
velocity, so per-frame stepping during a drag has no momentum to carry.

The observable consequences, all fixable by moving to the model above:
1. no sustained simulation — the layout is a static snapshot, so nothing settles after
   a drag and the map is inert while idle;
2. no inertia — velocity does not persist, so nodes stop dead instead of gliding;
3. no soft centering — FA2 `gravity` is not the same as forceX/forceY at
   `centerStrength`;
4. no collision term — FA2's `adjustSizes` is not a hard `forceCollide` radius, so
   nodes can still land on top of each other;
5. the portrait fit's anisotropic stretch (`MAX_FIT_ANISOTROPY`) shears the
   physics-space geometry into ellipses, which is physically wrong at any aspect.
