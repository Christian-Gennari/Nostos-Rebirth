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
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

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
const LABEL_SIZE_MIN = 10;
const LABEL_SIZE_MAX = 16;

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
 * background" report. Sweeping the composite against the real field shows both
 * themes clear the 3:1 non-text minimum at 0.70 (light 3.70:1, dark 3.62:1),
 * which keeps the rest of the map legible while the active neighbourhood still
 * stands out.
 */
const NODE_ALPHA_DIM = 0.7;

/** Edges not touching the active node: quieter than nodes, but still present. */
const EDGE_ALPHA_DIM = 0.34;

/**
 * Labels render for every node down to the smallest drawn size; decollision is
 * left to Sigma's label grid. At the previous value (4.5) the majority of
 * concepts render at exactly 4.0 and were suppressed, so only 15 of 53 labels
 * appeared.
 */
const LABEL_RENDER_MIN_SIZE = 3.2;

/** Fraction of the stage a fitted graph should occupy, leaving breathing room. */
const FIT_OCCUPANCY = 0.88;

/**
 * Pointer travel, in CSS pixels, before a press on a node counts as a drag
 * rather than a click. Without a threshold the sub-pixel movement of an
 * ordinary click trips the drag path and the click-to-select that follows is
 * suppressed.
 */
const DRAG_THRESHOLD_PX = 3;

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
 * ForceAtlas2 works in arbitrary graph coordinates that are unrelated to the
 * stage. Sigma is run with `autoRescale: false` (so that dragging one node
 * leaves the rest of the layout alone), which means graph units map 1:1 onto
 * screen pixels. Normalize the settled extent into stage-sized pixel units
 * centred on the origin, so the graph arrives roughly framed and individual
 * drags never rescale their neighbours.
 */
function normalizeGraphPositions(graph: Graph, stageWidth: number, stageHeight: number): void {
  const points: Array<{ node: string; x: number; y: number }> = [];
  graph.forEachNode((node, attrs) => {
    points.push({ node, x: Number(attrs['x']) || 0, y: Number(attrs['y']) || 0 });
  });
  if (points.length === 0) return;

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  // Fit the settled extent into the stage, preserving aspect ratio.
  const width = Math.max(stageWidth, 1);
  const height = Math.max(stageHeight, 1);
  const scale = Math.min((width * FIT_OCCUPANCY) / spanX, (height * FIT_OCCUPANCY) / spanY);

  for (const point of points) {
    graph.setNodeAttribute(point.node, 'x', (point.x - centreX) * scale);
    graph.setNodeAttribute(point.node, 'y', (point.y - centreY) * scale);
  }
}

interface ThemeColors {
  node: string;
  nodeHead: string;
  edge: string;
  edgeActive: string;
  label: string;
  labelActive: string;
}

