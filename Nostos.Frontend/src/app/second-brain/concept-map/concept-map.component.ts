import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ConceptDto,
  ConceptsService,
  RelatedConceptDto,
} from '../../core/services/concepts.service';

export const MAX_MAP_CONCEPTS = 150;
/** Related data is deliberately limited to the 30 most-used visible concepts. */
export const RELATED_CONCEPT_LIMIT = 30;
export const MAP_WIDTH = 640;
export const MAP_HEIGHT = 600;

/**
 * The map is laid out in this viewBox and then fitted into it.
 *
 * It used to be a fixed 640x600 (aspect 1.07) widget in the ~320px sidebar, so
 * the box and the stage were both tall and the default `meet` scaling filled it.
 * Moved to the main stage the stage became wide (~992x558, aspect ~1.78) while
 * the viewBox stayed tall, so `meet` scaled to fit the HEIGHT and letterboxed the
 * graph into the middle ~55% of a wide canvas — a small cluster adrift in a large
 * empty frame.
 *
 * The viewBox now matches the stage's aspect (16:9) and `fitLayoutToViewBox`
 * scales the settled cluster into it, so the graph fills the space it is given
 * instead of clustering in the centre. `MAP_WIDTH`/`MAP_HEIGHT` are kept for the
 * layout maths and tests.
 */
export const MAP_VIEW_WIDTH = 960;
export const MAP_VIEW_HEIGHT = 540;
export const MAP_NODE_RADIUS_MIN = 14;
export const MAP_NODE_RADIUS_MAX = 34;
export const MAP_NODE_HIT_RADIUS = 52;
/**
 * Minimum gap between two node CIRCLES once the layout has settled.
 *
 * The spring model alone treats nodes as points, so with radii up to 34px it
 * packed discs on top of each other (measured on a 47-concept seed: 9 overlapping
 * pairs, the worst by 35px) and the graph read as a clump rather than a map. A
 * dedicated relaxation pass after the springs enforces this gap, which is why the
 * layout is collision-aware rather than merely repulsive.
 */
export const MAP_NODE_GAP = 6;

const LAYOUT_ITERATIONS = 300;
/**
 * Gauss-Seidel relaxation passes that resolve any remaining disc overlap. The
 * springs push nodes apart but never guarantee a gap; these passes do, and they
 * are deterministic (pairs are visited in a fixed order, in a fixed number of
 * passes), so equal data still yields an equal layout.
 */
const COLLISION_PASSES = 160;
/** Deterministic rounds of label re-placement; each round moves the first
 * colliding label to a free slot or defers it, so the panel converges. */
const LABEL_RELAXATION_ROUNDS = 256;
/** Re-try sweeps for labels deferred by an earlier round; each sweep is a full
 * pass over the deferred set, and the loop exits when a sweep places nobody. */
const LABEL_RELAXATION_SWEEPS = 8;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.5;
const MAP_TOOLTIP_HALF_WIDTH = 112;
const MAP_TOOLTIP_TOP = 88;
const MAP_TOOLTIP_BOTTOM = MAP_VIEW_HEIGHT - 16;
const MAP_LABEL_HALF_WIDTH = 100;

/* ── Label tiers ──
   Every node is labelled, but not every label carries the same weight. The
   most-referenced concepts are named at full strength; the rest sit quietly at
   zoom 1 and fade up as the user zooms in. This is the Obsidian "text fade
   threshold": names on a zoomed-out map are noise, names on a zoomed-in map are
   the point. The old model drew a hard third of the nodes and left the rest as
   anonymous dots, which is the opposite of useful at either zoom. */
export const MAP_LABEL_FONT_SIZE = 13;
/** Nodes at or above this rank by usage are named at full opacity, always. */
export const MAP_LABEL_PRIORITY_COUNT = 12;
/** Resting opacity of a placed-but-unprioritised label at zoom 1. */
export const MAP_LABEL_QUIET_OPACITY = 0.4;
/** Zoom at which the quiet tier starts fading up, and where it reaches full. */
export const MAP_LABEL_FADE_ZOOM_START = 1.05;
export const MAP_LABEL_FADE_ZOOM_END = 1.75;
/** Vertical gap between a node's edge and its label's baseline box. */
const MAP_LABEL_OFFSET = 6;
/** Hanken Grotesk 13px averages ~0.45em per glyph (measured on the painted
 * labels: median 5.82 viewBox units per char at 13px). Padded so the predicted
 * box is never NARROWER than the painted one — an under-estimate is a real
 * overlap, an over-estimate only costs a placement slot. */
export const MAP_LABEL_CHAR_RATIO = 0.52;
const MAP_LABEL_BOX_PADDING = 6;
export const MAP_LABEL_MAX_CHARS = 28;

/* ── Edges ──
   At rest the mesh is deliberately quiet so it sits BEHIND the nodes: a
   force-directed graph is mostly edges, and drawn at full strength they drown
   the concepts they connect. Hovering or selecting a node is what resolves the
   mesh — its own edges brighten, everything else recedes. */
export const MAP_EDGE_REST_OPACITY_MIN = 0.16;
export const MAP_EDGE_REST_OPACITY_MAX = 0.4;
export const MAP_EDGE_ACTIVE_OPACITY = 0.85;
export const MAP_EDGE_DIM_OPACITY = 0.06;

export type LabelAnchor = 'middle' | 'start' | 'end';

