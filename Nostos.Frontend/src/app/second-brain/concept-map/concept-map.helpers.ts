import type { SimulationNodeDatum } from 'd3-force';
import type { ConceptDto } from '../../core/services/concepts.service';

export const MAX_MAP_CONCEPTS = 150;

/* ── Visual constants ── */
export const NODE_SIZE_MIN = 4;
export const NODE_SIZE_MAX = 16;
export const EDGE_SIZE_MIN = 0.75;
export const EDGE_SIZE_MAX = 3;

/**
 * Label font size, in px, for EVERY label.
 *
 * There is deliberately no per-node range here any more. The component used to
 * compute one (10-16) and store it as a node attribute, but Sigma renders every
 * label at `settings.labelSize` — `drawDiscNodeLabel` consults
 * `data[labelColor.attribute]` for the label's COLOUR and nothing for its size
 * (`sigma/dist/index-fad77a13.esm.js:643-650`). So the per-node value was dead
 * config, and `fitOccupancy()` was reserving gutter against a number no label
 * was ever drawn at. One named constant now feeds both the setting and the
 * gutter calculation, so they cannot disagree.
 */
export const LABEL_DRAW_SIZE = 12;

/**
 * Edge alpha floor. Measured on the real graph field: at the previous floor
 * (0.44-0.54) an isolated edge's strongest pixel differed from the field by
 * only 8-17 of 765 — a contrast ratio of 1.05:1, i.e. invisible. Sweeping alpha
 * against the same field and camera gave max deltas of 115 at 0.6, 266 at 0.8
 * and 365 at 1.0, so the floor is the lever, not the stroke width.
 */
export const EDGE_ALPHA_MIN = 0.62;
export const EDGE_ALPHA_RANGE = 0.38;

/**
 * Dimming applied to nodes that are NOT connected to the active node.
 *
 * Measured: at 0.55 a dimmed node retained only 21% of its contrast in the light
 * theme (1.66:1 against the field) — the "everything else melts into the
 * background" report.
 *
 * At 0.70, measured by compositing the reducer's own output over the field
 * (scripts/map-audit/dim-reducer.mjs), both themes clear the 3:1 non-text
 * minimum while the active neighbourhood still dominates:
 *
 *   light  composite rgb(137,133,127) on rgb(253,248,246) -> 3.48:1 (44% retained)
 *   dark   composite rgb(130,126,120) on rgb(21,24,31)    -> 4.40:1 (50% retained)
 *
 * Prefer that probe over screenshot sampling: a node is a few pixels wide, so a
 * "centre pixel" lands on an anti-aliased edge and understates the ink, and a
 * patch-max probe instead catches whatever dark edge crosses the box.
 */
export const NODE_ALPHA_DIM = 0.7;

/** Edges not touching the active node: quieter than nodes, but still present. */
export const EDGE_ALPHA_DIM = 0.34;

/**
 * Minimum DRAWN radius for a node to get a label. Decollision is left to Sigma's
 * label grid.
 *
 * Sigma tests this against `scaleSize(size)`, the radius it actually draws
 * (`sigma/dist/sigma.esm.js` — `var size = this.scaleSize(data.size); if
 * (!data.forceLabel && size < this.settings.labelRenderedSizeThreshold) continue`),
 * NOT against the stored `size` attribute. So the number that matters is
 * `NODE_SIZE_MIN / sqrt(ratio)` at the fitted zoom, not `NODE_SIZE_MIN`:
 *
 *   fitted ratio ~1.91  ->  smallest drawn radius 4 / sqrt(1.91) = 2.89px
 *
 * The previous value (3.2) was calibrated when radii did not scale with the
 * camera, so the floor was exactly `NODE_SIZE_MIN` = 4.0. Leaving it at 3.2 after
 * switching to `Math.sqrt` silenced 47 of 53 labels, because most concepts share
 * the minimum usage count and sit exactly at the 4px floor once scaled.
 *
 * 2.4 clears that 2.89px floor with margin at the fit, so every node is labelled
 * on open, while still letting labels recede as the user zooms out (a larger
 * ratio shrinks drawn radii past the threshold) — which is Obsidian's behaviour,
 * where labels fade with zoom rather than being pinned on forever.
 * `concept-map.component.spec.ts` asserts the relationship so it cannot regress:
 * the threshold must stay below `NODE_SIZE_MIN / sqrt(fitted ratio)`.
 */
export const LABEL_RENDER_MIN_SIZE = 2.4;

