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
const LABEL_RENDERED_SIZE_THRESHOLD = 8;

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
    edge: getCssVar('--color-accent', '#8b8e99'),
    edgeActive: getCssVar('--color-text-main', '#2b2d33'),
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
  readonly sourceCount = signal(0);
  readonly isCapped = computed(() => this.sourceCount() > MAX_MAP_CONCEPTS);
  readonly noConnections = signal(false);

  /**
   * Accessible nodes: the full set currently rendered, so the hidden list
   * stays in sync with the visual canvas.
   */
  readonly accessibleNodes = signal<
    Array<{ id: string; name: string; usageCount: number; connectionCount: number }>
  >([]);

  private readonly conceptsService = inject(ConceptsService);

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
    if (this.pendingRebuild) {
      this.pendingRebuild = false;
      this.rebuildSigma();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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

      graph.addNode(node.id, {
        label: node.name,
        size,
        color: this.theme.node,
        x: Math.random() * 100 - 50,
        y: Math.random() * 100 - 50,
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
          color: hexToRgba(this.theme.edge, 0.15 + strength * 0.25),
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
        iterations: 200,
        settings: {
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: graph.order > 100,
          strongGravityMode: false,
          slowDown: 5,
          adjustSizes: true,
        },
      });
    }

    // Create Sigma renderer.
    const sigma = new Sigma(graph, container, {
      renderLabels: true,
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: LABEL_RENDERED_SIZE_THRESHOLD,
      labelFont: "'Hanken Grotesk', sans-serif",
      labelColor: { color: this.theme.label },
      labelSize: 13,
      defaultEdgeType: 'line',
      enableEdgeEvents: false,
      allowInvalidContainer: true,
      // Sigma v3 settings
      itemSizesReference: 'positions',
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
          res['color'] = component.theme.edgeActive;
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