export interface ConceptMapNode extends ConceptDto {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  labelAnchor: LabelAnchor;
  /** Predicted painted width of the label, so a caller can reason about its box
   * without re-deriving the width model (a re-derivation in a spec is a guard
   * that cannot fail). */
  labelWidth: number;
  radius: number;
  connectionCount: number;
  /** Has a collision-free placement, and whether its label is always full-strength. */
  labelEligible: boolean;
  /** Rendered at all (placed, or deferred to the zoom-revealed tier). */
  showLabel: boolean;
  /** Whether the label is in the always-full-opacity tier. */
  labelPriority: boolean;
  /** Had no collision-free slot at rest, so it only appears once zoomed in. */
  labelDeferred: boolean;
}

export interface ConceptMapEdge {
  key: string;
  sourceId: string;
  targetId: string;
  sharedNotes: number;
  opacity: number;
  width: number;
}

export interface ConceptMapLayout {
  nodes: ConceptMapNode[];
  edges: ConceptMapEdge[];
}

function compareConcepts(a: ConceptDto, b: ConceptDto): number {
  return (
    b.usageCount - a.usageCount ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Maps references to area rather than radius: sqrt keeps a heavily-used idea
 * prominent without allowing it to swallow the small, tappable concepts.
 */
export function mapNodeRadius(
  usageCount: number,
  minUsage = 1,
  maxUsage = 200
): number {
  const low = Math.max(0, minUsage);
  const high = Math.max(low + 1, maxUsage);
  const ratio = Math.min(1, Math.max(0, (Math.max(0, usageCount) - low) / (high - low)));
  return MAP_NODE_RADIUS_MIN + (MAP_NODE_RADIUS_MAX - MAP_NODE_RADIUS_MIN) * Math.sqrt(ratio);
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function edgeKey(sourceId: string, targetId: string): string {
  return compareIds(sourceId, targetId) < 0
    ? `${sourceId}::${targetId}`
    : `${targetId}::${sourceId}`;
}

/** Build unique undirected edges from the related response for each source. */
export function deriveConceptMapEdges(
  concepts: readonly ConceptDto[],
  relatedBySource: ReadonlyMap<string, readonly RelatedConceptDto[]>
): ConceptMapEdge[] {
  const ids = new Set(concepts.map((concept) => concept.id));
  const unique = new Map<string, { sourceId: string; targetId: string; sharedNotes: number }>();

  for (const [sourceId, related] of relatedBySource) {
    if (!ids.has(sourceId)) continue;
    for (const item of related) {
      if (!ids.has(item.id) || item.id === sourceId) continue;
      const key = edgeKey(sourceId, item.id);
      const existing = unique.get(key);
      const sharedNotes = Math.max(0, item.sharedNotes);
      if (existing) {
        existing.sharedNotes = Math.max(existing.sharedNotes, sharedNotes);
      } else {
        const [firstId, secondId] = compareIds(sourceId, item.id) < 0
          ? [sourceId, item.id]
          : [item.id, sourceId];
        unique.set(key, { sourceId: firstId, targetId: secondId, sharedNotes });
      }
    }
  }

  const maximumSharedNotes = Math.max(
    1,
    ...[...unique.values()].map((edge) => edge.sharedNotes)
  );

  return [...unique.entries()]
    .sort(([first], [second]) => compareIds(first, second))
    .map(([key, edge]) => {
      const strength = edge.sharedNotes / maximumSharedNotes;
      return {
        key,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        sharedNotes: edge.sharedNotes,
        opacity: MAP_EDGE_REST_OPACITY_MIN + strength * (MAP_EDGE_REST_OPACITY_MAX - MAP_EDGE_REST_OPACITY_MIN),
        width: 1 + strength * 1.6,
      };
    });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Rendered text for a concept name, truncated so one long title cannot span the
 * whole canvas. The truncation is the ONLY place a label's width is decided, so
 * the collision maths and the template must both call it. */
export function mapLabelText(name: string): string {
  return name.length > MAP_LABEL_MAX_CHARS ? `${name.slice(0, MAP_LABEL_MAX_CHARS - 1)}…` : name;
}

/** Predicted painted width of a label, in viewBox units. */
export function mapLabelWidth(text: string): number {
  return text.length * MAP_LABEL_FONT_SIZE * MAP_LABEL_CHAR_RATIO + MAP_LABEL_BOX_PADDING;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function circleOverlapsBox(x: number, y: number, radius: number, box: LabelBox): boolean {
  // Closest point on the box to the circle centre.
  const nearestX = clamp(x, box.left, box.right);
  const nearestY = clamp(y, box.top, box.bottom);
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}

/** The four candidate slots for a label, in preference order. */
function labelCandidates(
  node: { x: number; y: number; radius: number },
  text: string
): Array<{ x: number; y: number; anchor: LabelAnchor; box: LabelBox }> {
  const width = mapLabelWidth(text);
  const half = width / 2;
  const height = MAP_LABEL_FONT_SIZE * 1.25;
  const offset = node.radius + MAP_LABEL_OFFSET;
  const boxOf = (cx: number, baseline: number): LabelBox => ({
    left: cx - half,
    right: cx + half,
    top: baseline - height * 0.8,
    bottom: baseline + height * 0.25,
  });

  const sideOffset = node.radius + MAP_LABEL_OFFSET;
  const below = node.y + offset + height * 0.8;
  const above = node.y - offset - height * 0.25;
  const sideY = node.y + MAP_LABEL_FONT_SIZE * 0.36;

  return [
    { x: node.x, y: below, anchor: 'middle' as LabelAnchor, box: boxOf(node.x, below) },
    { x: node.x, y: above, anchor: 'middle' as LabelAnchor, box: boxOf(node.x, above) },
    {
      x: node.x + sideOffset,
      y: sideY,
      anchor: 'start' as LabelAnchor,
      box: {
        left: node.x + sideOffset - 2,
        right: node.x + sideOffset + width,
        top: node.y - height * 0.8,
        bottom: node.y + height * 0.25,
      },
    },
    {
      x: node.x - sideOffset,
      y: sideY,
      anchor: 'end' as LabelAnchor,
      box: {
        left: node.x - sideOffset - width,
        right: node.x - sideOffset + 2,
        top: node.y - height * 0.8,
        bottom: node.y + height * 0.25,
      },
    },
    // Nearer/further variants of the vertical slots. A dense cluster leaves the
    // first four boxes contended; these two extra rows are what let a node whose
    // neighbours are all named take a third vertical position instead of being
    // deferred to the zoom-revealed tier. Kept close to the disc (the offsets
    // differ by only a few units) so the name still reads as belonging to it.
    {
      x: node.x,
      y: node.y + node.radius + MAP_LABEL_OFFSET + height * 1.6,
      anchor: 'middle' as LabelAnchor,
      box: boxOf(node.x, node.y + node.radius + MAP_LABEL_OFFSET + height * 1.6),
    },
    {
      x: node.x,
      y: node.y - node.radius - MAP_LABEL_OFFSET - height * 1.05,
      anchor: 'middle' as LabelAnchor,
      box: boxOf(node.x, node.y - node.radius - MAP_LABEL_OFFSET - height * 1.05),
    },
  ];
}

function fitsInsideViewBox(box: LabelBox): boolean {
  return (
    box.left >= 2 &&
    box.right <= MAP_VIEW_WIDTH - 2 &&
    box.top >= 2 &&
    box.bottom <= MAP_VIEW_HEIGHT - 2
  );
}

/**
 * Compute the whole graph synchronously. Positions are seeded by concept id,
 * so equal data has equal output and the SVG never needs a settling animation.
 *
 * The pipeline is: seed → springs (radius-aware repulsion + edge attraction +
 * weak gravity) → collision relaxation → fit into the viewBox → clear the zoom
 * overlay → centre → place labels. Each stage is deterministic, so the
 * "same data, same graph" property survives all of it.
 */
export function computeConceptMapLayout(
  inputConcepts: readonly ConceptDto[],
  relatedBySource: ReadonlyMap<string, readonly RelatedConceptDto[]> = new Map()
): ConceptMapLayout {
  const concepts = [...inputConcepts].sort(compareConcepts).slice(0, MAX_MAP_CONCEPTS);
  if (concepts.length === 0) return { nodes: [], edges: [] };

  const usages = concepts.map((concept) => Math.max(0, concept.usageCount));
  const minimumUsage = Math.min(...usages);
  const maximumUsage = Math.max(...usages);
  const edges = deriveConceptMapEdges(concepts, relatedBySource);
  const nodeById = new Map<
    string,
    { concept: ConceptDto; x: number; y: number; radius: number }
  >();

  for (const concept of concepts) {
    const seed = hashSeed(concept.id);
    const angle = seed * Math.PI * 2;
    const radialSeed = hashSeed(`${concept.id}:radius`);
    // Seed across the viewBox rather than a small central disc, so the
    // cluster starts distributed and the spring settling has room to spread.
    const radialX =
      concepts.length === 1 ? 0 : MAP_VIEW_WIDTH * 0.22 + radialSeed * MAP_VIEW_WIDTH * 0.26;
    const radialY =
      concepts.length === 1 ? 0 : MAP_VIEW_HEIGHT * 0.2 + radialSeed * MAP_VIEW_HEIGHT * 0.26;
    nodeById.set(concept.id, {
      concept,
      x: MAP_VIEW_WIDTH / 2 + Math.cos(angle) * radialX,
      y: MAP_VIEW_HEIGHT / 2 + Math.sin(angle) * radialY,
      radius: mapNodeRadius(concept.usageCount, minimumUsage, maximumUsage),
    });
  }

  const points = concepts.map((concept) => nodeById.get(concept.id)!);

  /** Touching distance for a pair of discs, plus the map's minimum gap. */
  const separationFor = (first: { radius: number }, second: { radius: number }) =>
    first.radius + second.radius + MAP_NODE_GAP;

  /**
   * The simulation box: the viewBox inset by the largest disc, so a node's
   * CIRCLE always lands inside the frame rather than its centre. The springs used
   * to be clamped to a box flush with the viewBox, which piled the outer nodes'
   * discs against the border; inset by the radius they stop where their edge does.
   */
  const wallInset = MAP_NODE_RADIUS_MAX + MAP_NODE_GAP;
  const keepInFrame = (point: { x: number; y: number }) => {
    point.x = clamp(point.x, wallInset, MAP_VIEW_WIDTH - wallInset);
    point.y = clamp(point.y, wallInset, MAP_VIEW_HEIGHT - wallInset);
  };

  if (concepts.length > 1) {
    // Target spring length. Grown from the old 640x600 rail sizing: on a wide
    // stage the same k left the cluster occupying under half the frame, so the
    // graph read as adrift rather than as a map. Repulsion is nudged up with it
    // to keep the cluster from collapsing back under attraction.
    const k = clamp(Math.sqrt((MAP_VIEW_WIDTH * MAP_VIEW_HEIGHT) / concepts.length) * 0.62, 120, 260);
    const indexById = new Map(concepts.map((concept, index) => [concept.id, index]));
    const edgePairs = edges.map((edge) => ({
      first: nodeById.get(edge.sourceId)!,
      second: nodeById.get(edge.targetId)!,
      firstIndex: indexById.get(edge.sourceId)!,
      secondIndex: indexById.get(edge.targetId)!,
    }));

    for (let iteration = 0; iteration < LAYOUT_ITERATIONS; iteration += 1) {
      const forces = concepts.map(() => ({ x: 0, y: 0 }));

      for (let firstIndex = 0; firstIndex < concepts.length; firstIndex += 1) {
        const first = nodeById.get(concepts[firstIndex].id)!;
        for (let secondIndex = firstIndex + 1; secondIndex < concepts.length; secondIndex += 1) {
          const second = nodeById.get(concepts[secondIndex].id)!;
          const deltaX = first.x - second.x;
          const deltaY = first.y - second.y;
          const centreDistance = Math.max(0.001, Math.hypot(deltaX, deltaY));
          // A node is a disc, not a point: the push is measured from the gap
          // between the two CIRCLES, and floored at the touching distance. Using
          // the raw surface gap made the force explode as discs touched
          // (k^2/1 against k^2/~100), which threw the cluster far outside the
          // frame; flooring it at the touching distance keeps the extra push
          // meaningful without letting it run away.
          const referenceDistance = Math.max(
            centreDistance,
            first.radius + second.radius + MAP_NODE_GAP
          );
          const repulsion = (k * k) / referenceDistance;
          const forceX = (deltaX / centreDistance) * repulsion * 0.0042;
          const forceY = (deltaY / centreDistance) * repulsion * 0.0042;
          forces[firstIndex].x += forceX;
          forces[firstIndex].y += forceY;
          forces[secondIndex].x -= forceX;
          forces[secondIndex].y -= forceY;
        }
      }

      for (const { first, second, firstIndex, secondIndex } of edgePairs) {
        const deltaX = second.x - first.x;
        const deltaY = second.y - first.y;
        const distance = Math.max(1, Math.hypot(deltaX, deltaY));
        const attraction = (distance * distance) / k * 0.0015;
        const forceX = (deltaX / distance) * attraction;
        const forceY = (deltaY / distance) * attraction;
        forces[firstIndex].x += forceX;
        forces[firstIndex].y += forceY;
        forces[secondIndex].x -= forceX;
        forces[secondIndex].y -= forceY;
      }

      const damping = 0.9 - iteration / (LAYOUT_ITERATIONS * 10);
      for (let index = 0; index < concepts.length; index += 1) {
        const point = points[index];
        forces[index].x += (MAP_VIEW_WIDTH / 2 - point.x) * 0.001;
        forces[index].y += (MAP_VIEW_HEIGHT / 2 - point.y) * 0.001;
        point.x += clamp(forces[index].x * damping, -10, 10);
        point.y += clamp(forces[index].y * damping, -10, 10);
        keepInFrame(point);
      }
    }
  } else {
    points.forEach(keepInFrame);
  }

  // Keep nodes out of the floating zoom overlay's corner.
  //
  // Measured on the real stage (822x420 CSS px for a 960x540 viewBox, so 1.168
  // user units per px) the overlay occupies user-space x >= 806, y <= 51. A node
  // placed there had its circle painted under the controls with only its label
  // poking out, so the whole band is pushed down clear of it.
  //
  // This runs BEFORE the relaxation loop below, and that ordering is the
  // load-bearing part: the first version nudged the band AFTER separation, so
  // every node in the band was collapsed onto one y value and piled back on top
  // of its neighbour (measured: one overlapping pair, 29px deep, that no amount
  // of relaxation could have prevented because it happened afterwards).
  //
  // There is deliberately NO scale step here either. An earlier version scaled
  // the settled cluster to fill the frame; that is wrong twice over — it silently
  // shrank the radii below the documented 14–34px contract (measured 10–24), and
  // a clamp on the fit made the graph EXPLODE instead (nodes at y = -1020 in a
  // 540-unit box). The frame is the simulation's own wall, so the cluster already
  // occupies it; centring is the only adjustment left, and it cannot change the
  // shape of the layout, which is what keeps "same data, same graph" true.
  if (points.length > 0) {
    const overlayLeft = MAP_VIEW_WIDTH - 190;
    const overlayBandBottom = 74;
    for (const point of points) {
      if (point.y < overlayBandBottom && point.x > overlayLeft) {
        point.y = clamp(overlayBandBottom, wallInset, MAP_VIEW_HEIGHT - wallInset);
      }
    }
  }

  // Final relaxation: separation + frame clamp, to convergence.
  //
  // This runs LAST (after the springs, after the overlay nudge) because both of
  // those can move a node onto another one. Every pair is separated to its
  // touching distance plus the gap and immediately re-clamped into the frame, and
  // the loop repeats until a full pass moves nothing — so the guarantee is
  // "no two discs overlap", not "no two discs overlapped when the springs
  // finished". It stays deterministic: fixed pair order, and a loop that exits on
  // a measured condition rather than a timer.
  if (points.length > 0) {
    for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
      let moved = false;
      for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
        const first = points[firstIndex];
        for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
          const second = points[secondIndex];
          const deltaX = second.x - first.x;
          const deltaY = second.y - first.y;
          const distance = Math.hypot(deltaX, deltaY);
          const wanted = separationFor(first, second);
          if (distance >= wanted) continue;
          // Deterministic separation direction for coincident nodes.
          const [unitX, unitY] =
            distance < 0.001
              ? [Math.cos(firstIndex + secondIndex), Math.sin(firstIndex + secondIndex)]
              : [deltaX / distance, deltaY / distance];
          const push = (wanted - distance) / 2 + 0.05;
          first.x -= unitX * push;
          first.y -= unitY * push;
          second.x += unitX * push;
          second.y += unitY * push;
          keepInFrame(first);
          keepInFrame(second);
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Centre on the drawn extents, bounded so centring cannot push a disc out of
    // the frame (a cluster already filling one axis simply does not move on it).
    const minX = Math.min(...points.map((point) => point.x - point.radius));
    const maxX = Math.max(...points.map((point) => point.x + point.radius));
    const minY = Math.min(...points.map((point) => point.y - point.radius));
    const maxY = Math.max(...points.map((point) => point.y + point.radius));
    const offsetX = clamp(MAP_VIEW_WIDTH / 2 - (minX + maxX) / 2, -minX, MAP_VIEW_WIDTH - maxX);
    const offsetY = clamp(MAP_VIEW_HEIGHT / 2 - (minY + maxY) / 2, -minY, MAP_VIEW_HEIGHT - maxY);
    for (const point of points) {
      point.x += offsetX;
      point.y += offsetY;
    }
  }

  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.sourceId, (connectionCounts.get(edge.sourceId) ?? 0) + 1);
    connectionCounts.set(edge.targetId, (connectionCounts.get(edge.targetId) ?? 0) + 1);
  }

  // ── Label placement ──
  //
  // Every node wants a name. The first pass gives each node the best free slot
  // among six candidates (chosen in usage-priority order, so the concepts that
  // matter most win the good positions). That greedy pass alone is not enough:
  // a box that was declared free can be invalidated by a box placed later, and
  // on the 47-concept seed it left one overlapping pair and eight labels sitting
  // over a disc.
  //
  // So a second, deterministic relaxation pass resolves the whole panel at once:
  // for a fixed number of rounds, every box that overlaps another box or a node
  // disc tries its alternatives again, in priority order, and the first node to
  // run out of alternatives has its label deferred to the zoom-revealed tier
  // (drawn only once the user zooms, so it can never collide at rest). Deferring
  // one node frees space for the rest, which is what makes the loop converge.
  const chosenSlots = new Map<
    string,
    { x: number; y: number; anchor: LabelAnchor; box: LabelBox }
  >();
  const optionByNode = new Map<
    string,
    Array<{ x: number; y: number; anchor: LabelAnchor; box: LabelBox }>
  >();

  concepts.forEach((concept) => {
    const point = nodeById.get(concept.id)!;
    const options = labelCandidates(point, mapLabelText(concept.name)).filter((candidate) =>
      fitsInsideViewBox(candidate.box)
    );
    optionByNode.set(concept.id, options);
    if (options.length > 0) chosenSlots.set(concept.id, options[0]);
  });

  const slotCollides = (id: string, box: LabelBox): boolean => {
    const point = nodeById.get(id)!;
    for (const [otherId, other] of chosenSlots) {
      if (otherId === id) continue;
      if (boxesOverlap(other.box, box)) return true;
    }
    for (const other of points) {
      if (other === point) continue;
      if (circleOverlapsBox(other.x, other.y, other.radius, box)) return true;
    }
    return false;
  };

  for (let round = 0; round < LABEL_RELAXATION_ROUNDS; round += 1) {
    const colliding = concepts.find((concept) => {
      const slot = chosenSlots.get(concept.id);
      return slot ? slotCollides(concept.id, slot.box) : false;
    });
    if (!colliding) break;
    const options = optionByNode.get(colliding.id) ?? [];
    const currentIndex = options.findIndex((option) => option === chosenSlots.get(colliding.id));
    const replacement = options
      .slice(currentIndex + 1)
      .find((option) => !slotCollides(colliding.id, option.box));
    if (replacement) chosenSlots.set(colliding.id, replacement);
    else chosenSlots.delete(colliding.id);
  }

  // Second chances. A node deferred early may fit once its neighbours have moved
  // on, so every deferred node is retried in priority order until a sweep places
  // nobody new. Without this the deferred set is whatever the first pass happened
  // to reject, which measured as 18 unnamed nodes out of 47 when far fewer needed
  // to be anonymous.
  for (let sweep = 0; sweep < LABEL_RELAXATION_SWEEPS; sweep += 1) {
    let placedAnything = false;
    for (const concept of concepts) {
      if (chosenSlots.has(concept.id)) continue;
      const options = optionByNode.get(concept.id) ?? [];
      const replacement = options.find((option) => !slotCollides(concept.id, option.box));
      if (!replacement) continue;
      chosenSlots.set(concept.id, replacement);
      placedAnything = true;
    }
    if (!placedAnything) break;
  }

  const placements = new Map<
    string,
    { x: number; y: number; anchor: LabelAnchor; priority: boolean }
  >();
  concepts.forEach((concept, index) => {
    const slot = chosenSlots.get(concept.id);
    if (!slot) return;
    placements.set(concept.id, {
      x: Number(slot.x.toFixed(3)),
      y: Number(slot.y.toFixed(3)),
      anchor: slot.anchor,
      priority: index < MAP_LABEL_PRIORITY_COUNT,
    });
  });

  return {
    nodes: concepts.map((concept) => {
      const point = nodeById.get(concept.id)!;
      const placement = placements.get(concept.id);
      return {
        ...concept,
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
        labelX: placement ? placement.x : Number(point.x.toFixed(3)),
        labelY: placement ? placement.y : Number((point.y + point.radius + 18).toFixed(3)),
        labelAnchor: placement ? placement.anchor : 'middle',
        labelWidth: Number(
          mapLabelWidth(
            mapLabelText(concept.name)
          ).toFixed(3)
        ),
        radius: point.radius,
        connectionCount: connectionCounts.get(concept.id) ?? 0,
        labelEligible: placement?.priority ?? false,
        showLabel: true,
        labelPriority: placement?.priority ?? false,
        labelDeferred: !placement,
      };
    }),
    edges,
  };
}

interface PointerPosition {
  x: number;
  y: number;
}

@Component({
  selector: 'app-concept-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './concept-map.component.html',
  styleUrl: './concept-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConceptMapComponent implements OnChanges {
  @Input() concepts: ConceptDto[] = [];
  @Input() selectedId: string | null = null;
  @Output() readonly conceptSelected = new EventEmitter<string>();

  readonly nodeHitRadius = MAP_NODE_HIT_RADIUS;
  readonly minZoom = MIN_ZOOM;
  readonly maxZoom = MAX_ZOOM;

  readonly displayedConcepts = signal<ConceptDto[]>([]);
  readonly nodes = signal<ConceptMapNode[]>([]);
  readonly edges = signal<ConceptMapEdge[]>([]);
  readonly relatedLoading = signal(false);
  readonly sourceCount = signal(0);
  readonly hoveredId = signal<string | null>(null);
  readonly focusedId = signal<string | null>(null);
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);

  private readonly selectedIdState = signal<string | null>(null);
  private readonly localSelectedId = signal<string | null>(null);
  private readonly relatedBySource = new Map<string, RelatedConceptDto[]>();
  private readonly pendingRelated = new Set<string>();
  private relatedRequestVersion = 0;
  private readonly pointerPositions = new Map<number, PointerPosition>();
  private panStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private pinchStart: { distance: number; zoom: number } | null = null;
  private didPan = false;

  readonly selectedNodeId = computed(() => this.selectedIdState() ?? this.localSelectedId());

  /**
   * The node the graph is currently resolving around: hover beats keyboard focus
   * beats selection, so moving the pointer around the map always re-resolves the
   * mesh rather than being overridden by a stale selection.
   */
  readonly activeNodeId = computed(
    () => this.hoveredId() ?? this.focusedId() ?? this.selectedNodeId()
  );

  /** Ids that share an edge with the active node (the active node itself included). */
  readonly highlightedIds = computed(() => {
    const activeId = this.activeNodeId();
    const ids = new Set<string>();
    if (!activeId) return ids;
    ids.add(activeId);
    for (const edge of this.edges()) {
      if (edge.sourceId === activeId) ids.add(edge.targetId);
      else if (edge.targetId === activeId) ids.add(edge.sourceId);
    }
    return ids;
  });

  readonly renderEdges = computed(() => {
    const nodeById = new Map(this.nodes().map((node) => [node.id, node]));
    const activeId = this.activeNodeId();
    return this.edges().map((edge) => {
      const active = !!activeId && (edge.sourceId === activeId || edge.targetId === activeId);
      const dimmed = !!activeId && !active;
      return {
        ...edge,
        source: nodeById.get(edge.sourceId),
        target: nodeById.get(edge.targetId),
        active,
        dimmed,
        // Resolved here, not in the template: the three tiers are one decision
        // (active / dimmed / rest) and splitting them across a style binding and
        // two constants is how they drift. Active edges are LIFTED, not merely
        // left alone — with the rest of the mesh dimmed, an un-lifted active edge
        // would read as "everything faded" rather than "this is what connects".
        renderOpacity: dimmed
          ? MAP_EDGE_DIM_OPACITY
          : active
            ? MAP_EDGE_ACTIVE_OPACITY
            : edge.opacity,
        renderWidth: active ? edge.width * 1.6 : edge.width,
      };
    });
  });

  readonly renderNodes = computed(() => {
    const activeId = this.activeNodeId();
    const highlighted = this.highlightedIds();
    const zoom = this.zoom();
    return this.nodes().map((node) => {
      const highlightedNode = highlighted.has(node.id);
      return {
        ...node,
        isActive: activeId === node.id,
        neighbour: !!activeId && highlightedNode && activeId !== node.id,
        dimmed: !!activeId && !highlightedNode,
        // One opacity for the label, resolved here rather than split between a
        // style binding and a stylesheet rule: an inline `[style.opacity]`
        // outranks any rule, so a stylesheet would need `!important` to be seen
        // at all. The tiers are: dimmed → priority → zoom ramp, with any
        // highlighted node named outright.
        labelOpacity: highlightedNode
          ? this.labelOpacityWhenActive(node)
          : this.labelOpacityFor(node, zoom),
      };
    });
  });

  readonly tooltipNode = computed(() => {
    const id = this.hoveredId() ?? this.focusedId() ?? this.selectedNodeId();
    return id ? this.nodes().find((node) => node.id === id) ?? null : null;
  });

  readonly tooltipTransform = computed(() => {
    const node = this.tooltipNode();
    if (!node) return null;
    // The tooltip lives inside the clipped SVG stage. Keep its fixed 224×72
    // box inside the viewBox even when the selected node is near an edge or
    // the user has panned/zoomed the map.
    const x = clamp(
      this.panX() + node.x * this.zoom(),
      MAP_TOOLTIP_HALF_WIDTH,
      MAP_VIEW_WIDTH - MAP_TOOLTIP_HALF_WIDTH
    );
    const y = clamp(
      this.panY() + node.y * this.zoom(),
      MAP_TOOLTIP_TOP,
      MAP_TOOLTIP_BOTTOM
    );
    return `translate(${x} ${y})`;
  });

  readonly noConnections = computed(() => this.edges().length === 0);
  readonly isCapped = computed(() => this.sourceCount() > MAX_MAP_CONCEPTS);

  constructor(private readonly conceptsService: ConceptsService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedId']) {
      this.selectedIdState.set(this.selectedId);
      if (this.selectedId) this.localSelectedId.set(this.selectedId);
    }
    if (changes['concepts']) this.acceptConcepts(this.concepts ?? []);
  }

  /**
   * A label's strength as a function of zoom.
   *
   * Priority labels are always fully opaque; the rest start faint and rise to
   * full as the user zooms, which is the Obsidian "text fade threshold" — names
   * on a zoomed-out map are noise, names on a zoomed-in map are the point.
   *
   * A deferred label is NOT part of this ramp, and that is deliberate. An earlier
   * version faded deferred labels in between zoom 1.4 and 2.2, which looked
   * reasonable and was wrong: those labels have no collision-free slot by
   * construction, so zooming made them overlap each other and the nodes (measured
   * at zoom 2.5: 16 colliding label pairs and 6 labels painted over a disc). They
   * now appear only while the node they belong to is the active one — hover,
   * keyboard focus or selection — so a reader gets every name in the
   * neighbourhood they are actually looking at, and the map is never illegible.
   */
  private labelOpacityFor(
    node: { labelPriority: boolean; labelDeferred: boolean },
    zoom: number
  ): number {
    if (node.labelDeferred) return 0;
    if (node.labelPriority) return 1;
    return this.ramp(zoom, MAP_LABEL_FADE_ZOOM_START, MAP_LABEL_FADE_ZOOM_END, MAP_LABEL_QUIET_OPACITY);
  }

  /** A label shown because its node is the active one (or a neighbour of it). */
  private labelOpacityWhenActive(node: { labelDeferred: boolean }): number {
    return node.labelDeferred ? 0.8 : 1;
  }

  /** Eased ramp from `from` to 1 between two zoom levels. */
  private ramp(zoom: number, start: number, end: number, from: number): number {
    if (zoom <= start) return from;
    if (zoom >= end) return 1;
    const t = (zoom - start) / (end - start);
    const eased = t * t * (3 - 2 * t);
    return from + (1 - from) * eased;
  }

  private acceptConcepts(input: readonly ConceptDto[]): void {
    this.sourceCount.set(input.length);
    const visible = [...input].sort(compareConcepts).slice(0, MAX_MAP_CONCEPTS);
    const visibleIds = new Set(visible.map((concept) => concept.id));
    for (const id of [...this.relatedBySource.keys()]) {
      if (!visibleIds.has(id)) this.relatedBySource.delete(id);
    }
    this.displayedConcepts.set(visible);
    this.resetView();
    this.relatedRequestVersion += 1;
    this.rebuildLayout();

    const topConcepts = visible.slice(0, RELATED_CONCEPT_LIMIT);
    const requestVersion = this.relatedRequestVersion;
    for (const concept of topConcepts) {
      if (this.relatedBySource.has(concept.id) || this.pendingRelated.has(concept.id)) continue;
      this.pendingRelated.add(concept.id);
      this.conceptsService.getRelated(concept.id).subscribe({
        next: (related) => {
          this.pendingRelated.delete(concept.id);
          this.relatedBySource.set(concept.id, related);
          if (requestVersion !== this.relatedRequestVersion) {
            this.syncCurrentRelatedState();
            return;
          }
          this.updateRelatedLoading(topConcepts);
          if (!this.relatedLoading()) this.rebuildLayout();
        },
        error: () => {
          this.pendingRelated.delete(concept.id);
          this.relatedBySource.set(concept.id, []);
          if (requestVersion !== this.relatedRequestVersion) {
            this.syncCurrentRelatedState();
            return;
          }
          this.updateRelatedLoading(topConcepts);
          if (!this.relatedLoading()) this.rebuildLayout();
        },
      });
    }
    this.updateRelatedLoading(topConcepts);
  }

  private updateRelatedLoading(topConcepts: readonly ConceptDto[]): void {
    this.relatedLoading.set(topConcepts.some((concept) => !this.relatedBySource.has(concept.id)));
  }

  private syncCurrentRelatedState(): void {
    const topConcepts = this.displayedConcepts().slice(0, RELATED_CONCEPT_LIMIT);
    this.updateRelatedLoading(topConcepts);
    if (!this.relatedLoading()) this.rebuildLayout();
  }

  private rebuildLayout(): void {
    const layout = computeConceptMapLayout(this.displayedConcepts(), this.relatedBySource);
    this.nodes.set(layout.nodes);
    this.edges.set(layout.edges);
  }

  resetView(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  zoomOut(): void {
    this.zoom.set(clamp(this.zoom() - 0.12, MIN_ZOOM, MAX_ZOOM));
    this.clampPan();
  }

  zoomIn(): void {
    this.zoom.set(clamp(this.zoom() + 0.12, MIN_ZOOM, MAX_ZOOM));
    this.clampPan();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const nextZoom = this.zoom() + (event.deltaY < 0 ? 0.12 : -0.12);
    this.zoom.set(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
    this.clampPan();
  }

  onPointerDown(event: PointerEvent): void {
    const surface = event.currentTarget as SVGSVGElement | null;
    surface?.setPointerCapture?.(event.pointerId);
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.didPan = false;

    if (this.pointerPositions.size === 1) {
      this.panStart = { x: event.clientX, y: event.clientY, panX: this.panX(), panY: this.panY() };
      this.pinchStart = null;
    } else if (this.pointerPositions.size === 2) {
      this.panStart = null;
      this.pinchStart = { distance: this.pointerDistance(), zoom: this.zoom() };
    }
  }

  onPointerMove(event: PointerEvent): void {
    const previous = this.pointerPositions.get(event.pointerId);
    if (!previous) return;
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointerPositions.size >= 2 && this.pinchStart) {
      const distance = this.pointerDistance();
      this.zoom.set(clamp(this.pinchStart.zoom * (distance / this.pinchStart.distance), MIN_ZOOM, MAX_ZOOM));
      this.clampPan();
      this.didPan = true;
      return;
    }

    if (!this.panStart) return;
    const scale = this.svgCoordinateScale(event.currentTarget as SVGSVGElement);
    const deltaX = (event.clientX - this.panStart.x) * scale / this.zoom();
    const deltaY = (event.clientY - this.panStart.y) * scale / this.zoom();
    if (Math.hypot(deltaX, deltaY) > 3) this.didPan = true;
    this.panX.set(this.clampPanValue(this.panStart.panX + deltaX, MAP_VIEW_WIDTH, this.zoom()));
    this.panY.set(this.clampPanValue(this.panStart.panY + deltaY, MAP_VIEW_HEIGHT, this.zoom()));
  }

  onPointerUp(event: PointerEvent): void {
    const surface = event.currentTarget as SVGSVGElement | null;
    if (surface?.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    this.pointerPositions.delete(event.pointerId);
    if (this.pointerPositions.size < 2) this.pinchStart = null;
    if (this.pointerPositions.size === 1) {
      const remaining = [...this.pointerPositions.values()][0];
      this.panStart = { x: remaining.x, y: remaining.y, panX: this.panX(), panY: this.panY() };
    } else if (this.pointerPositions.size === 0) {
      this.panStart = null;
    }
  }

  onPointerCancel(event: PointerEvent): void {
    this.onPointerUp(event);
  }

  private pointerDistance(): number {
    const points = [...this.pointerPositions.values()];
    return Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
  }

  private svgCoordinateScale(surface: SVGSVGElement): number {
    const width = surface.getBoundingClientRect().width;
    return width > 0 ? MAP_VIEW_WIDTH / width : 1;
  }

  private clampPanValue(value: number, size: number, zoom: number): number {
    const limit = Math.max(180, ((zoom - 1) * size) / 2 + 180);
    return clamp(value, -limit, limit);
  }

  private clampPan(): void {
    this.panX.set(this.clampPanValue(this.panX(), MAP_VIEW_WIDTH, this.zoom()));
    this.panY.set(this.clampPanValue(this.panY(), MAP_VIEW_HEIGHT, this.zoom()));
  }

  onNodeEnter(id: string): void {
    this.hoveredId.set(id);
  }

  onNodeLeave(id: string): void {
    if (this.hoveredId() === id) this.hoveredId.set(null);
  }

  onNodeFocus(id: string): void {
    this.focusedId.set(id);
  }

  onNodeBlur(id: string): void {
    if (this.focusedId() === id) this.focusedId.set(null);
  }

  onNodePointerDown(event: PointerEvent, id: string): void {
    event.stopPropagation();
    // A node tap is a selection gesture, not a request to move the canvas.
    // This also clears a previous canvas drag before the browser's click event.
    this.didPan = false;
    // Touch has no reliable hover phase. Set the same transient state on
    // pointer-down so a tap reveals the tooltip before the click is dispatched.
    this.hoveredId.set(id);
  }

  onNodeKeydown(event: KeyboardEvent, id: string): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    this.selectNode(id);
  }

  selectNode(id: string): void {
    if (this.didPan) return;
    this.selectConcept(id);
  }

  selectAccessibleNode(id: string): void {
    this.selectConcept(id);
  }

  tooltipLabel(name: string): string {
    return mapLabelText(name);
  }

  private selectConcept(id: string): void {
    this.localSelectedId.set(id);
    this.conceptSelected.emit(id);
  }
}
