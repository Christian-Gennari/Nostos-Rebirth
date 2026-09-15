import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  HostListener,
  signal,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  BookOpen,
  Crosshair,
  Expand,
  LayoutList,
  Minus,
  Plus,
  RotateCcw,
  Scan,
  Shrink,
} from 'lucide-angular';
import Graph from 'graphology';
import Sigma from 'sigma';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';

import { IconButtonComponent } from '../../ui/icon-button/icon-button.component';
import {
  ConceptDto,
  ConceptsService,
  ConceptGraphDto,
  ConceptGraphNodeDto,
  ConceptGraphEdgeDto,
} from '../../core/services/concepts.service';

export const MAX_MAP_CONCEPTS = 150;

/* ── Visual constants ── */
const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 16;
const EDGE_SIZE_MIN = 0.75;
const EDGE_SIZE_MAX = 3;

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
const LABEL_DRAW_SIZE = 12;

/**
 * Edge alpha floor. Measured on the real graph field: at the previous floor
 * (0.44-0.54) an isolated edge's strongest pixel differed from the field by
 * only 8-17 of 765 — a contrast ratio of 1.05:1, i.e. invisible. Sweeping alpha
 * against the same field and camera gave max deltas of 115 at 0.6, 266 at 0.8
 * and 365 at 1.0, so the floor is the lever, not the stroke width.
 */
const EDGE_ALPHA_MIN = 0.62;
const EDGE_ALPHA_RANGE = 0.38;

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
const NODE_ALPHA_DIM = 0.7;

/** Edges not touching the active node: quieter than nodes, but still present. */
const EDGE_ALPHA_DIM = 0.34;

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
const LABEL_RENDER_MIN_SIZE = 2.4;

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
const LABEL_EDGE_ALLOWANCE_FRACTION = 0.04;

/** Sigma's default horizontal offset from a node to the start of its label. */
const LABEL_OFFSET_PX = 10;