/**
 * Edge allowance, as a fraction of stage width, so the outermost nodes' discs are
 * not flush against the canvas.
 *
 * This used to be a label gutter deliberately sized to the widest concept name,
 * because Sigma's label drawer only ever drew to the RIGHT of a node and anything
 * past the canvas edge was silently truncated. That reservation is no longer
 * needed: `drawFlipsAtEdgeNodeLabel` moves a label to the other side of its node
 * when it would overflow, so the text always fits at any stage width.
 *
 * Keeping the reservation was actively harmful. On a 369px phone stage the gutter
 * cap resolved to 55px a side, which made the WIDTH the binding axis of the fit
 * (occupancy.x 0.75 against occupancy.y 0.88) and spent the difference on empty
 * margin, shrinking every node: the graph measured fillX 0.748 with a mean node
 * radius of 2.0px, where a small constant allowance gives the map back its width
 * (fillX 0.84) and draws the nodes larger (mean radius 2.4px). The allowance
 * covers the largest node's disc plus half Sigma's label offset, which is all the
 * framing needs now that the text cannot overflow in the first place.
 */
export const LABEL_EDGE_ALLOWANCE_FRACTION = 0.04;

/** Sigma's default horizontal offset from a node to the start of its label. */
export const LABEL_OFFSET_PX = 10;

/** Fraction of the stage a fitted graph should occupy, with no label inset. */
export const FIT_OCCUPANCY = 0.88;

/* The stage-aspect seed and the per-axis stretch that used to live here are both
 * gone, and their removal is the point of this change rather than a tidy-up.
 *
 * `normalizeGraphPositions` rescaled the settled layout into stage pixels, solving
 * each axis independently and clamping the ratio to 1.4x, so a portrait phone got
 * an isotropically-correct layout sheared into ellipses after the fact. Two things
 * were wrong with it, both measured:
 *
 *  1. It bought nothing. Re-running the fit without any shear on a 369x707 stage
 *     left the graph BETTER framed: fillY 0.426 -> 0.436. The shear only shifted
 *     the extent that `uniform = min(scaleX, scaleY)` is derived from, so it was
 *     filling the long axis by emptying the short one.
 *  2. It corrupted the live physics. Rescaling settled positions by k and then
 *     running the force simulation at constants x k is not the same system: the
 *     collide radius is in sigma units and penetrates, so the graph inflated by
 *     2.03x on a portrait stage (1.40x on desktop) the moment a user dragged
 *     (`scripts/map-audit/live-loop-behaviour.mjs`). Without the rescale the same
 *     loop grows the graph by 1.03x — the order of a normal re-heat settle.
 *
 * Obsidian never rescales either: its worker keeps the physics in one unit system
 * and the renderer's pan/zoom does the framing. Sigma's camera already does that
 * here, so positions stay in graph units and the fit stays uniform.
 */

/** Stable initial coordinates keep captures and sessions reproducible. */
export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Obsidian's `setData` seeding, adapted to a whole-graph build.
 *
 * Obsidian spawns a new node beside the already-placed neighbours it shares edges
 * with, and falls back to a ring for one that has none:
 *
 *   var L = 60 * I * 60;                       // I = number of new nodes
 *   var O = Math.sqrt(L / Math.PI + v * v) - v;
 *   var angle = 2 * Math.PI * Math.random();
 *   f.x = r * Math.cos(angle); f.y = r * Math.sin(angle)
 *   //   r = v + Math.sqrt(Math.random()) * O          (v = collide radius, 60)
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *  * the ring is keyed on the **collide radius** `v`, not on `linkDistance`.
 *    `v` is 60 while `linkDistance` is 250, and the `-v` term cancels the `v +`
 *    out of `O`, so the ring sits at roughly `sqrt(60*N*60/π)` ~ 246 for 53 nodes.
 *    Using `linkDistance` here instead inflates the seed radius by ~270% and the
 *    settled graph then comes out smaller on screen (measured: desktop fillX
 *    0.626 against the shipped 0.701).
 *  * the angle must be drawn per node, not stepped. A golden-angle spiral is a
 *    tempting deterministic substitute but it is strongly structured, and the
 *    layout inherits that structure: measured on the live graph it settled to an
 *    aspect of 1.61 against the ~1.05 this force set produces from Obsidian's
 *    own uniform-random angles. That elongation alone cost the portrait stage its
 *    height fill. `hashSeed` gives the same statistical spread while keeping a
 *    capture and a test run reproducible, which `Math.random` would not.
 */
