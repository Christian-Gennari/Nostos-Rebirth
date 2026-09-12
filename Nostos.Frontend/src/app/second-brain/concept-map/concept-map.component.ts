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
export const MAP_NODE_RADIUS_MIN = 14;
export const MAP_NODE_RADIUS_MAX = 34;
export const MAP_NODE_HIT_RADIUS = 52;

const LAYOUT_ITERATIONS = 300;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.5;
const MAP_TOOLTIP_HALF_WIDTH = 112;
const MAP_TOOLTIP_TOP = 88;
const MAP_TOOLTIP_BOTTOM = MAP_HEIGHT - 16;
const MAP_LABEL_HALF_WIDTH = 100;
const MAP_DEFAULT_LABEL_LIMIT = 8;

export interface ConceptMapNode extends ConceptDto {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  radius: number;
  connectionCount: number;
  labelEligible: boolean;
  showLabel: boolean;
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
        opacity: 0.28 + strength * 0.5,
        width: 1 + strength * 2,
      };
    });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Compute the whole graph synchronously. Positions are seeded by concept id,
 * so equal data has equal output and the SVG never needs a settling animation.
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
  const sortedUsages = [...usages].sort((a, b) => a - b);
  const middle = Math.floor(sortedUsages.length / 2);
  const medianUsage = sortedUsages.length % 2 === 0
    ? (sortedUsages[middle - 1] + sortedUsages[middle]) / 2
    : sortedUsages[middle];
  const edges = deriveConceptMapEdges(concepts, relatedBySource);
  // The map can live in a 280px rail. Showing every median-usage label makes
  // a connected cluster unreadable, so reserve the quiet default labels for
  // the most-referenced nodes; hover, focus and selection still reveal any
  // other node's label.
  const labelLimit = Math.min(
    concepts.length,
    Math.max(4, Math.min(MAP_DEFAULT_LABEL_LIMIT, Math.ceil(concepts.length * 0.35)))
  );
  const nodeById = new Map<string, { concept: ConceptDto; x: number; y: number; radius: number }>();

  for (const concept of concepts) {
    const seed = hashSeed(concept.id);
    const angle = seed * Math.PI * 2;
    const radialSeed = hashSeed(`${concept.id}:radius`);
    const radialX = concepts.length === 1 ? 0 : (MAP_WIDTH * 0.16) + radialSeed * MAP_WIDTH * 0.27;
    const radialY = concepts.length === 1 ? 0 : (MAP_HEIGHT * 0.13) + radialSeed * MAP_HEIGHT * 0.18;
    nodeById.set(concept.id, {
      concept,
      x: MAP_WIDTH / 2 + Math.cos(angle) * radialX,
      y: MAP_HEIGHT / 2 + Math.sin(angle) * radialY,
      radius: mapNodeRadius(concept.usageCount, minimumUsage, maximumUsage),
    });
  }

  if (concepts.length > 1) {
    const k = clamp(Math.sqrt((MAP_WIDTH * MAP_HEIGHT) / concepts.length) * 0.5, 70, 150);
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
          const distance = Math.max(1, Math.hypot(deltaX, deltaY));
          const repulsion = (k * k) / distance;
          const forceX = (deltaX / distance) * repulsion * 0.003;
          const forceY = (deltaY / distance) * repulsion * 0.003;
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
        const point = nodeById.get(concepts[index].id)!;
        forces[index].x += (MAP_WIDTH / 2 - point.x) * 0.001;
        forces[index].y += (MAP_HEIGHT / 2 - point.y) * 0.001;
        point.x = clamp(point.x + clamp(forces[index].x * damping, -10, 10), 48, MAP_WIDTH - 48);
        point.y = clamp(point.y + clamp(forces[index].y * damping, -10, 10), 48, MAP_HEIGHT - 48);
      }
    }
  }

  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.sourceId, (connectionCounts.get(edge.sourceId) ?? 0) + 1);
    connectionCounts.set(edge.targetId, (connectionCounts.get(edge.targetId) ?? 0) + 1);
  }

  return {
    nodes: concepts.map((concept) => {
      const point = nodeById.get(concept.id)!;
      return {
        ...concept,
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
        // Labels are centered under their node, but the node layout may put a
        // long name near the stage edge. Keep the text anchor inside the
        // visible map so a long concept never disappears into the clip.
        labelX: Number(clamp(point.x, MAP_LABEL_HALF_WIDTH, MAP_WIDTH - MAP_LABEL_HALF_WIDTH).toFixed(3)),
        labelY: Number(clamp(point.y + point.radius + 18, 18, MAP_HEIGHT - 8).toFixed(3)),
        radius: point.radius,
        connectionCount: connectionCounts.get(concept.id) ?? 0,
        labelEligible: concepts.indexOf(concept) < labelLimit && concept.usageCount >= medianUsage,
        showLabel: concepts.indexOf(concept) < labelLimit && concept.usageCount >= medianUsage,
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
  readonly renderEdges = computed(() => {
    const nodeById = new Map(this.nodes().map((node) => [node.id, node]));
    return this.edges().map((edge) => ({
      ...edge,
      source: nodeById.get(edge.sourceId),
      target: nodeById.get(edge.targetId),
    }));
  });
  readonly renderNodes = computed(() => {
    const selectedId = this.selectedNodeId();
    const hoveredId = this.hoveredId();
    const focusedId = this.focusedId();
    return this.nodes().map((node) => ({
      ...node,
      showLabel:
        node.labelEligible || node.id === selectedId || node.id === hoveredId || node.id === focusedId,
    }));
  });
  readonly tooltipNode = computed(() => {
    const id = this.hoveredId() ?? this.focusedId() ?? this.selectedNodeId();
    return id ? this.renderNodes().find((node) => node.id === id) ?? null : null;
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
      MAP_WIDTH - MAP_TOOLTIP_HALF_WIDTH
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
    this.panX.set(this.clampPanValue(this.panStart.panX + deltaX, MAP_WIDTH, this.zoom()));
    this.panY.set(this.clampPanValue(this.panStart.panY + deltaY, MAP_HEIGHT, this.zoom()));
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
    return width > 0 ? MAP_WIDTH / width : 1;
  }

  private clampPanValue(value: number, size: number, zoom: number): number {
    const limit = Math.max(180, ((zoom - 1) * size) / 2 + 180);
    return clamp(value, -limit, limit);
  }

  private clampPan(): void {
    this.panX.set(this.clampPanValue(this.panX(), MAP_WIDTH, this.zoom()));
    this.panY.set(this.clampPanValue(this.panY(), MAP_HEIGHT, this.zoom()));
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
    return name.length > 28 ? `${name.slice(0, 27)}…` : name;
  }

  private selectConcept(id: string): void {
    this.localSelectedId.set(id);
    this.conceptSelected.emit(id);
  }
}