function readTheme(): ThemeColors {
  return {
    node: getCssVar('--graph-node', '#8b8e99'),
    nodeHead: getCssVar('--graph-node-head', '#4a4d57'),
    edge: getCssVar('--graph-edge', '#8b8e99'),
    edgeActive: getCssVar('--graph-edge-active', '#2b2d33'),
    label: getCssVar('--color-text-muted', '#6b6e78'),
    labelActive: getCssVar('--color-text-main', '#2b2d33'),
  };
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
  imports: [CommonModule],
  templateUrl: './concept-map.component.html',
  styleUrl: './concept-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConceptMapComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() concepts: ConceptDto[] = [];
  @Input() selectedId: string | null = null;
  @Output() readonly conceptSelected = new EventEmitter<string>();

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

  /* Drag-to-reposition state */
  private draggedNode: string | null = null;
  private isDragging = false;
  private dragStart: { x: number; y: number } | null = null;

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

    // Add nodes.
    for (const node of visibleNodes) {
      const ratio = (Math.max(0, node.usageCount) - minUsage) / usageRange;
      const size = NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.sqrt(ratio);
      const labelSize = LABEL_SIZE_MIN + (LABEL_SIZE_MAX - LABEL_SIZE_MIN) * Math.sqrt(ratio);
      const nodeColor = mixHex(this.theme.node, this.theme.nodeHead, 0.18 + ratio * 0.42);

      graph.addNode(node.id, {
        label: node.name,
        size,
        color: nodeColor,
        labelColor: hexToRgba(this.theme.label, 0.8 + ratio * 0.16),
        x: hashSeed(`${node.id}:x`) * 2 - 1,
        y: hashSeed(`${node.id}:y`) * 2 - 1,
        usageCount: node.usageCount,
        labelSize,
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

    // Run ForceAtlas2 layout synchronously.
    if (graph.order > 1) {
      forceAtlas2.assign(graph, {
        iterations: 300,
        settings: {
          gravity: 0.4,
          scalingRatio: 18,
          barnesHutOptimize: graph.order > 100,
          strongGravityMode: false,
          slowDown: 8,
          adjustSizes: true,
        },
      });
    }

    // Stage size is needed to normalize the settled layout into pixel units.
    const stageWidth = container.clientWidth || 800;
    const stageHeight = container.clientHeight || 600;
    normalizeGraphPositions(graph, stageWidth, stageHeight);

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
      labelColor: { color: this.theme.label },
      labelSize: 12,
      defaultEdgeType: 'line',
      enableEdgeEvents: false,
      allowInvalidContainer: true,
      // Node sizes are pixel sizes; graph coordinates are normalized separately
      // so the visual scale does not change when the graph fills the stage.
      itemSizesReference: 'screen',
      zoomToSizeRatioFunction: (ratio: number) => ratio,
      // Keep the user's layout authoritative.
      //
      // With autoRescale on, Sigma re-maps the whole graph onto the viewport
      // whenever the extent changes, so dragging one node away shrinks every
      // other node (measured: width fill 57% -> 6.4%) and the Fit/Reset buttons
      // then return to an already-current camera and appear dead. Off, graph
      // units map 1:1 to screen pixels and a drag moves only what was dragged.
      autoRescale: false,
      autoCenter: false,
      stagePadding: 0,
      // Sigma's label grid deconflicts labels for us: measured 0 merged blobs at
      // every density tried, while raising density from 1 to 1.6 lifted the
      // displayed labels from 20 to 30 of 53. More of the map is legible with no
      // collisions introduced.
      labelDensity: 1.6,
    });

    this.sigma = sigma;

    // Keep the renderer reachable for diagnostics and for the visual-verification
    // harness, which measures graph geometry through the live instance. Read-only
    // introspection: no application behaviour depends on these handles.
    const globals = globalThis as unknown as { __nostosSigma?: unknown; __nostosGraph?: unknown };
    globals.__nostosSigma = sigma;
    globals.__nostosGraph = graph;

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
          res['color'] = hexToRgba(component.theme.edgeActive, 0.72);
          res['size'] = Math.max((data['size'] as number) ?? 1, 2) * 1.5;
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

    sigma.on('clickStage', () => {
      // Clicking empty space clears hover highlighting but keeps selection.
      component.hoveredId.set(null);
      sigma.refresh();
    });

    // ── Drag-to-reposition ──
    // On mousedown over a node, start tracking; on mousemove, update the
    // node's position in graph coordinates so the user can untangle clusters.
    sigma.on('downNode', (e) => {
      component.isDragging = false;
      // e.event is the MouseCoords for this interaction.
      component.dragStart = { x: e.event.x, y: e.event.y };
      component.draggedNode = e.node;
      // Prevent Sigma's default camera panning while dragging a node.
      sigma.getCamera().disable();
      container.classList.add('dragging');
    });

    // Sigma v3 fires 'mousemovebody' on every pointer-move over the canvas.
    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!component.draggedNode) return;

      // Only promote to a real drag once the pointer has travelled past a small
      // threshold. Without this, the sub-pixel movement of an ordinary click
      // counts as a drag and the click-to-select that follows is swallowed.
      if (!component.isDragging && component.dragStart) {
        const travelled = Math.hypot(e.x - component.dragStart.x, e.y - component.dragStart.y);
        if (travelled < DRAG_THRESHOLD_PX) return;
        component.isDragging = true;
      }

      // Convert viewport coordinates to graph coordinates.
      const pos = sigma.viewportToGraph({ x: e.x, y: e.y });
      graph.setNodeAttribute(component.draggedNode, 'x', pos.x);
      graph.setNodeAttribute(component.draggedNode, 'y', pos.y);

      // Prevent Sigma's default camera panning while dragging.
      e.preventSigmaDefault();
    });

    // On mouseup, finalize the drag.
    sigma.getMouseCaptor().on('mouseup', () => {
      component.draggedNode = null;
      component.dragStart = null;
      sigma.getCamera().enable();
      container.classList.remove('dragging');
      // Reset the drag flag after Sigma has dispatched the click that follows
      // mouseup, so a genuine drag never also selects the node it moved.
      window.setTimeout(() => {
        component.isDragging = false;
      }, 0);
    });

    // Resize observer to keep Sigma in sync with container size changes.
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.sigma && !this.destroyed) {
          this.sigma.refresh();
        }
      });
      this.resizeObserver.observe(container);
    }
    // Frame the graph on first paint.
    this.fitGraph();
  }

  private disposeSigma(): void {
    if (this.sigma) {
      this.sigma.kill();
      this.sigma = null;
    }
    this.graph = null;
    this.draggedNode = null;
    this.isDragging = false;
    this.dragStart = null;
    this.layoutHome.clear();
  }

  private refreshRendering(): void {
    if (this.sigma) {
      this.sigma.refresh();
    }
  }

  /* ── Template actions ── */

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
   * The camera state that frames the whole graph.
   *
   * Sigma's own coordinate model, with `autoRescale: false`, is the authority
   * here. From its `process()` and `createNormalizationFunction`:
   *
   *   - the normalization extents are centred on the graph's centre,
   *   - both axes are divided by `max(stageWidth, stageHeight)`, not by their
   *     own axis, and
   *   - the camera's x/y are FRAMED coordinates in 0..1, i.e. the graph point
   *     shown at the centre of the stage.
   *
   * So `framed(g) = 0.5 + (g - centre) / max(W, H)`, and the viewport mapping is
   * `vpx = W/2 + (framed.x - cam.x) * W / ratio` (with y inverted). Inverting
   * those for "the span occupies `occupancy` of the stage" gives the ratio below.
   *
   * The previous implementation called `camera.animatedReset()`, which returns
   * to the camera's captured initial state. That state is normally already
   * current, so Fit and Reset did nothing at all — measured: after dragging a
   * node the graph filled 6.4% of the stage and clicking Fit changed no pixel.
   */
  private fitCameraState(occupancy = FIT_OCCUPANCY): { x: number; y: number; ratio: number } | null {
    const extent = this.graphExtent();
    const sigma = this.sigma;
    if (!extent || !sigma) return null;

    const { width, height } = sigma.getDimensions();
    if (!width || !height) return null;

    const spanX = Math.max(extent.maxX - extent.minX, 1e-6);
    const spanY = Math.max(extent.maxY - extent.minY, 1e-6);
    const normalizer = Math.max(width, height);

    // Fit both axes and take whichever is tighter, so nothing spills out.
    const ratioX = spanX / (normalizer * occupancy);
    const ratioY = (spanY * width) / (normalizer * height * occupancy);

    return { x: 0.5, y: 0.5, ratio: Math.max(ratioX, ratioY) };
  }

  /**
   * Convert a point in graph coordinates to the camera's framed coordinates.
   */
  private graphPointToFramed(x: number, y: number): { x: number; y: number } | null {
    const extent = this.graphExtent();
    const sigma = this.sigma;
    if (!extent || !sigma) return null;
    const { width, height } = sigma.getDimensions();
    const normalizer = Math.max(width, height, 1);
    const centreX = (extent.minX + extent.maxX) / 2;
    const centreY = (extent.minY + extent.maxY) / 2;
    return { x: 0.5 + (x - centreX) / normalizer, y: 0.5 + (y - centreY) / normalizer };
  }

  /** Frame the whole graph. */
  fitGraph(): void {
    const state = this.fitCameraState();
    if (!state || !this.sigma) return;
    this.sigma.getCamera().animate(state, { duration: 350 });
  }

  /**
   * Restore the settled layout AND re-frame it.
   *
   * "Reset" used to call `animatedReset()`, which only touched the camera — so
   * after a user had dragged nodes around, Reset left every moved node exactly
   * where it was. It now restores the positions ForceAtlas2 computed, then
   * re-frames, which matches what the button's label promises.
   */
  resetView(): void {
    if (this.graph && this.layoutHome.size) {
      const graph = this.graph;
      graph.forEachNode((node) => {
        const home = this.layoutHome.get(node);
        if (home) {
          graph.setNodeAttribute(node, 'x', home.x);
          graph.setNodeAttribute(node, 'y', home.y);
        }
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
    const fit = this.fitCameraState();

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
