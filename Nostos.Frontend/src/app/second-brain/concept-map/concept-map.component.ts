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
const EDGE_SIZE_MIN = 0.5;
const EDGE_SIZE_MAX = 3;
const LABEL_SIZE_MIN = 10;
const LABEL_SIZE_MAX = 16;

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
 * ForceAtlas2 works in arbitrary graph coordinates. Sigma fits those
 * coordinates literally, so a compact ForceAtlas2 extent becomes a tiny
 * cluster in a large stage. Normalize the settled extent into a padded square
 * before handing it to Sigma; this preserves the graph shape while making the
 * graph use the available stage.
 */
function normalizeGraphPositions(graph: Graph): void {
  const points: Array<{ node: string; x: number; y: number }> = [];
  graph.forEachNode((node, attrs) => {
    points.push({ node, x: Number(attrs['x']) || 0, y: Number(attrs['y']) || 0 });
  });
  if (points.length === 0) return;

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const scale = 1.76 / span;

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
  edgeOpacityMin: number;
  edgeOpacityRange: number;
  label: string;
  labelActive: string;
}

function readTheme(): ThemeColors {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    node: getCssVar('--graph-node', '#8b8e99'),
    nodeHead: getCssVar('--graph-node-head', '#4a4d57'),
    edge: getCssVar('--graph-edge', '#8b8e99'),
    edgeActive: getCssVar('--graph-edge-active', '#2b2d33'),
    edgeOpacityMin: dark ? 0.28 : 0.34,
    edgeOpacityRange: dark ? 0.2 : 0.2,
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
        labelColor: hexToRgba(this.theme.label, 0.74 + ratio * 0.2),
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
          color: hexToRgba(
            this.theme.edge,
            this.theme.edgeOpacityMin + strength * this.theme.edgeOpacityRange
          ),
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

    normalizeGraphPositions(graph);

    // Create Sigma renderer.
    const sigma = new Sigma(graph, container, {
      renderLabels: true,
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 4.5,
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
    });

    this.sigma = sigma;

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
          res['color'] = hexToRgba(component.theme.node, 0.22);
          res['label'] = '';
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
          res['color'] = hexToRgba(component.theme.edgeActive, 0.56);
          res['size'] = ((data['size'] as number) ?? 1) * 1.6;
          res['zIndex'] = 1;
        } else {
          res['color'] = hexToRgba(component.theme.edge, 0.06);
          res['zIndex'] = 0;
        }
      }

      return res;
    });

    // Event listeners.
    sigma.on('enterNode', ({ node }) => {
      component.hoveredId.set(node);
      sigma.refresh();
    });

    sigma.on('leaveNode', () => {
      component.hoveredId.set(null);
      sigma.refresh();
    });

    sigma.on('clickNode', ({ node }) => {
      component.selectedNodeId.set(node);
      component.conceptSelected.emit(node);
      sigma.refresh();
    });

    sigma.on('clickStage', () => {
      // Clicking empty space clears hover highlighting but keeps selection.
      component.hoveredId.set(null);
      sigma.refresh();
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

    // Camera reset to frame the graph.
    sigma.getCamera().animatedReset();
  }

  private disposeSigma(): void {
    if (this.sigma) {
      this.sigma.kill();
      this.sigma = null;
    }
    this.graph = null;
  }

  private refreshRendering(): void {
    if (this.sigma) {
      this.sigma.refresh();
    }
  }

  /* ── Template actions ── */

  resetView(): void {
    this.sigma?.getCamera().animatedReset();
  }

  fitGraph(): void {
    this.sigma?.getCamera().animatedReset({ duration: 350 });
  }

  centerSelected(): void {
    const selectedId = this.selectedNodeId();
    if (!selectedId || !this.graph || !this.sigma || !this.graph.hasNode(selectedId)) return;
    const attributes = this.graph.getNodeAttributes(selectedId);
    this.sigma.getCamera().animate(
      { x: Number(attributes['x']), y: Number(attributes['y']), ratio: 0.45 },
      { duration: 350 }
    );
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
