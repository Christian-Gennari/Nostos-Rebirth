import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

// Mock Sigma and graphology before importing the component.
// Sigma requires WebGL2 which is not available in jsdom/Node.
vi.mock('sigma', () => {
  class MockSigma {
    constructor() {}
    on() { return this; }
    setSetting() {}
    refresh() {}
    kill() {}
    getCamera() {
      return {
        animatedReset: vi.fn(),
        animatedZoom: vi.fn(),
        animatedUnzoom: vi.fn(),
        animate: vi.fn(),
        disable: vi.fn(),
        enable: vi.fn(),
      };
    }
    getMouseCaptor() {
      return { on: vi.fn().mockReturnThis() };
    }
    viewportToGraph(coords: { x: number; y: number }) {
      return coords;
    }
  }
  return { default: MockSigma };
});

vi.mock('graphology', () => {
  class MockGraph {
    private nodes = new Map<string, Record<string, unknown>>();
    private edges: Array<{ key: string; source: string; target: string; attrs: Record<string, unknown> }> = [];

    addNode(key: string, attrs: Record<string, unknown> = {}) {
      this.nodes.set(key, attrs);
    }
    addEdge(source: string, target: string, attrs: Record<string, unknown> = {}) {
      const key = `${source}->${target}`;
      this.edges.push({ key, source, target, attrs });
      return key;
    }
    get order() { return this.nodes.size; }
    get size() { return this.edges.length; }
    hasNode(node: string) {
      return this.nodes.has(node);
    }
    getNodeAttributes(node: string) {
      return this.nodes.get(node) ?? {};
    }
    forEachNode(callback: (node: string, attrs: Record<string, unknown>) => void) {
      for (const [node, attrs] of this.nodes) callback(node, attrs);
    }
    setNodeAttribute(node: string, attribute: string, value: unknown) {
      this.nodes.get(node)![attribute] = value;
    }
    forEachEdge(callback: (edge: string, attrs: Record<string, unknown>, source: string, target: string) => void) {
      for (const e of this.edges) {
        callback(e.key, e.attrs, e.source, e.target);
      }
    }
    forEachNeighbor(node: string, callback: (neighbor: string) => void) {
      for (const e of this.edges) {
        if (e.source === node) callback(e.target);
        else if (e.target === node) callback(e.source);
      }
    }
    source(edge: string) {
      return this.edges.find(e => e.key === edge)?.source ?? '';
    }
    target(edge: string) {
      return this.edges.find(e => e.key === edge)?.target ?? '';
    }
  }
  return { default: MockGraph };
});

vi.mock('graphology-layout-forceatlas2', () => ({
  default: {
    assign: vi.fn(),
  },
}));

import {
  ConceptMapComponent,
  MAX_MAP_CONCEPTS,
} from './concept-map.component';
import { ConceptDto, ConceptGraphDto } from '../../core/services/concepts.service';

const concepts: ConceptDto[] = [
  { id: 'alpha', name: 'Alpha', usageCount: 12 },
  { id: 'beta', name: 'Beta', usageCount: 5 },
  { id: 'gamma', name: 'Gamma', usageCount: 2 },
];

const graphResponse: ConceptGraphDto = {
  nodes: [
    { id: 'alpha', name: 'Alpha', usageCount: 12 },
    { id: 'beta', name: 'Beta', usageCount: 5 },
    { id: 'gamma', name: 'Gamma', usageCount: 2 },
  ],
  edges: [
    { sourceId: 'alpha', targetId: 'beta', sharedNotes: 3 },
    { sourceId: 'alpha', targetId: 'gamma', sharedNotes: 1 },
  ],
};