export function seedPositions(
  nodes: Array<{ id: string; x: number; y: number }>,
  collideRadius: number
): void {
  const count = Math.max(nodes.length, 1);
  // Obsidian's `L`/`O`, with `v` = collide radius.
  const spread = Math.sqrt((SEED_RING_SCALE * count) / Math.PI + collideRadius * collideRadius) - collideRadius;

  nodes.forEach((node) => {
    const angle = hashSeed(`${node.id}:angle`) * 2 * Math.PI;
    const radius = collideRadius + Math.sqrt(hashSeed(`${node.id}:radius`)) * spread;
    node.x = radius * Math.cos(angle);
    node.y = radius * Math.sin(angle);
  });
}

/**
 * The d3 simulation's node shape. Graphology owns the attributes Sigma renders
 * from; the simulation works on these plain objects and the result is written
 * back, so one source of truth (the graph) is preserved.
 *
 * `size` is carried as well as the coordinates because d3's integration step
 * writes `x`/`y` onto these same objects and the tick handler copies the whole
 * record back — so a field that is absent here would silently blank the node's
 * radius on the first frame after a drag.
 */
export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  size: number;
}

/**
 * Pointer travel, in CSS pixels, before a press on a node counts as a drag
 * rather than a click. Without a threshold the sub-pixel movement of an
 * ordinary click trips the drag path and the click-to-select that follows is
 * suppressed.
 */
export const DRAG_THRESHOLD_PX = 3;

/* ── Obsidian's graph forces ──
 *
 * The map previously ran graphology's ForceAtlas2 once, synchronously, and then
 * froze the result. It is replaced with the force set Obsidian actually uses,
 * read out of the shipped 1.13.7 bundle (`app/resources/obsidian.asar` →
 * `sim.js`, the "Graph Worker") rather than from documentation. The extraction
 * notes, with the engine internals quoted, are in `docs/obsidian-graph-physics.md`.
 *
 * The five forces and every default below are Obsidian's, verbatim. They are
 * deliberately NOT tuned to Nostos: the point of this change is that the map
 * behaves like the graph view it is being compared against.
 *
 * In Obsidian these same numbers are exposed as the four "Forces" sliders; the
 * two fixed values (collide radius/strength) are not in the UI at all.
 */
export const OBSIDIAN_FORCES = {
  /** `centerStrength` slider, default 0.1. Applied to forceX AND forceY. */
  centerStrength: 0.1,
  /**
   * `repelStrength` slider, default 10. Obsidian cube-maps the slider before
   * posting it (`setForces({repelStrength: e*e*e})`), so the force receives
   * 10³ = 1000 and the worker negates it (`x = -repelStrength`).
   */
  repelStrength: 1000,
  /** `linkDistance` slider, default 250. */
  linkDistance: 250,
  /** forceCollide radius. Fixed in Obsidian, not exposed as a setting. */
  collideRadius: 60,
  /** forceCollide strength. Fixed in Obsidian, not exposed as a setting. */
  collideStrength: 0.5,
  /** forceManyBody distanceMin, fixed in Obsidian. */
  distanceMin: 30,
  /** Integration damping; Obsidian's worker multiplies velocity by 0.6 per tick. */
  velocityDecay: 0.6,
  /** `alphaDecay = 1 - 0.001^(1/300)`, d3's default, at which alphaMin is reached in 300 ticks. */
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  /** Below this alpha the simulation halts entirely. */
  alphaMin: 0.001,
} as const;

/**
 * Obsidian's `linkStrength` slider default, applied as a MULTIPLIER on d3's own
 * per-link strength rather than as a replacement for it.
 *
 * Obsidian's worker keeps the function it captured before the override and
 * returns `E * captured(link, i, links)`, so the degree weighting survives a
 * slider move. Passing a plain number to d3 instead replaces that function with
 * a constant (`d3-force/src/link.js:108`). At the default the two happen to agree,
 * which is exactly why the distinction has to be written down rather than
 * discovered later when someone wires the slider up.
 */
export const OBSIDIAN_LINK_STRENGTH = 1;

/**
 * Alpha applied when the graph data or the forces change.
 *
 * Obsidian posts `alpha: .3, run: true` on `setData` and on `setForces`. Alpha is
 * an energy budget, not a force balance: the settle is "run hot, then cool to
 * alphaMin and stop", which is what makes the layout keep relaxing and then halt.
 */
export const SETTLE_ALPHA = 0.3;

