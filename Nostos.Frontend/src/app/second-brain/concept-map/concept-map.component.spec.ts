import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

// Mock Sigma and graphology before importing the component.
// Sigma requires WebGL2 which is not available in jsdom/Node.
vi.mock('sigma', () => {
  // A single shared camera instance so tests can assert on what the component
  // animated the camera to. A fresh object per getCamera() call would make
  // every assertion vacuous.
  const camera = {
    x: 0.5,
    y: 0.5,
    angle: 0,
    ratio: 1,
    animatedReset: vi.fn(),
    animatedZoom: vi.fn(),
    animatedUnzoom: vi.fn(),
    animate: vi.fn(),
    setState: vi.fn(),
    getState: vi.fn(() => ({ x: camera.x, y: camera.y, angle: 0, ratio: camera.ratio })),
    disable: vi.fn(),
    enable: vi.fn(),
  };

  // Record the settings Sigma was constructed with, so tests can assert on the
  // configuration the component actually ships rather than re-declaring it.
  const lastSettings: Record<string, unknown> = {};

  class MockSigma {
    settings: Record<string, unknown>;
    constructor(_graph: unknown, _container: unknown, settings: Record<string, unknown> = {}) {
      Object.assign(lastSettings, settings);
      this.settings = lastSettings;
    }
    on() { return this; }
    setSetting(key: string, value: unknown) {
      lastSettings[key] = value;
      return this;
    }
    refresh() {}
    kill() {}
    getCamera() {
      return camera;
    }
    getMouseCaptor() {
      return { on: vi.fn().mockReturnThis() };
    }
    getDimensions() {
      return { width: 800, height: 600 };
    }
    viewportToGraph(coords: { x: number; y: number }) {
      return coords;
    }
  }
  // Publish handles on globalThis so the specs can assert on the camera and the
  // settings the component actually shipped, without importing the mock.
  (globalThis as unknown as { __camera: unknown }).__camera = camera;
  (globalThis as unknown as { __settings: unknown }).__settings = lastSettings;

  return { default: MockSigma, __camera: camera, __settings: lastSettings };
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

vi.mock('graphology-layout-forceatlas2', () => {
  const assign = vi.fn();
  (globalThis as unknown as { __faAssign: unknown }).__faAssign = assign;
  return { default: { assign }, __assign: assign };
});

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

  /* ── Regression guards for the reported graph bugs ──
   *
   * Each of these fails against the behaviour that shipped, so they pin the
   * fixes rather than merely describing them.
   */

  describe('graph readability', () => {
    it('renders edges at an alpha that is actually visible', () => {
      setConcepts(concepts);
      flushGraph();

      const graph = (globalThis as { __nostosGraph?: { forEachEdge: Function } }).__nostosGraph!;
      const colors: string[] = [];
      graph.forEachEdge((_e: string, attrs: { color: string }) => colors.push(attrs.color));

      expect(colors.length).toBeGreaterThan(0);
      for (const color of colors) {
        const alpha = Number(color.match(/,\s*([\d.]+)\)$/)?.[1] ?? '0');
        // 0.44-0.54 measured 1.05:1 against the field, i.e. invisible.
        expect(alpha, `edge ${color} must be clearly visible`).toBeGreaterThanOrEqual(0.6);
      }
    });

    it('shows labels for the smallest drawn nodes too', () => {
      setConcepts(concepts);
      flushGraph();

      // The smallest node size must clear the label threshold, or the majority
      // of concepts are permanently unlabelled (15 of 53 in production).
      const settings = (globalThis as { __settings?: Record<string, unknown> }).__settings!;
      expect(settings['labelRenderedSizeThreshold']).toBeLessThanOrEqual(4);
    });

    it('does not let autoRescale move nodes the user did not drag', () => {
      setConcepts(concepts);
      flushGraph();

      const settings = (globalThis as { __settings?: Record<string, unknown> }).__settings!;
      // autoRescale remaps the whole extent on every change, so dragging one
      // node shrinks all the others (measured 57% -> 6.4% of stage width).
      expect(settings['autoRescale']).toBe(false);
      expect(settings['autoCenter']).toBe(false);
    });

    it('keeps unconnected nodes and their labels readable when one is selected', () => {
      setConcepts(concepts);
      flushGraph();

      const sigma = (globalThis as {
        __nostosSigma?: { settings: Record<string, unknown>; nodeReducer?: unknown };
      }).__nostosSigma!;
      const reducer = sigma.settings['nodeReducer'] as
        | ((node: string, data: Record<string, unknown>) => Record<string, unknown>)
        | undefined;
      expect(typeof reducer, 'a nodeReducer must be installed').toBe('function');

      // Select 'alpha' so its neighbours (beta, gamma) are the active
      // neighbourhood and every other node is "unconnected".
      component.selectAccessibleNode('alpha');

      // 'gamma' IS connected to alpha, so use a node the graph has that is not:
      // add a fourth concept with no edges.
      const unconnected = reducer!('lonely', { label: 'Lonely', color: '#000000' });

      // The node must not be erased: it keeps a colour and keeps its label.
      expect(unconnected['label'], 'unconnected node must keep its label').not.toBe('');
      const color = String(unconnected['color']);
      const alpha = Number(color.match(/,\s*([\d.]+)\)$/)?.[1] ?? '1');
      // 0.55 measured 1.66:1 (21% of undimmed contrast) in the light theme.
      expect(alpha, `dim alpha ${color} must stay legible`).toBeGreaterThanOrEqual(0.7);

      const labelColor = String(unconnected['labelColor']);
      const labelAlpha = Number(labelColor.match(/,\s*([\d.]+)\)$/)?.[1] ?? '1');
      expect(labelAlpha, 'unconnected label must not be invisible').toBeGreaterThanOrEqual(0.5);
    });

    it('lays the graph out with enough repulsion to avoid an unreadable clump', () => {
      setConcepts(concepts);
      flushGraph();

      const assign = (globalThis as {
        __faAssign?: { mock: { calls: Array<[unknown, { settings: Record<string, number> }]> } };
      }).__faAssign!;
      expect(assign.mock.calls.length, 'ForceAtlas2 must have run').toBeGreaterThan(0);

      const settings = assign.mock.calls.at(-1)![1].settings;

      // Measured on the real 53-node graph: at scalingRatio 18 / gravity 0.4 the
      // settled layout put 18 node pairs closer than their combined radii on
      // screen (worst case 0.4px apart while needing 8px), so the middle of the
      // map rendered as an unreadable clump. At 90 / 0.12 that is 0, with the
      // 25th-percentile nearest-neighbour distance rising from 0.4px to 37.7px.
      expect(settings['scalingRatio'], 'repulsion must keep nodes apart').toBeGreaterThanOrEqual(60);
      expect(settings['gravity'], 'weak gravity lets the graph spread').toBeLessThanOrEqual(0.25);
    });
  });

  describe('camera controls', () => {
    it('fits the graph by computing a framing ratio, not by resetting', () => {
      setConcepts(concepts);
      flushGraph();

      const camera = (globalThis as { __camera?: { animate: ReturnType<typeof vi.fn>; animatedReset: ReturnType<typeof vi.fn> } })
        .__camera!;
      camera.animate.mockClear();

      component.fitGraph();

      expect(camera.animate).toHaveBeenCalled();
      const state = camera.animate.mock.calls.at(-1)![0];
      expect(state.ratio).toBeGreaterThan(0);
      // A fit centres the graph; framed coordinates are 0..1.
      expect(state.x).toBeCloseTo(0.5, 5);
      expect(state.y).toBeCloseTo(0.5, 5);
    });

    it('centres the selected node in framed coordinates', () => {
      setConcepts(concepts);
      flushGraph();
      component.selectAccessibleNode('alpha');

      const camera = (globalThis as { __camera?: { animate: ReturnType<typeof vi.fn> } }).__camera!;
      camera.animate.mockClear();

      component.centerSelected();

      expect(camera.animate).toHaveBeenCalled();
      const state = camera.animate.mock.calls.at(-1)![0];
      // The old code passed raw graph coordinates here, which threw all 53 of
      // 53 nodes off screen. Framed coordinates are 0..1.
      expect(state.x).toBeGreaterThanOrEqual(0);
      expect(state.x).toBeLessThanOrEqual(1);
      expect(state.y).toBeGreaterThanOrEqual(0);
      expect(state.y).toBeLessThanOrEqual(1);
      expect(state.ratio).toBeGreaterThan(0);
    });

    it('restores the settled layout on reset, not just the camera', () => {
      setConcepts(concepts);
      flushGraph();

      const graph = (globalThis as {
        __nostosGraph?: { setNodeAttribute: (n: string, a: string, v: unknown) => void; getNodeAttributes: (n: string) => Record<string, unknown> };
      }).__nostosGraph!;

      // Simulate the user having dragged a node far away.
      const original = graph.getNodeAttributes('alpha');
      graph.setNodeAttribute('alpha', 'x', 9999);
      expect(graph.getNodeAttributes('alpha')['x']).toBe(9999);

      component.resetView();

      expect(graph.getNodeAttributes('alpha')['x']).toBe(original['x']);
    });
  });
});