describe('ConceptMapComponent', () => {
  let component: ConceptMapComponent;
  let fixture: ComponentFixture<ConceptMapComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConceptMapComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ConceptMapComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function setConcepts(value: ConceptDto[]): void {
    fixture.componentRef.setInput('concepts', value);
    fixture.detectChanges();
  }

  function flushGraph(data: ConceptGraphDto = graphResponse): void {
    const req = http.expectOne('/api/concepts/graph');
    req.flush(data);
    fixture.detectChanges();
  }

  it('fetches graph data when concepts are set', () => {
    setConcepts(concepts);
    const req = http.expectOne('/api/concepts/graph');
    expect(req.request.method).toBe('GET');
    req.flush(graphResponse);
    fixture.detectChanges();
    expect(component.loading()).toBe(false);
  });

  it('maps graph nodes into the accessible list', () => {
    setConcepts(concepts);
    flushGraph();

    const accessibleNodes = component.accessibleNodes();
    expect(accessibleNodes).toHaveLength(3);
    expect(accessibleNodes.map((n) => n.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Connection counts derived from edges.
    const alpha = accessibleNodes.find((n) => n.id === 'alpha')!;
    expect(alpha.connectionCount).toBe(2);
    const gamma = accessibleNodes.find((n) => n.id === 'gamma')!;
    expect(gamma.connectionCount).toBe(1);
  });

  it('handles empty graph state without crashing', () => {
    setConcepts([]);
    flushGraph({ nodes: [], edges: [] });

    expect(component.accessibleNodes()).toHaveLength(0);
    expect(component.loading()).toBe(false);
  });

  it('handles a single concept with no edges', () => {
    const singleConcept = [{ id: 'only', name: 'Only Concept', usageCount: 1 }];
    setConcepts(singleConcept);
    flushGraph({ nodes: [{ id: 'only', name: 'Only Concept', usageCount: 1 }], edges: [] });

    expect(component.accessibleNodes()).toHaveLength(1);
    expect(component.noConnections()).toBe(true);
  });

  it('shows the cap note when there are more than 150 concepts', () => {
    const manyConcepts = Array.from({ length: MAX_MAP_CONCEPTS + 1 }, (_, i) => ({
      id: `concept-${i}`,
      name: `Concept ${i}`,
      usageCount: i + 1,
    }));
    setConcepts(manyConcepts);
    flushGraph({
      nodes: manyConcepts.map((c) => ({ id: c.id, name: c.name, usageCount: c.usageCount })),
      edges: [],
    });

    expect(component.isCapped()).toBe(true);
    expect(fixture.nativeElement.querySelector('.map-limit-note')?.textContent).toContain(
      '150 most-referenced concepts'
    );
  });

  it('filters visible nodes to only include concepts passed as input', () => {
    // Graph has 3 nodes but we only pass 2 concepts.
    setConcepts([concepts[0], concepts[1]]);
    flushGraph();

    const nodes = component.accessibleNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.id).sort()).toEqual(['alpha', 'beta']);
  });

  it('emits the selected concept when selectAccessibleNode is called', () => {
    setConcepts(concepts);
    flushGraph();
    const selected = vi.fn();
    component.conceptSelected.subscribe(selected);

    component.selectAccessibleNode('alpha');

    expect(selected).toHaveBeenCalledWith('alpha');
    expect(component.selectedNodeId()).toBe('alpha');
  });

  it('supports searching and selecting a rendered concept', () => {
    setConcepts(concepts);
    flushGraph();

    component.updateSearch('alp');
    expect(component.searchResults().map((node) => node.id)).toEqual(['alpha']);

    const selected = vi.fn();
    component.conceptSelected.subscribe(selected);
    component.chooseSearchResult('alpha');

    expect(component.searchTerm()).toBe('');
    expect(component.selectedNodeId()).toBe('alpha');
    expect(selected).toHaveBeenCalledWith('alpha');
  });

  it('renders search only in focus mode and keeps graph controls available', () => {
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.map-control-label')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Focus mode');
    expect(fixture.nativeElement.textContent).toContain('Reset');

    component.isFullscreen.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeTruthy();
  });

  it('reflects externally set selectedId', () => {
    setConcepts(concepts);
    flushGraph();

    fixture.componentRef.setInput('selectedId', 'beta');
    fixture.detectChanges();

    expect(component.selectedNodeId()).toBe('beta');
  });

  it('keeps the accessible list in sync with the rendered graph', () => {
    setConcepts(concepts);
    flushGraph();

    const accessibleList = fixture.nativeElement.querySelector('.map-accessible-list') as HTMLElement;
    expect(accessibleList).toBeTruthy();
    expect(accessibleList.getAttribute('aria-label')).toBe('Concepts in this map');
    const buttons = accessibleList.querySelectorAll('button');
    expect(buttons).toHaveLength(3);

    // Every button has text content and aria-pressed.
    expect(
      [...buttons].every(
        (b) => b.textContent?.trim() && b.getAttribute('aria-pressed') !== null
      )
    ).toBe(true);
  });

  it('has zoom in, zoom out, and reset controls', () => {
    expect(fixture.nativeElement.querySelector('[aria-label="Zoom out"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Zoom in"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.map-reset')).toBeTruthy();
  });

  it('shows loading status while graph data is pending', () => {
    setConcepts(concepts);

    expect(component.loading()).toBe(true);
    const status = fixture.nativeElement.querySelector('.map-status');
    expect(status?.textContent).toContain('Loading graph');

    flushGraph();
    expect(component.loading()).toBe(false);
  });

  it('disposes Sigma renderer on component destruction', () => {
    setConcepts(concepts);
    flushGraph();

    // The component should not throw when destroyed.
    expect(() => {
      fixture.destroy();
    }).not.toThrow();
  });

  it('makes only a single /api/concepts/graph request, not N+1 related requests', () => {
    setConcepts(concepts);

    // Expect exactly one graph request, not per-concept related requests.
    const graphReqs = http.match('/api/concepts/graph');
    expect(graphReqs).toHaveLength(1);
    graphReqs[0].flush(graphResponse);

    // No /related requests should have been made.
    const relatedReqs = http.match((req) => req.url.includes('/related'));
    expect(relatedReqs).toHaveLength(0);
    fixture.detectChanges();
  });
});