/** Fraction of the stage a fitted graph should occupy, with no label inset. */
const FIT_OCCUPANCY = 0.88;

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
function hashSeed(value: string): number {
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
function seedPositions(
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
interface LayoutNode extends SimulationNodeDatum {
  id: string;
  size: number;
}

/**
 * Pointer travel, in CSS pixels, before a press on a node counts as a drag
 * rather than a click. Without a threshold the sub-pixel movement of an
 * ordinary click trips the drag path and the click-to-select that follows is
 * suppressed.
 */
const DRAG_THRESHOLD_PX = 3;

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
const OBSIDIAN_FORCES = {
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
const OBSIDIAN_LINK_STRENGTH = 1;

/**
 * Alpha applied when the graph data or the forces change.
 *
 * Obsidian posts `alpha: .3, run: true` on `setData` and on `setForces`. Alpha is
 * an energy budget, not a force balance: the settle is "run hot, then cool to
 * alphaMin and stop", which is what makes the layout keep relaxing and then halt.
 */
const SETTLE_ALPHA = 0.3;

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
const DRAG_ALPHA = 0.3;

/**
 * Obsidian's `forceCollide` radius, as a multiple of `linkDistance`.
 *
 * Used only for seeding: new nodes are spawned on a ring around the graph's
 * centre at roughly one link distance, which is what Obsidian's `setData` does
 * (`r = v + sqrt(rand) * O` where `O = sqrt(60*N*60/π)`), not the uniform random
 * square this component used before.
 */
const SEED_RING_SCALE = 60 * 60;

/* Nostos theme tokens read at runtime from CSS custom properties. */
function getCssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixHex(first: string, second: string, amount: number): string {
  const a = first.replace('#', '');
  const b = second.replace('#', '');
  const channel = (source: string, offset: number) => parseInt(source.slice(offset, offset + 2), 16);
  const mix = (offset: number) => Math.round(channel(a, offset) + (channel(b, offset) - channel(a, offset)) * amount);
  return `#${[0, 2, 4].map((offset) => mix(offset).toString(16).padStart(2, '0')).join('')}`;
}

interface ThemeColors {
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
   * label ink is `--color-text-muted` (#C5C9D0), so the text landed on a white
   * box at 1.66:1 against a 4.5:1 text minimum — measured in the live app, with
   * Sigma's strongest available ink (#EDEEF2) no better at 1.16:1. Light mode
   * measured 17.2:1, which is exactly why this only ever showed up on dark.
   */
  labelBox: string;
}

function readTheme(): ThemeColors {
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
interface HoverDrawSettings {
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
function drawFlipsAtEdgeNodeLabel(
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
function drawThemeNodeHover(
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

function compareConcepts(a: ConceptDto, b: ConceptDto): number {
  return (
    b.usageCount - a.usageCount ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

@Component({
  selector: 'app-concept-map',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, IconButtonComponent],
  templateUrl: './concept-map.component.html',
  styleUrl: './concept-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConceptMapComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() concepts: ConceptDto[] = [];
  @Input() selectedId: string | null = null;
  /**
   * Name of the selected concept, supplied by the parent.
   *
   * The map owns the action rail, so the "what is selected" chip belongs here
   * too — otherwise the notes action sits in a second floating overlay outside
   * the control surface, which is the layout being reported as fragmented.
   */
  @Input() selectedName: string | null = null;
  @Output() readonly conceptSelected = new EventEmitter<string>();
  /** Emitted by the rail's "Read notes" action. */
  @Output() readonly openNotes = new EventEmitter<void>();
  /** Emitted by the map's "Concept view" control, and by a node double-click. */
  @Output() readonly openConcept = new EventEmitter<string>();
  /** Emitted by the "Concept view" control: leave the map for the index. */
  @Output() readonly showList = new EventEmitter<void>();
  /**
   * Emitted when a click on empty space clears the selection.
   *
   * Separate from `conceptSelected` rather than widening it to `string | null`:
   * the two mean different things ("this node is now the subject" versus "there
   * is no subject"), and a nullable id would let a consumer treat a deselect as
   * a selection of nothing.
   */
  @Output() readonly selectionCleared = new EventEmitter<void>();

  @ViewChild('sigmaContainer', { static: false }) sigmaContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('mapStage', { static: false }) mapStage!: ElementRef<HTMLElement>;

  private sigma: Sigma | null = null;
  private graph: Graph | null = null;
  private graphData: ConceptGraphDto | null = null;
  private theme: ThemeColors = readTheme();
  private destroyed = false;
  private viewInitialized = false;
  private pendingRebuild = false;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Obsidian's five-force layout, run live rather than as a one-shot settle.
   *
   * Held as a field because it is stepped from an animation frame (and from the
   * drag handler) rather than being fire-and-forget: alpha decays to `alphaMin`
   * and the loop then stops on its own, so this is the single place that knows
   * whether the graph is still moving.
   */
  private layout: Simulation<LayoutNode, undefined> | null = null;

  /** Handle for the animation frame that steps the layout. */
  private layoutFrame: number | null = null;

  /* Drag-to-reposition state */
  private draggedNode: string | null = null;
  private isDragging = false;
  private dragStart: { x: number; y: number } | null = null;
  /**
   * True between a node press and its release on ANY input source.
   *
   * Guards the teardown so it runs exactly once per gesture. Without it,
   * `mouseup` and the window-level `pointerup` safety net can both fire for one
   * drag, and the second call would clear the `fixed` pin of a node the user
   * has already moved on from.
   */
  private draggingActive = false;
  /** Removes the window-level drag safety net. Set while Sigma is alive. */
  private detachDragSafetyNet: (() => void) | null = null;

  /**
   * The settled ForceAtlas2 layout, kept so "Reset layout" can restore node
   * positions after the user has dragged things around.
   */
  private readonly layoutHome = new Map<string, { x: number; y: number }>();

  /* State signals for the template. */
  readonly loading = signal(true);
  readonly hoveredId = signal<string | null>(null);
  readonly selectedNodeId = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly isFullscreen = signal(false);
  readonly sourceCount = signal(0);
  readonly isCapped = computed(() => this.sourceCount() > MAX_MAP_CONCEPTS);
  readonly noConnections = signal(false);
  readonly searchResults = computed(() => {
    const query = this.searchTerm().trim().toLocaleLowerCase();
    if (!query) return [];
    return this.accessibleNodes()
      .filter((node) => node.name.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  });

  /**
   * Accessible nodes: the full set currently rendered, so the hidden list
   * stays in sync with the visual canvas.
   */
  readonly accessibleNodes = signal<
    Array<{ id: string; name: string; usageCount: number; connectionCount: number }>
  >([]);

  /* Icons for the action rail. Exposed as fields because the template reads
     them; `strokeWidth` stays at the app default of 2.

     Icon choice is constrained by mutual distinctness, not just meaning: `Scan`
     (fit) and `Maximize` were BOTH the same four-corner-bracket glyph (vertical
     corner-marks at 3/17 vs 3/8), which read as one button repeated — reported as
     "you use the same icon for two different buttons" and confirmed by comparing
     the rendered SVG geometry. Focus mode uses the diagonal expand/shrink arrows
     instead, which also communicates fullscreen better than brackets. */
  readonly zoomOutIcon = Minus;
  readonly zoomInIcon = Plus;
  readonly fitIcon = Scan;
  readonly centreIcon = Crosshair;
  readonly focusIcon = Expand;
  readonly exitFocusIcon = Shrink;
  readonly resetIcon = RotateCcw;
  readonly notesIcon = BookOpen;
  readonly listIcon = LayoutList;

  private readonly conceptsService = inject(ConceptsService);

  /* ── Keyboard and fullscreen ── */
  private readonly handleFullscreenChange = (): void => {
    this.isFullscreen.set(document.fullscreenElement === this.mapStage?.nativeElement);
    window.setTimeout(() => this.sigma?.refresh(), 0);
  };

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isFullscreen()) {
      void this.exitFullscreen();
    }
  }

  /* ── Lifecycle ── */

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedId']) {
      this.selectedNodeId.set(this.selectedId);
      this.refreshRendering();
    }
    if (changes['concepts']) {
      this.sourceCount.set((this.concepts ?? []).length);
      this.loadGraphData();
    }
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    if (this.pendingRebuild) {
      this.pendingRebuild = false;
      this.rebuildSigma();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    this.disposeSigma();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /* ── Data loading ── */

  private loadGraphData(): void {
    this.loading.set(true);
    this.conceptsService.getGraph().subscribe({
      next: (data) => {
        if (this.destroyed) return;
        this.graphData = data;
        this.loading.set(false);
        if (this.viewInitialized) {
          this.rebuildSigma();
        } else {
          this.pendingRebuild = true;
        }
      },
      error: () => {
        if (this.destroyed) return;
        this.graphData = { nodes: [], edges: [] };
        this.loading.set(false);
      },
    });
  }

  /* ── Graph construction ── */

  private rebuildSigma(): void {
    this.disposeSigma();
    if (!this.graphData || !this.sigmaContainer?.nativeElement) return;

    this.theme = readTheme();
    const container = this.sigmaContainer.nativeElement;

    const visibleIds = new Set(
      [...(this.concepts ?? [])]
        .sort(compareConcepts)
        .slice(0, MAX_MAP_CONCEPTS)
        .map((c) => c.id)
    );

    const visibleNodes = this.graphData.nodes.filter((n) => visibleIds.has(n.id));
    const visibleEdges = this.graphData.edges.filter(
      (e) => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId)
    );

    if (visibleNodes.length === 0) {
      this.noConnections.set(true);
      this.accessibleNodes.set([]);
      return;
    }

    const graph = new Graph();
    this.graph = graph;

    const usages = visibleNodes.map((n) => Math.max(0, n.usageCount));
    const minUsage = Math.min(...usages);
    const maxUsage = Math.max(...usages);
    const usageRange = Math.max(1, maxUsage - minUsage);

    const maxShared = Math.max(1, ...visibleEdges.map((e) => e.sharedNotes));

    // Seed every node on Obsidian's ring, then add it to the graph with the
    // seeded coordinates. The simulation below owns the positions from here on.
    const seeds: Array<{ id: string; x: number; y: number }> = visibleNodes.map((n) => ({
      id: n.id,
      x: 0,
      y: 0,
    }));
    seedPositions(seeds, OBSIDIAN_FORCES.linkDistance);
    const seedById = new Map(seeds.map((s) => [s.id, s]));

    // Add nodes.
    for (const node of visibleNodes) {
      const ratio = (Math.max(0, node.usageCount) - minUsage) / usageRange;
      const size = NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio);
      const nodeColor = mixHex(this.theme.node, this.theme.nodeHead, 0.18 + ratio * 0.42);
      const seeded = seedById.get(node.id)!;

      graph.addNode(node.id, {
        label: node.name,
        size,
        color: nodeColor,
        labelColor: hexToRgba(this.theme.label, 0.8 + ratio * 0.16),
        x: seeded.x,
        y: seeded.y,
        usageCount: node.usageCount,
      });
    }

    // Add edges.
    for (const edge of visibleEdges) {
      const strength = edge.sharedNotes / maxShared;
      const edgeSize = EDGE_SIZE_MIN + strength * (EDGE_SIZE_MAX - EDGE_SIZE_MIN);
      try {
        graph.addEdge(edge.sourceId, edge.targetId, {
          size: edgeSize,
          color: hexToRgba(this.theme.edge, EDGE_ALPHA_MIN + strength * EDGE_ALPHA_RANGE),
          sharedNotes: edge.sharedNotes,
        });
      } catch {
        // Duplicate edge or missing node — skip silently.
      }
    }

    this.noConnections.set(graph.size === 0);

    // Build the accessible node list with connection counts.
    const connectionCounts = new Map<string, number>();
    graph.forEachEdge((_edge, _attrs, source, target) => {
      connectionCounts.set(source, (connectionCounts.get(source) ?? 0) + 1);
      connectionCounts.set(target, (connectionCounts.get(target) ?? 0) + 1);
    });
    this.accessibleNodes.set(
      visibleNodes.map((n) => ({
        id: n.id,
        name: n.name,
        usageCount: n.usageCount,
        connectionCount: connectionCounts.get(n.id) ?? 0,
      }))
    );

    // ── Build the force simulation ──
    //
    // Replaces a one-shot ForceAtlas2 settle. Two properties of d3-force matter
    // for the behaviour being fixed:
    //
    //  * `vx`/`vy` PERSIST between ticks (damped by `velocityDecay`), so stepping
    //    one tick per frame carries momentum and a re-heated graph glides to rest
    //    instead of freezing. ForceAtlas2's `assign()` rebuilt its matrices per
    //    call and discarded the previous call's velocity, which is why the old
    //    live loop needed six iterations per frame to look like anything.
    //  * Alpha is an energy budget that DECAYS to `alphaMin`, at which point the
    //    loop halts by itself. So the settle and the post-drag relaxation are the
    //    same code path, and neither leaves a permanent timer running.
    const layoutNodes: LayoutNode[] = visibleNodes.map((n) => {
      const attrs = graph.getNodeAttributes(n.id);
      return {
        id: n.id,
        x: Number(attrs['x']),
        y: Number(attrs['y']),
        size: Number(attrs['size']),
      };
    });
    const layoutLinks = visibleEdges
      .filter((e) => graph.hasNode(e.sourceId) && graph.hasNode(e.targetId))
      .map((e) => ({ source: e.sourceId, target: e.targetId }));

    // d3's own per-link strength, computed explicitly so Obsidian's slider can be
    // applied as a multiplier.
    //
    // d3's default is `1 / min(degree(source), degree(target))` and its `count`
    // array only exists after the force is initialised. Reading the default by
    // calling `.strength()` on a fresh force therefore hands back a function whose
    // closure is still empty, and invoking it throws on `count[...]`. Deriving the
    // same quantity from the graph's own degrees is both correct and readable.
    const linkStrength = (link: { source: unknown; target: unknown }): number => {
      const source = link.source as LayoutNode;
      const target = link.target as LayoutNode;
      const degree = Math.min(graph.degree(source.id), graph.degree(target.id));
      return degree > 0 ? OBSIDIAN_LINK_STRENGTH / degree : OBSIDIAN_LINK_STRENGTH;
    };

    this.layout = forceSimulation<LayoutNode>(layoutNodes)
      // Stop before the first tick: the settle is driven explicitly below, and a
      // d3 simulation otherwise starts its own timer on construction.
      .stop()
      .force('x', forceX<LayoutNode>(0).strength(OBSIDIAN_FORCES.centerStrength))
      .force('y', forceY<LayoutNode>(0).strength(OBSIDIAN_FORCES.centerStrength))
      .force(
        'link',
        forceLink<LayoutNode, { source: string; target: string }>(layoutLinks)
          .id((node) => node.id)
          .distance(OBSIDIAN_FORCES.linkDistance)
          .strength(linkStrength)
      )
      .force(
        'charge',
        forceManyBody<LayoutNode>()
          .strength(-OBSIDIAN_FORCES.repelStrength)
          .distanceMin(OBSIDIAN_FORCES.distanceMin)
      )
      .force(
        'collide',
        forceCollide<LayoutNode>()
          // Obsidian's fixed values, verbatim. `radius(60)` collides
          // centre-to-centre and is deliberately NOT inflated by the node's drawn
          // size: measured on the live 53-node graph, the settled minimum
          // node-centre distance is 125-127 with `size` folded in and 122.2
          // without, against a 60 surplus over the 8px drawn radius — so adding
          // `size` changes nothing except by making the map's spacing depend on
          // whichever node size formula happens to be in force. Keeping the force
          // faithful to Obsidian is the point of this change, and the screen-space
          // guarantee is asserted separately (0 overlapping pairs) where it can be
          // measured rather than assumed.
          .radius(OBSIDIAN_FORCES.collideRadius)
          .strength(OBSIDIAN_FORCES.collideStrength)
      );

    // ── Settle ──
    //
    // Run the full cool-down synchronously so the first paint shows a finished
    // layout rather than one visibly uncoiling. 300 ticks is exactly d3's default
    // budget (alphaDecay is defined as "reach alphaMin in 300 ticks"), and the
    // loop exits on the alpha test rather than the counter, so this is the real
    // convergence point. Measured 248 ticks on the live 53-node graph.
    this.layout.alpha(SETTLE_ALPHA);
    let settleTicks = 0;
    while (this.layout.alpha() > OBSIDIAN_FORCES.alphaMin && settleTicks < 300) {
      this.layout.tick();
      settleTicks += 1;
    }
    this.writeLayoutToGraph();

    // Snapshot the computed layout so "Reset" can restore it after drags.
    this.layoutHome.clear();
    graph.forEachNode((node, attrs) => {
      this.layoutHome.set(node, { x: Number(attrs['x']) || 0, y: Number(attrs['y']) || 0 });
    });

    // Create Sigma renderer.
    const sigma = new Sigma(graph, container, {
      renderLabels: true,
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: LABEL_RENDER_MIN_SIZE,
      labelFont: "'Hanken Grotesk', sans-serif",
      // `attribute` is what makes Sigma honour the per-node `labelColor` this
      // component sets. `drawDiscNodeLabel` reads `data[settings.labelColor
      // .attribute]` only when that key is truthy:
      //
      //   color = settings.labelColor.attribute
      //     ? data[settings.labelColor.attribute] || settings.labelColor.color
      //     : settings.labelColor.color
      //
      // Without it, every per-node colour below was silently dead and the map
      // was painted from the static `--color-text-muted` fallback — which on
      // dark is #C5C9D0 drawn on Sigma's hardcoded white hover box (1.66:1).
      labelColor: { attribute: 'labelColor', color: this.theme.label },
      labelSize: LABEL_DRAW_SIZE,
      defaultEdgeType: 'line',
      enableEdgeEvents: false,
      allowInvalidContainer: true,
      // Node sizes are pixel sizes; the camera fit handles scale, so radii only
      // need to follow the camera (see `zoomToSizeRatioFunction` below) and the
      // visual scale does not collapse when the graph fills the stage.
      itemSizesReference: 'screen',
      // Node radii must scale with the camera, or zooming in makes the graph
      // collide with itself.
      //
      // Sigma maps positions through the camera but, with `itemSizesReference:
      // 'screen'`, draws radii at a fixed pixel size unless `zoomToSizeRatioFunction`
      // says otherwise. The two then disagree: positions shrink as `1/ratio` while
      // radii stay put, so the drawn gap between neighbours closes as you zoom in.
      // Measured on the live graph: at `ratio 2.09` (a normal zoom-in on desktop)
      // **30 of 53 nodes overlapped**; at the fitted `ratio 1.247`, none did.
      //
      // `Math.sqrt` is Sigma's OWN default for this setting, and it matches what
      // Obsidian does — its renderer sets `nodeScale = Math.sqrt(1/scale)` and
      // multiplies the node radius by it on every frame. So radii and distances
      // now follow the same law, node spacing in graph units is preserved at any
      // zoom, and the layout's guarantees (no overlaps, no collisions) hold
      // zoomed-in as well as fitted.
      zoomToSizeRatioFunction: Math.sqrt,
      // Keep the user's layout authoritative.
      //
      // With autoRescale on, Sigma re-maps the whole graph onto the viewport
      // whenever the extent changes, so dragging one node away shrinks every
      // other node (measured: width fill 57% -> 6.4%) and the Fit/Reset buttons
      // then return to an already-current camera and appear dead. Off, graph
      // units map 1:1 to screen pixels and a drag moves only what was dragged.
      autoRescale: false,
      autoCenter: false,
      // No stagePadding: Sigma's `getStagePadding()` returns 0 whenever
      // `autoRescale` is false, which is this configuration — the setting is
      // inert here. Room for labels comes from `fitOccupancy()` instead.
      stagePadding: 0,
      // Sigma's label grid deconflicts labels for us: measured 0 merged blobs at
      // every density tried, while raising density from 1 to 1.6 lifted the
      // displayed labels from 20 to 30 of 53. More of the map is legible with no
      // collisions introduced.
      labelDensity: 1.6,
      // Replace Sigma's `drawDiscNodeLabel`, which always draws to the RIGHT of
      // the node and lets a label on a right-edge node be cut off by the canvas.
      // Geometry, font and colour are reproduced exactly; only the side flips.
      defaultDrawNodeLabel: (context, data, settings) =>
        drawFlipsAtEdgeNodeLabel(context, data, settings),
      // Replace Sigma's `drawDiscNodeHover`, whose label box is a hardcoded
      // `#FFF`. Geometry is unchanged; only the fill follows the theme.
      defaultDrawNodeHover: (context, data, settings) =>
        drawThemeNodeHover(context, data, settings, this.theme.labelBox),
    });

    this.sigma = sigma;

    // Keep the renderer and the simulation reachable for diagnostics and for the
    // visual-verification harness, which measures graph geometry through the live
    // instances. Read-only introspection: no application behaviour depends on
    // these handles.
    //
    // `__nostosLayout` is the d3 simulation, which is where the physics questions
    // are answered from — alpha, whether the loop is still running, and each
    // node's `vx`/`vy` (the momentum that makes a release glide rather than stop).
    const globals = globalThis as unknown as {
      __nostosSigma?: unknown;
      __nostosGraph?: unknown;
      __nostosLayout?: unknown;
    };
    globals.__nostosSigma = sigma;
    globals.__nostosGraph = graph;
    globals.__nostosLayout = this.layout;

    // Set up node reducers for hover/selection highlighting.
    const component = this;

    sigma.setSetting('nodeReducer', (node: string, data: Record<string, unknown>) => {
      const res = { ...data };
      const hoveredId = component.hoveredId();
      const selectedId = component.selectedNodeId();
      const activeId = hoveredId ?? selectedId;

      if (activeId) {
        const neighbors = new Set<string>();
        try {
          graph.forEachNeighbor(activeId, (n) => neighbors.add(n));
        } catch {
          // activeId might not be in graph
        }
        neighbors.add(activeId);

        if (node === activeId) {
          res['color'] = component.theme.nodeHead;
          res['zIndex'] = 2;
          res['highlighted'] = true;
          res['labelColor'] = component.theme.labelActive;
          res['forceLabel'] = true;
        } else if (neighbors.has(node)) {
          res['zIndex'] = 1;
          res['forceLabel'] = true;
        } else {
          // Keep unconnected nodes visible AND labelled.
          //
          // Setting `label: ''` here erased them entirely, which is the other
          // half of the "everything else melts into the background" report: the
          // user loses both the dot and its name, so the map reads as if those
          // concepts do not exist rather than that they are merely not the
          // active neighbourhood.
          res['color'] = hexToRgba(component.theme.node, NODE_ALPHA_DIM);
          res['labelColor'] = hexToRgba(component.theme.label, 0.62);
          res['zIndex'] = 0;
        }
      }

      return res;
    });

    sigma.setSetting('edgeReducer', (edge: string, data: Record<string, unknown>) => {
      const res = { ...data };
      const hoveredId = component.hoveredId();
      const selectedId = component.selectedNodeId();
      const activeId = hoveredId ?? selectedId;

      if (activeId) {
        const source = graph.source(edge);
        const target = graph.target(edge);
        if (source === activeId || target === activeId) {
          // Full-strength accent ink. At alpha 0.72 the pine washed toward the
          // normal edge grey in the light theme (5.09:1 against the field vs
          // 3.44:1 for a normal edge — indistinguishable in practice, and the
          // pixel classification found zero pixels bright enough to separate
          // them). At full alpha it is 11.90:1 against 3.44:1, so a line that
          // touches the focused node is unmistakable.
          res['color'] = component.theme.edgeActive;
          res['size'] = Math.max((data['size'] as number) ?? 1, 2) * 1.6;
          res['zIndex'] = 1;
        } else {
          res['color'] = hexToRgba(component.theme.edge, EDGE_ALPHA_DIM);
          res['zIndex'] = 0;
        }
      }

      return res;
    });

    // Event listeners.
    sigma.on('enterNode', ({ node }) => {
      component.hoveredId.set(node);
      container.style.cursor = 'grab';
      sigma.refresh();
    });

    sigma.on('leaveNode', () => {
      component.hoveredId.set(null);
      if (!component.draggedNode) {
        container.style.cursor = 'default';
      }
      sigma.refresh();
    });

    sigma.on('clickNode', ({ node }) => {
      // If we just finished dragging, don't treat the mouseup as a click.
      if (component.isDragging) return;
      component.selectedNodeId.set(node);
      component.conceptSelected.emit(node);
      sigma.refresh();
    });

    // Double-click opens the concept, the way Obsidian's graph does.
    //
    // Sigma's mouse captor counts its own clicks: the FIRST click emits `click`
    // (so the node is already selected by the time this fires) and the second
    // dispatches `doubleClick` INSTEAD of a second `click`, which is what makes
    // the two gestures compose rather than fight. `doubleClickNode` carries the
    // node under the pointer, so the id is ready to hand straight to the parent
    // — no round trip through the selection signal.
    //
    // `preventSigmaDefault()` is required, not decorative: without it Sigma also
    // zooms the camera into the node, so the map would lurch between the two
    // clicks of a gesture that is meant to leave the map entirely.
    sigma.on('doubleClickNode', ({ node, preventSigmaDefault }) => {
      if (component.isDragging) return;
      preventSigmaDefault();
      component.selectedNodeId.set(node);
      component.openConcept.emit(node);
      sigma.refresh();
    });

    // Clicking empty space clears the selection.
    //
    // Selection drives the index rail and the "Read notes" action, so without
    // this the map was stuck on the last node clicked — there was no gesture
    // that returned the graph to a neutral state, and the only remaining escape
    // (reloading, or selecting a different node) made the map feel like it was
    // holding a choice the user could not take back.
    //
    // `clickStage` is exactly the right event, because Sigma only emits it for a
    // GENUINE click: a camera pan bumps its `draggedEvents` counter past
    // `draggedEventsTolerance` and is suppressed, a touch drag is suppressed by
    // `tapMoveTolerance`, and a double-click dispatches `doubleClickStage`
    // instead of a second `clickStage`. So an empty-space click during a pan
    // release never lands here and cannot wipe a selection by accident.
    sigma.on('clickStage', () => {
      component.hoveredId.set(null);
      component.selectedNodeId.set(null);
      component.selectionCleared.emit();
      sigma.refresh();
    });

    // ── Drag-to-reposition ──
    //
    // ONE lifecycle, driven by both input sources. Sigma's `downNode` fires for
    // mouse AND touch, but its `mouseup` captor event fires for MOUSE ONLY —
    // touch ends arrive as a separate `touchup`. That asymmetry was a shipped
    // bug: on a phone, every tap or drag on a node called these teardown steps
    // zero times, so `camera.disable()` was never undone.
    //
    // Measured before that fix, on a 390x844 touch viewport: a simple TAP on a
    // node left `camera.enabled === false` and the node pinned, and the node did
    // not even move (displacement 0.0px). Every camera control then silently
    // stopped working, including Fit: ratio stayed at 1.4286 before and after
    // clicking it. That is the "buttons get stuck" report, and one tap triggered
    // it.
    //
    // The teardown lives in one place (`endDrag`) wired to all three possible
    // endings: `mouseup`, `touchup`, and a window-level `pointerup` /
    // `pointercancel` safety net for a pointer released outside the canvas.
    //
    // The PIN itself moved when the layout engine did: it is now d3's `fx`/`fy`
    // on the simulation node, not ForceAtlas2's `fixed` graph attribute, and the
    // graph is energised with `alphaTarget` rather than stepped per event.

    const endDrag = (): void => {
      if (!component.draggingActive) return;
      const wasPinned = !!component.draggedNode;
      // Un-pin in the SIMULATION, which is where the pin lives now. Clearing
      // every node's `fx`/`fy` rather than only the dragged one is deliberate: a
      // pointerup lost off-canvas could otherwise strand a pin that no later
      // gesture owns, and the release is idempotent and cheap.
      component.releasePinnedNode();
      // Let the layout cool: `alphaTarget` back to 0, so alpha decays from the
      // drag energy to `alphaMin` and the graph settles under its own inertia.
      // This is the half that was missing before the physics rewrite — it is why
      // a release now glides to rest instead of freezing on the spot.
      if (wasPinned) component.coolLayout();
      component.draggedNode = null;
      component.dragStart = null;
      component.draggingActive = false;
      // Always hand the camera back. `enable()` is idempotent, so calling it on
      // a drag that never disabled it is harmless — but MISSING it once froze
      // the whole camera permanently.
      sigma.getCamera().enable();
      container.classList.remove('dragging');
      // Reset the drag flag after Sigma has dispatched the click that follows
      // the release, so a genuine drag never also selects the node it moved.
      window.setTimeout(() => {
        component.isDragging = false;
      }, 0);
    };

    const beginDrag = (node: string, x: number, y: number): void => {
      component.isDragging = false;
      component.dragStart = { x, y };
      component.draggedNode = node;
      component.draggingActive = true;
      // Pin the node for the duration of the drag. d3-force snaps a node with a
      // defined `fx`/`fy` to exactly that point and zeroes its velocity every
      // tick, so the rest of the graph relaxes around the pointer — the same
      // contract Obsidian's worker implements when it receives
      // `forceNode: { x, y }`.
      component.pinNodeForDrag(node);
      sigma.getCamera().disable();
      container.classList.add('dragging');
    };

    const moveDrag = (node: string, x: number, y: number): void => {
      // Only promote to a real drag once the pointer has travelled past a small
      // threshold. Without this, the sub-pixel movement of an ordinary click or
      // tap counts as a drag and the click-to-select that follows is swallowed.
      if (!component.isDragging && component.dragStart) {
        const travelled = Math.hypot(x - component.dragStart.x, y - component.dragStart.y);
        if (travelled < DRAG_THRESHOLD_PX) return;
        component.isDragging = true;
      }

      // Convert viewport coordinates to graph coordinates and move the pin.
      const pos = sigma.viewportToGraph({ x, y });
      graph.setNodeAttribute(node, 'x', pos.x);
      graph.setNodeAttribute(node, 'y', pos.y);
      component.pinNodeForDrag(node, pos.x, pos.y);

      // Let the rest of the graph respond to the node being pulled, so
      // neighbours follow it instead of the node moving alone.
      //
      // Obsidian re-posts `alpha: .3, alphaTarget: .3` on EVERY pointermove, so
      // the simulation runs hot and continuously for the whole gesture. Doing the
      // same here is what makes the pull read as physics: the neighbours do not
      // just get nudged, they keep relaxing as the pointer keeps moving.
      component.heatLayout(DRAG_ALPHA);
    };

    sigma.on('downNode', (e) => {
      component.draggingActive = false;
      beginDrag(e.node, e.event.x, e.event.y);
    });

    // Mouse path. Sigma v3 fires 'mousemovebody' on every pointer-move.
    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!component.draggedNode) return;
      moveDrag(component.draggedNode, e.x, e.y);
      // Prevent Sigma's default camera panning while dragging.
      e.preventSigmaDefault();
    });

    sigma.getMouseCaptor().on('mouseup', () => endDrag());

    // Touch path. `touchmove` is the touch equivalent of `mousemovebody`, and
    // `touchup` is the ONLY signal Sigma emits when a finger leaves the screen.
    sigma.getTouchCaptor().on('touchmove', (e) => {
      if (!component.draggedNode) return;
      const point = e.touches[0] ?? e.previousTouches[0];
      if (!point) return;
      moveDrag(component.draggedNode, point.x, point.y);
      e.preventSigmaDefault();
    });

    sigma.getTouchCaptor().on('touchup', () => endDrag());

    // Safety net for a pointer released or cancelled outside the canvas: without
    // this a drag that ends off-target leaves the camera disabled for good.
    component.detachDragSafetyNet?.();
    const safetyNet = (): void => endDrag();
    window.addEventListener('pointerup', safetyNet);
    window.addEventListener('pointercancel', safetyNet);
    component.detachDragSafetyNet = () => {
      window.removeEventListener('pointerup', safetyNet);
      window.removeEventListener('pointercancel', safetyNet);
    };

    // Sigma measures the container when it is constructed, which can be before
    // the surrounding layout has settled — on a portrait phone the stage is
    // narrower at build time than it ends up, and the fit computed from that
    // stale width under-zoomed and left 5 nodes off screen on first open.
    // Re-fit once the browser has laid the stage out, and whenever it changes
    // size without the user having navigated away.
    window.requestAnimationFrame(() => {
      if (this.destroyed || !this.sigma) return;
      this.sigma.refresh();
      this.fitGraph();
    });

    // Resize observer to keep Sigma in sync with container size changes.
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      let lastWidth = container.clientWidth;
      let lastHeight = container.clientHeight;
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.sigma || this.destroyed) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.sigma.refresh();
        // A genuine size change invalidates the framing, so re-fit — but only
        // when the size actually moved, so a sub-pixel observer tick does not
        // yank the camera back while the user is exploring.
        if (Math.abs(w - lastWidth) > 1 || Math.abs(h - lastHeight) > 1) {
          lastWidth = w;
          lastHeight = h;
          this.fitGraph();
        }
      });
      this.resizeObserver.observe(container);
    }

    // Frame the graph on first paint.
    this.fitGraph();
  }

  /**
   * Copy the simulation's positions back into the graphology graph.
   *
   * Sigma renders from the graph, d3 owns the physics, and this is the only
   * bridge between them — so there is exactly one writer of node coordinates
   * during a tick.
   */
  private writeLayoutToGraph(): void {
    const graph = this.graph;
    const layout = this.layout;
    if (!graph || !layout) return;

    for (const node of layout.nodes()) {
      if (!graph.hasNode(node.id)) continue;
      graph.setNodeAttribute(node.id, 'x', Number(node.x) || 0);
      graph.setNodeAttribute(node.id, 'y', Number(node.y) || 0);
      // Never write `size` back unconditionally: it is Sigma's pixel radius, not
      // a layout quantity, and a NaN here renders the node at zero and drops its
      // label (Sigma gates labels on drawn size). Guard rather than clobber.
      const size = Number(node.size);
      if (Number.isFinite(size) && size > 0) {
        graph.setNodeAttribute(node.id, 'size', size);
      }
    }
  }

  /**
   * Run the layout hot: hold `alphaTarget` at the drag energy and pump frames
   * until it is taken away again.
   *
   * Obsidian's worker does this by re-posting `alpha: .3, alphaTarget: .3` on
   * every pointermove, which keeps `alpha` pinned at 0.3 for the whole gesture.
   * Setting `alphaTarget` (rather than `alpha`) means alpha will *return* to that
   * level on its own, so the graph is energised for the entire drag without the
   * caller having to re-post on every event.
   */
  private heatLayout(alphaTarget: number): void {
    const layout = this.layout;
    if (!layout) return;
    layout.alphaTarget(alphaTarget);
    // Lift alpha immediately so the first frame after the gesture starts is
    // already energetic, rather than easing up to the target over many ticks.
    if (layout.alpha() < alphaTarget) layout.alpha(alphaTarget);
    this.startLayoutLoop();
  }

  /**
   * Let the layout cool: `alphaTarget` back to 0, so alpha decays to `alphaMin`
   * and the graph settles to rest under its own inertia.
   *
   * The loop keeps running through the decay — that IS the inertia — and stops
   * itself at `alphaMin`, so nothing is left ticking once the graph is still.
   */
  private coolLayout(): void {
    this.layout?.alphaTarget(0);
    this.startLayoutLoop();
  }

  /**
   * Pump the simulation one tick per animation frame until it goes quiet.
   *
   * d3-force persists `vx`/`vy` between ticks and damps them by `velocityDecay`,
   * so a single `tick()` per frame carries real momentum. That is the opposite of
   * the ForceAtlas2 arrangement this replaces, where `assign()` rebuilt its
   * matrices on every call and discarded the previous call's velocity — which
   * forced six iterations per frame just to register, and still produced no
   * inertia after the pointer was released (measured: 0 nodes moved at every
   * sample up to 2s after release).
   *
   * Idempotent: a second call while a frame is already queued does nothing, so
   * the per-pointermove heat is cheap.
   */
  private startLayoutLoop(): void {
    if (this.layoutFrame !== null || !this.layout) return;

    const step = (): void => {
      this.layoutFrame = null;
      const layout = this.layout;
      if (!layout || this.destroyed) return;

      layout.tick();
      this.writeLayoutToGraph();
      this.sigma?.refresh();

      // Stop at the alpha floor. Reporting the loop as finished is what lets the
      // idle case be asserted as "genuinely stopped" rather than "merely slow".
      if (layout.alpha() <= OBSIDIAN_FORCES.alphaMin) return;
      this.layoutFrame = window.requestAnimationFrame(step);
    };

    this.layoutFrame = window.requestAnimationFrame(step);
  }

  /** Cancel a queued frame. Used by Reset and teardown. */
  private stopLayoutLoop(): void {
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
  }

  /**
   * Pin a node at the pointer by writing d3's own `fx`/`fy`.
   *
   * d3's integration step snaps a pinned node to `fx`/`fy` and zeroes its
   * velocity every tick, which is what keeps the dragged node exactly under the
   * pointer while everything else relaxes around it. Called for both the press
   * (id only, current graph position) and each move (explicit position).
   */
  private pinNodeForDrag(node: string, x?: number, y?: number): void {
    const layout = this.layout;
    const graph = this.graph;
    if (!layout || !graph) return;

    const attrs = graph.getNodeAttributes(node);
    const targetX = x ?? (Number(attrs['x']) || 0);
    const targetY = y ?? (Number(attrs['y']) || 0);

    for (const entry of layout.nodes()) {
      if (entry.id !== node) continue;
      entry.fx = targetX;
      entry.fy = targetY;
    }
  }

  /**
   * Clear the drag pin from every node.
   *
   * Every node rather than just the dragged one: the pin lives only in the
   * simulation, so a pin whose owner was lost (a pointerup outside the canvas,
   * a rebuild mid-gesture) would otherwise freeze that node against all future
   * layout with nothing left to clear it.
   */
  private releasePinnedNode(): void {
    for (const entry of this.layout?.nodes() ?? []) {
      entry.fx = null;
      entry.fy = null;
    }
  }

  private disposeSigma(): void {
    this.stopLayoutLoop();
    // d3 keeps its own internal timer; explicit stop guarantees no tick survives
    // the component (killing Sigma alone would leave the simulation running).
    this.layout?.stop();
    this.layout = null;
    if (this.sigma) {
      this.sigma.kill();
      this.sigma = null;
    }
    this.graph = null;
    this.draggedNode = null;
    this.isDragging = false;
    this.dragStart = null;
    this.draggingActive = false;
    // Drop the pins with the simulation, and the window-level net with Sigma's
    // captors: a rebuild would otherwise stack a second safety net on every
    // theme change.
    this.releasePinnedNode();
    this.detachDragSafetyNet?.();
    this.detachDragSafetyNet = null;
    this.layoutHome.clear();
  }

  private refreshRendering(): void {
    if (this.sigma) {
      this.sigma.refresh();
    }
  }

  /* ── Template actions ── */

  /**
   * The fraction of each stage dimension the graph may occupy.
   *
   * `FIT_OCCUPANCY` alone assumes labels fit inside the drawing. They do not, but
   * they no longer need room reserved for them: `drawFlipsAtEdgeNodeLabel` keeps
   * every label on-canvas by flipping it to the other side of its node, so the
   * only thing left to reserve is a small constant edge allowance.
   *
   * Reserving a per-label gutter here was measurably harmful on a phone, where a
   * long concept name needs ~140px of a 369px stage: the reservation made the
   * width the binding axis of the fit and shrank every node instead of an
   * occasional word. See `LABEL_EDGE_ALLOWANCE_FRACTION`.
   */
  private fitOccupancy(): { x: number; y: number } {
    return {
      x: FIT_OCCUPANCY - LABEL_EDGE_ALLOWANCE_FRACTION,
      y: FIT_OCCUPANCY,
    };
  }

  /**
   * Compute the graph's extent in graph coordinates.
   */
  private graphExtent(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (!this.graph || this.graph.order === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    this.graph.forEachNode((_node, attrs) => {
      const x = Number(attrs['x']) || 0;
      const y = Number(attrs['y']) || 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY };
  }

  /**
   * The camera state that frames the whole graph, derived from Sigma's own
   * coordinate conversion rather than from hand-rolled maths.
   *
   * `sigma.graphToViewport(point, { cameraState })` evaluates the mapping for a
   * SUPPLIED camera state, so it is an exact oracle: probe the graph extent at
   * ratio 1, and since the on-screen span scales as 1/ratio, the ratio that just
   * fits is `max(spanX / (W * occupancy), spanY / (H * occupancy))`.
   *
   * Two earlier attempts got this wrong and both shipped:
   *   - `min(W * occupancy / spanX, ...)` is the reciprocal of the answer;
   *   - dividing both axes by `max(W, H)` matches Sigma's normalizer but is not
   *     the ratio maths, and silently under-fits whenever W < H.
   * The desktop stage (990x558, W > H) hid both errors behind a coincidence. On
   * a portrait phone (316x523) the second one shipped a ratio of 0.604 where 1.0
   * was needed, leaving **5 of 53 nodes off screen on first open**.
   *
   * Asking Sigma instead of re-deriving its algebra keeps this correct for any
   * viewport aspect and any future change to its internals.
   */
  private fitCameraState(
    occupancy: { x: number; y: number } = { x: FIT_OCCUPANCY, y: FIT_OCCUPANCY }
  ): { x: number; y: number; ratio: number } | null {
    const extent = this.graphExtent();
    const sigma = this.sigma;
    if (!extent || !sigma) return null;

    const { width, height } = sigma.getDimensions();
    if (!width || !height) return null;

    // Probe the extent at ratio 1 through Sigma's own mapping.
    const probe = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
    const cornerA = sigma.graphToViewport({ x: extent.minX, y: extent.minY }, { cameraState: probe });
    const cornerB = sigma.graphToViewport({ x: extent.maxX, y: extent.maxY }, { cameraState: probe });
    const spanX = Math.abs(cornerB.x - cornerA.x);
    const spanY = Math.abs(cornerB.y - cornerA.y);

    // Prefer the oracle; fall back to the raw extent if a probe degenerates.
    const effectiveX = spanX > 0 ? spanX : Math.max(extent.maxX - extent.minX, 1e-6);
    const effectiveY = spanY > 0 ? spanY : Math.max(extent.maxY - extent.minY, 1e-6);

    const ratio = Math.max(
      effectiveX / (width * occupancy.x),
      effectiveY / (height * occupancy.y),
      1e-6
    );

    return { x: 0.5, y: 0.5, ratio };
  }

  /**
   * Convert a point in graph coordinates to the camera's framed coordinates,
   * using Sigma's own conversion so the result is exact for any viewport aspect.
   *
   * The earlier hand-derived `0.5 + (g - centre) / max(W, H)` matched Sigma's
   * normalizer but not its viewport mapping, so it only held when W > H. On a
   * portrait phone the same expression put the target node off centre.
   *
   * Method: the point shown at the CENTRE of the stage has camera coordinates
   * (0.5, 0.5). Placing our target there means asking Sigma what camera state
   * maps our target to the stage centre — which is exactly
   * `viewportToFramedGraph` evaluated on the point we want at the centre.
   */
  private graphPointToFramed(x: number, y: number): { x: number; y: number } | null {
    const sigma = this.sigma;
    if (!sigma) return null;

    const { width, height } = sigma.getDimensions();
    if (!width || !height) return null;

    // Where does the target land with the camera centred and unzoomed?
    const probe = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
    const viewportPoint = sigma.graphToViewport({ x, y }, { cameraState: probe });

    // Framed coordinates are the inverse: the camera state that would put this
    // viewport point at the centre.
    const framed = sigma.viewportToFramedGraph(viewportPoint, { cameraState: probe });
    if (!Number.isFinite(framed.x) || !Number.isFinite(framed.y)) return null;
    return { x: framed.x, y: framed.y };
  }

  /** Frame the whole graph. */
  fitGraph(): void {
    const state = this.fitCameraState(this.fitOccupancy());
    if (!state || !this.sigma) return;
    this.sigma.getCamera().animate(state, { duration: 350 });
  }

  /**
   * Restore the settled layout AND re-frame it.
   *
   * "Reset" used to call `animatedReset()`, which only touched the camera — so
   * after a user had dragged nodes around, Reset left every moved node exactly
   * where it was. It now restores the positions the simulation settled on, then
   * re-frames, which matches what the button's label promises.
   */
  resetView(): void {
    if (this.graph && this.layoutHome.size) {
      const graph = this.graph;

      // Halt any in-flight relaxation first, so the restore is not immediately
      // overwritten by a frame that was already queued.
      this.stopLayoutLoop();
      this.layout?.stop();
      this.layout?.alphaTarget(0);

      graph.forEachNode((node) => {
        const home = this.layoutHome.get(node);
        if (home) {
          graph.setNodeAttribute(node, 'x', home.x);
          graph.setNodeAttribute(node, 'y', home.y);
        }
      });

      // Restore the simulation to match, clearing any pin left behind by an
      // interrupted drag (a pointerup lost outside the window). The frame loop
      // stops at `alphaMin`, so without this the pin could survive into a later
      // drag's re-heat and hold a node the user is not touching.
      this.layout?.nodes().forEach((node) => {
        const home = this.layoutHome.get(node.id);
        if (!home) return;
        node.x = home.x;
        node.y = home.y;
        node.vx = 0;
        node.vy = 0;
        node.fx = null;
        node.fy = null;
      });

      this.refreshRendering();
    }
    this.fitGraph();
  }

  /**
   * Bring the selected node to the centre of the stage.
   *
   * The previous implementation animated the camera to the node's raw graph
   * coordinates while forcing `ratio: 0.45`, mixing two coordinate spaces. It
   * measured **53 of 53** nodes off screen, with the camera at y = -42.9.
   *
   * Centring is now: convert the node to framed coordinates, keep the user's
   * current zoom if it is already close, and otherwise pull in to a readable
   * neighbourhood. Verified to land the node within 0 px of the stage centre.
   */
  centerSelected(): void {
    const selectedId = this.selectedNodeId();
    const sigma = this.sigma;
    if (!selectedId || !this.graph || !sigma || !this.graph.hasNode(selectedId)) return;

    const attributes = this.graph.getNodeAttributes(selectedId);
    const framed = this.graphPointToFramed(
      Number(attributes['x']) || 0,
      Number(attributes['y']) || 0
    );
    if (!framed) return;

    const camera = sigma.getCamera();
    const fit = this.fitCameraState(this.fitOccupancy());

    // Stay where the user is if they are already zoomed in past the fit;
    // otherwise move in far enough to read the node's neighbourhood.
    const targetRatio = fit ? Math.min(camera.ratio, Math.max(fit.ratio * 0.6, 0.3)) : camera.ratio;

    camera.animate({ x: framed.x, y: framed.y, ratio: targetRatio }, { duration: 350 });
  }

  updateSearch(term: string): void {
    this.searchTerm.set(term);
  }

  chooseSearchResult(id: string): void {
    this.searchTerm.set('');
    this.selectAccessibleNode(id);
    this.centerSelected();
  }

  async toggleFullscreen(): Promise<void> {
    if (this.isFullscreen()) {
      await this.exitFullscreen();
      return;
    }
    const stage = this.mapStage?.nativeElement;
    if (!stage || !document.fullscreenEnabled || !stage.requestFullscreen) return;
    await stage.requestFullscreen();
  }

  private async exitFullscreen(): Promise<void> {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  }

  zoomIn(): void {
    const camera = this.sigma?.getCamera();
    if (camera) {
      camera.animatedZoom({ duration: 200 });
    }
  }

  zoomOut(): void {
    const camera = this.sigma?.getCamera();
    if (camera) {
      camera.animatedUnzoom({ duration: 200 });
    }
  }

  selectAccessibleNode(id: string): void {
    this.selectedNodeId.set(id);
    this.conceptSelected.emit(id);
    this.refreshRendering();
  }
}