/**
 * Alpha target held for the whole of a drag gesture.
 *
 * Obsidian re-posts `alpha: .3, alphaTarget: .3` on EVERY pointermove while a node
 * is dragged, so the simulation runs hot and continuously for the gesture and the
 * neighbours relax in real time. On release it posts `alphaTarget: 0`, and alpha
 * then decays naturally — which is the inertia the map was missing: previously
 * the layout froze the instant the pointer lifted (measured: 0 nodes moved at
 * every sample up to 2s after release).
 */
export const DRAG_ALPHA = 0.3;

/**
 * Obsidian's `forceCollide` radius, as a multiple of `linkDistance`.
 *
 * Used only for seeding: new nodes are spawned on a ring around the graph's
 * centre at roughly one link distance, which is what Obsidian's `setData` does
 * (`r = v + sqrt(rand) * O` where `O = sqrt(60*N*60/π)`), not the uniform random
 * square this component used before.
 */
export const SEED_RING_SCALE = 60 * 60;

/* Nostos theme tokens read at runtime from CSS custom properties. */
export function getCssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mixHex(first: string, second: string, amount: number): string {
  const a = first.replace('#', '');
  const b = second.replace('#', '');
  const channel = (source: string, offset: number) => parseInt(source.slice(offset, offset + 2), 16);
  const mix = (offset: number) => Math.round(channel(a, offset) + (channel(b, offset) - channel(a, offset)) * amount);
  return `#${[0, 2, 4].map((offset) => mix(offset).toString(16).padStart(2, '0')).join('')}`;
}

export interface ThemeColors {
  node: string;
  nodeHead: string;
  edge: string;
  edgeActive: string;
  label: string;
  labelActive: string;
  /**
   * Fill for the label box Sigma draws behind the active node's own label.
   *
   * Sigma's built-in `drawDiscNodeHover` hardcodes `#FFF` here. On dark the
   * label ink is `--color-text-muted` (#c4c7d0), so the text landed on a white
   * box at 1.66:1 against a 4.5:1 text minimum — measured in the live app, with
   * Sigma's strongest available ink at no better than 1.16:1. Light mode
   * measured 17.2:1, which is exactly why this only ever showed up on dark.
   */
  labelBox: string;
}

export function readTheme(): ThemeColors {
  return {
    node: getCssVar('--graph-node', '#8b8e99'),
    nodeHead: getCssVar('--graph-node-head', '#4a4d57'),
    edge: getCssVar('--graph-edge', '#8b8e99'),
    edgeActive: getCssVar('--graph-edge-active', '#2b2d33'),
    label: getCssVar('--color-text-muted', '#6b6e78'),
    labelActive: getCssVar('--color-text-main', '#2b2d33'),
    labelBox: getCssVar('--graph-label-box', '#ffffff'),
  };
}

/** Geometry shared with Sigma's own hover drawer, so only the fill changes. */
export interface HoverDrawSettings {
  labelSize: number;
  labelFont: string;
  labelWeight: string;
  /** Mirrors Sigma's own `labelColor` union, including the attribute form. */
  labelColor: { attribute: string; color?: string } | { color: string; attribute?: undefined };
}

/**
 * Sigma's `drawDiscNodeLabel`, with a side flip so text never runs off the canvas.
 *
 * The built-in drawer always puts the label to the RIGHT of the node
 * (`data.x + data.size + 3`). On a narrow stage the rightmost nodes therefore
 * push their text past the canvas edge, and Sigma simply cuts it off — this is
 * what produced truncated names like "pruder" and "Aristot", and it is what the
 * mobile framing spec measures as ink on the label canvas border.
 *
 * Reserving a gutter cannot solve it on a phone. A long concept name needs ~140px
 * of room (16 chars x 12px x 0.62), and a 369px stage can only give that by
 * shrinking the graph to ~55% of the width — trading a clipped word for a
 * needlessly small map. Flipping the label to the left of its node costs nothing
 * and is what a reader expects at the edge of a frame.
 *
 * `data.x` here is a viewport coordinate on the label canvas, so
 * `context.canvas.width` is the exact bound to test against. Colours and font
 * come from the same settings the built-in reads, so nothing else changes.
 */
