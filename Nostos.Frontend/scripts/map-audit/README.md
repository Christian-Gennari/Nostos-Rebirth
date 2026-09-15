# Concept-map audit probes

Measurement scripts for the Second Brain concept map (Sigma.js + Graphology).
They exist because a WebGL graph cannot be inspected the way a DOM surface can:
there is no per-node element, no computed style to read, and a vision read of a
screenshot is unreliable — these probes were built after a vision pass called a
layout with **zero measured node overlaps** "clumped", and claimed a node was
clipped when measurement showed 74px of clear margin.

Every probe prints JSON and writes it to an output directory. Point them at a
running instance:

```sh
# against production (PM2 app `nostos`, port 5214)
node scripts/map-audit/crowding.mjs http://127.0.0.1:5214 /tmp/audit/crowding

# against a dev server (ng serve defaults to 4200)
node scripts/map-audit/crowding.mjs http://127.0.0.1:4200 /tmp/audit/crowding

# a theme-taking probe takes it as the 4th argument
node scripts/map-audit/dim-reducer.mjs http://127.0.0.1:5214 /tmp/audit/dim light
```

Output defaults to `.map-audit-out/` (gitignored). Pass an absolute path outside
the repo when you just want scratch results.

## Prerequisites

A **real browser** — these launch Chromium through Playwright, already a dev
dependency. They pass `--use-angle=swiftshader`, so they work without a GPU.
WebGL2 must be available: Sigma renders nothing without it.

They need the map's diagnostic handles, which the component publishes after
construction (`globalThis.__nostosSigma`, `__nostosGraph`). Those are read-only
introspection; no application behaviour depends on them.

## The probes

| Script | Question it answers |
| --- | --- |
| `crowding.mjs` | How close are nodes on screen? Counts pairs drawn closer than their combined radii, plus nearest-neighbour distances. A vision read of "hairball" is only actionable if it is measurable. |
| `labels.mjs` | How many labels actually render, and do they collide? Sweeps `labelDensity` and counts ink blobs on the label canvas (0 merged blobs = labels gained without collisions). |
| `dim-reducer.mjs` | **Preferred** dimming measurement. Asks the live `nodeReducer` what colour it gives a non-neighbourhood node, composites it over the field, and reports the true contrast. |
| `dim-elements.mjs` | Pixel-level dimming probe. Useful for a second opinion, but see the caveat below. |
| `trace2.mjs` | Can you tell which edges touch the focused node? Classifies the whole edge layer into accent vs normal ink and reports the balance focused vs unfocused. |
| `fit-oracle.mjs` | Is the graph correctly framed? Derives the ratio independently via `graphToViewport(..., { cameraState })` and compares it to what is shipped, **per viewport shape**. |
| `verify-prod.mjs` | End-to-end check on a deployed instance: framing, labels, off-screen nodes, console errors, in both themes. |
| `shots.mjs` | 1:1 captures of the map in both themes, for visual review. |
| `dogfood.mjs` | Exploratory pass over every surface — controls, focus mode, search, theme change, rapid clicks, repeated drags, mobile layout — reporting PASS/FAIL per check. |

`fit-oracle.mjs` and `verify-prod.mjs` default to 5214 (production);
`crowding.mjs` and friends default to 4200 (dev server).

## Caveats worth knowing before you trust a number

- **Prefer the reducer over pixels for colour questions.** A node is a few pixels
  wide and `graphToViewport` returns fractional coordinates, so a "centre pixel"
  lands on an anti-aliased edge and *understates* the node's ink. A patch-max
  probe makes the opposite error and catches whatever dark edge crosses its box.
  Both mistakes were made while investigating the dimming; they disagreed with
  each other (82% vs 32% "contrast retained") while the reducer's answer — 44% —
  was the correct one.
- **Measure across viewport SHAPES, not just widths.** A landscape desktop
  viewport hides portrait-only bugs. A fit formula that divides by `max(W, H)`
  passes on a wide stage and silently under-fits a tall one; that shipped a zoom
  of 0.604 where 1.0 was needed, leaving 5 of 53 nodes off screen. `fit-oracle.mjs`
  covers desktop, portrait and squarish for this reason.
- **A WebGL canvas cannot be read with `getImageData`/`drawImage`** — the drawing
  buffer is not preserved and you get black. Isolate a layer by hiding the others
  and diffing two screenshots, and diff against the **modal colour** of the image
  rather than a corner pixel: a corner can land on a floating control.
- **Record baselines before your own interactions.** A capture that runs after a
  select/drag step measures a different state and will report a figure your change
  did not produce.
- **A stale `vite-error-overlay` in the DOM swallows pointer events.** The probes
  install an init script that removes it, so a dev server's HMR error does not
  fail a run for reasons unrelated to the app.