export function drawFlipsAtEdgeNodeLabel(
  context: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label?: string | null },
  settings: HoverDrawSettings
): void {
  if (!data.label) return;
  const { labelSize, labelFont, labelWeight } = settings;
  const color = settings.labelColor.attribute
    ? (data as unknown as Record<string, unknown>)[settings.labelColor.attribute] ??
      settings.labelColor.color ??
      '#000'
    : settings.labelColor.color ?? '#000';

  context.font = `${labelWeight} ${labelSize}px ${labelFont}`;
  context.fillStyle = String(color);

  const textWidth = context.measureText(data.label).width;
  const overflowsRight = data.x + data.size + LABEL_OFFSET_PX + textWidth > context.canvas.width;
  // Only flip when the left side actually has room, so a very wide label on a
  // narrow stage degrades to the old behaviour rather than clipping the other way.
  const flips = overflowsRight && data.x - data.size - LABEL_OFFSET_PX - textWidth >= 0;

  if (flips) {
    context.textAlign = 'right';
    context.fillText(data.label, data.x - data.size - LABEL_OFFSET_PX, data.y + labelSize / 3);
    context.textAlign = 'left';
  } else {
    context.fillText(data.label, data.x + data.size + LABEL_OFFSET_PX, data.y + labelSize / 3);
  }
}

/**
 * Sigma's `drawDiscNodeHover`, with a theme-aware box fill and the same edge flip.
 *
 * The built-in version is `context.fillStyle = "#FFF"` unconditionally, which
 * is invisible-in-light but actively wrong on dark: it paints a white plate
 * under `--color-text-muted` ink. The geometry below is reproduced from
 * `sigma@3.0.3` (`drawDiscNodeHover`) and only `boxFill` is parameterised, so
 * light mode stays pixel-identical apart from the token (which is `#ffffff`
 * there) and dark mode stops drawing a white block.
 *
 * The flip matches `drawFlipsAtEdgeNodeLabel`: without it the plate and the text
 * would part company on a node near the right edge.
 *
 * If Sigma is upgraded, re-check this against the new implementation.
 */
export function drawThemeNodeHover(
  context: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label?: string | null },
  settings: HoverDrawSettings,
  boxFill: string
): void {
  const { labelSize, labelFont, labelWeight } = settings;
  context.font = `${labelWeight} ${labelSize}px ${labelFont}`;

  context.fillStyle = boxFill;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 8;
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';

  const PADDING = 2;
  if (typeof data.label === 'string') {
    const textWidth = context.measureText(data.label).width;
    const boxWidth = Math.round(textWidth + 5);
    const boxHeight = Math.round(labelSize + 2 * PADDING);
    const radius = Math.max(data.size, labelSize / 2) + PADDING;
    const angleRadian = Math.asin(boxHeight / 2 / radius);
    const xDeltaCoord = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2));

    const overflowsRight = data.x + radius + boxWidth > context.canvas.width;
    const flips = overflowsRight && data.x - radius - boxWidth >= 0;
    const direction = flips ? -1 : 1;

    context.beginPath();
    context.moveTo(data.x + direction * xDeltaCoord, data.y + boxHeight / 2);
    context.lineTo(data.x + direction * (radius + boxWidth), data.y + boxHeight / 2);
    context.lineTo(data.x + direction * (radius + boxWidth), data.y - boxHeight / 2);
    context.lineTo(data.x + direction * xDeltaCoord, data.y - boxHeight / 2);
    if (flips) {
      context.arc(data.x, data.y, radius, Math.PI - angleRadian, Math.PI + angleRadian);
    } else {
      context.arc(data.x, data.y, radius, angleRadian, -angleRadian);
    }
    context.closePath();
    context.fill();
  } else {
    context.beginPath();
    context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2);
    context.closePath();
    context.fill();
  }

  context.shadowBlur = 0;
  context.shadowColor = 'transparent';

  // The label itself, in the same colour Sigma would have used. Sigma's own
  // fallback order is `data[attribute] || labelColor.color || '#000'`.
  const perNode = 'attribute' in settings.labelColor && settings.labelColor.attribute
    ? (data as unknown as Record<string, unknown>)[settings.labelColor.attribute]
    : undefined;
  context.fillStyle =
    (typeof perNode === 'string' && perNode) || settings.labelColor.color || '#000';
  if (typeof data.label === 'string') {
    const textWidth = context.measureText(data.label).width;
    const overflowsRight = data.x + data.size + LABEL_OFFSET_PX + textWidth > context.canvas.width;
    const flips = overflowsRight && data.x - data.size - LABEL_OFFSET_PX - textWidth >= 0;
    if (flips) {
      context.textAlign = 'right';
      context.fillText(data.label, data.x - data.size - LABEL_OFFSET_PX, data.y + labelSize / 3);
      context.textAlign = 'left';
    } else {
      context.fillText(data.label, data.x + data.size + LABEL_OFFSET_PX, data.y + labelSize / 3);
    }
  }
}

export function compareConcepts(a: ConceptDto, b: ConceptDto): number {
  return (
    b.usageCount - a.usageCount ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

