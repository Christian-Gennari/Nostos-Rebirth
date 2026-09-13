import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  ConceptMapComponent,
  computeConceptMapLayout,
  MAP_LABEL_CHAR_RATIO,
  MAP_LABEL_FONT_SIZE,
  MAP_NODE_RADIUS_MAX,
  MAP_NODE_RADIUS_MIN,
  mapLabelWidth,
  mapNodeRadius,
  MAX_MAP_CONCEPTS,
  MAP_VIEW_HEIGHT,
  MAP_VIEW_WIDTH,
  RELATED_CONCEPT_LIMIT,
} from './concept-map.component';
import { ConceptDto } from '../../core/services/concepts.service';

const concepts: ConceptDto[] = [
  { id: 'alpha', name: 'Alpha', usageCount: 12 },
  { id: 'beta', name: 'Beta', usageCount: 5 },
  { id: 'gamma', name: 'Gamma', usageCount: 2 },
];

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

  function flushRelated(value: object[] = []): void {
    for (const request of http.match((item) => item.url.endsWith('/related'))) {
      request.flush(value);
    }
    fixture.detectChanges();
  }

  it('scales node radius monotonically within the configured bounds', () => {
    const radii = [1, 5, 25, 200].map((usage) => mapNodeRadius(usage, 1, 200));

    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(radii[0]).toBe(MAP_NODE_RADIUS_MIN);
    expect(radii.at(-1)).toBe(MAP_NODE_RADIUS_MAX);
  });

  it('produces a deterministic layout for the same concepts and related data', () => {
    const related = new Map([
      ['alpha', [{ id: 'beta', name: 'Beta', sharedNotes: 3 }]],
      ['beta', [{ id: 'alpha', name: 'Alpha', sharedNotes: 3 }]],
    ]);

    expect(computeConceptMapLayout(concepts, related)).toEqual(
      computeConceptMapLayout(concepts, related)
    );
  });

  it('handles the empty and single-concept boundaries', () => {
    expect(computeConceptMapLayout([])).toEqual({ nodes: [], edges: [] });

    const single = computeConceptMapLayout([
      { id: 'only', name: 'Only Concept', usageCount: 1 },
    ]);
    expect(single.nodes).toHaveLength(1);
    expect(single.edges).toHaveLength(0);

    const node = single.nodes[0];
    // One node sits centred, at full size, fully named and inside the frame.
    expect(node.x).toBeCloseTo(MAP_VIEW_WIDTH / 2, 0);
    expect(node.y).toBeCloseTo(MAP_VIEW_HEIGHT / 2, 0);
    expect(node.radius).toBe(MAP_NODE_RADIUS_MIN);
    expect(node.labelPriority).toBe(true);
    expect(node.labelDeferred).toBe(false);

    // A lone node has no neighbours, so nothing is dimmed and no edge is drawn.
    setConcepts([{ id: 'only', name: 'Only Concept', usageCount: 1 }]);
    flushRelated();
    expect(component.noConnections()).toBe(true);
    expect(component.renderNodes().every((item) => !item.dimmed)).toBe(true);
  });

  it('pins the label width model to the measured painted width', () => {
    // The label collision guard derives its boxes from the SAME constant the
    // placement uses, so on its own it cannot fail when that constant is wrong —
    // verified by mutation: setting the ratio to 0.28 left the collision spec
    // green. This is the guard that closes that hole, by pinning the model to
    // widths measured from the real rendered text (Hanken Grotesk 13px:
    // 5.82 viewBox units per character, measured on the painted labels of a
    // 47-concept map via getBoundingClientRect).
    const measuredUnitsPerChar = 5.82;
    expect(MAP_LABEL_FONT_SIZE * MAP_LABEL_CHAR_RATIO).toBeGreaterThanOrEqual(measuredUnitsPerChar);

    const text = 'Mind: Attention';
    const predicted = mapLabelWidth(text);
    // The model must not UNDER-estimate: an under-estimate is a real overlap,
    // while an over-estimate only costs a placement slot.
    expect(predicted).toBeGreaterThanOrEqual(text.length * measuredUnitsPerChar);
    // ...and must not be so loose that it refuses placements it could make.
    expect(predicted).toBeLessThanOrEqual(text.length * measuredUnitsPerChar * 1.25);
  });

  it('places every label inside the viewBox and never overlapping another', () => {
    const layout = computeConceptMapLayout([
      ...concepts,
      {
        id: 'long',
        name: 'A concept name that should never be clipped at the edge',
        usageCount: 4,
      },
    ]);

    // Boxes are derived from the label geometry the layout itself reports, and
    // the anchor decides which side of labelX the text occupies. Asserting the
    // BOX (rather than a distance from each edge) is the real contract: the point
    // of a label is that it is readable, and a label 100 units from the edge can
    // still overlap its neighbour or sit on a node.
    const boxes = layout.nodes.map((node) => {
      const half = node.labelWidth / 2;
      const left = node.labelAnchor === 'start' ? node.labelX : node.labelX - half;
      const right = node.labelAnchor === 'end' ? node.labelX : node.labelX + half;
      return { id: node.id, left, right, top: node.labelY - 13, bottom: node.labelY + 4 };
    });

    expect(boxes.every((box) => box.left >= 0 && box.right <= MAP_VIEW_WIDTH)).toBe(true);
    expect(boxes.every((box) => box.top >= 0 && box.bottom <= MAP_VIEW_HEIGHT)).toBe(true);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `${a.id} and ${b.id} labels overlap`).toBe(false);
      }
    }
  });

  it('names the most-used concepts outright and keeps the rest quiet at zoom 1', () => {
    const layout = computeConceptMapLayout(concepts);

    // Every node is labelled: the old map drew a hard third and left the rest as
    // anonymous dots, which reads the same at every zoom level.
    expect(layout.nodes.every((node) => node.showLabel)).toBe(true);
    expect(layout.nodes.filter((node) => node.labelPriority).length).toBe(concepts.length);
  });

  it('derives unique weighted edges from related responses', () => {
    const layout = computeConceptMapLayout(concepts, new Map([
      ['alpha', [
        { id: 'beta', name: 'Beta', sharedNotes: 2 },
        { id: 'gamma', name: 'Gamma', sharedNotes: 1 },
      ]],
      ['beta', [{ id: 'alpha', name: 'Alpha', sharedNotes: 4 }]],
    ]));

    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.find((edge) => edge.key === 'alpha::beta')).toMatchObject({
      sourceId: 'alpha',
      targetId: 'beta',
      sharedNotes: 4,
    });
    expect(layout.nodes.find((node) => node.id === 'alpha')?.connectionCount).toBe(2);
  });

  it('loads related data only for the most-used visible concepts', () => {
    const manyConcepts = Array.from({ length: RELATED_CONCEPT_LIMIT + 4 }, (_, index) => ({
      id: `concept-${index}`,
      name: `Concept ${index}`,
      usageCount: index + 1,
    }));

    setConcepts(manyConcepts);
    expect(http.match((item) => item.url.endsWith('/related'))).toHaveLength(RELATED_CONCEPT_LIMIT);
    flushRelated();
  });

  it('caps the rendered graph at the 150 most-referenced concepts', () => {
    const manyConcepts = Array.from({ length: MAX_MAP_CONCEPTS + 1 }, (_, index) => ({
      id: `concept-${index}`,
      name: `Concept ${index}`,
      usageCount: index + 1,
    }));

    setConcepts(manyConcepts);
    flushRelated();

    expect(component.displayedConcepts()).toHaveLength(MAX_MAP_CONCEPTS);
    expect(fixture.nativeElement.querySelectorAll('.map-node')).toHaveLength(MAX_MAP_CONCEPTS);
    expect(fixture.nativeElement.querySelector('.map-limit-note')?.textContent).toContain(
      '150 most-referenced concepts'
    );
  });

  it('keeps an accessible list in sync with visible nodes', () => {
    setConcepts(concepts);
    flushRelated();

    const nodes = fixture.nativeElement.querySelectorAll('.map-node');
    const entries = fixture.nativeElement.querySelectorAll('.map-accessible-list button');
    expect(entries).toHaveLength(nodes.length);
    const nodeNames = [...nodes].map((node) => node.getAttribute('aria-label')?.split(',')[0]);
    const entryNames = [...entries].map((entry) => entry.textContent?.split('—')[0].trim());
    expect(entryNames).toEqual(nodeNames);
  });

  it('emits the selected concept when a node is clicked', () => {
    setConcepts(concepts);
    flushRelated();
    const selected = vi.fn();
    component.conceptSelected.subscribe(selected);

    (fixture.nativeElement.querySelector('.map-node') as SVGGElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    expect(selected).toHaveBeenCalledWith('alpha');
  });

  it('shows a tooltip immediately on a touch pointer-down and keeps it in the viewBox', () => {
    setConcepts(concepts);
    flushRelated();

    component.panX.set(-1000);
    component.panY.set(-2000);
    component.zoom.set(2.5);
    component.onNodePointerDown(
      { stopPropagation: vi.fn() } as unknown as PointerEvent,
      'alpha'
    );

    expect(component.hoveredId()).toBe('alpha');
    expect(component.tooltipTransform()).toBe('translate(112 88)');
  });

  it('keeps the map accessible list available beside the visual graph', () => {
    setConcepts(concepts);
    flushRelated();

    const accessibleList = fixture.nativeElement.querySelector('.map-accessible-list') as HTMLElement;
    expect(accessibleList).toBeTruthy();
    expect(accessibleList.getAttribute('aria-label')).toBe('Concepts in this map');
    expect(accessibleList.querySelectorAll('button')).toHaveLength(concepts.length);
    expect(fixture.nativeElement.querySelector('[aria-label="Zoom out"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Zoom in"]')).toBeTruthy();
    expect(
      [...accessibleList.querySelectorAll('button')].every(
        (button) => button.textContent?.trim() && button.getAttribute('aria-pressed') !== null
      )
    ).toBe(true);
  });

  it('offers bounded keyboard and touch zoom controls', () => {
    expect(component.zoom()).toBe(1);
    component.zoomIn();
    expect(component.zoom()).toBeCloseTo(1.12);

    component.zoom.set(component.maxZoom);
    component.zoomIn();
    expect(component.zoom()).toBe(component.maxZoom);

    component.zoom.set(component.minZoom);
    component.zoomOut();
    expect(component.zoom()).toBe(component.minZoom);
  });

  it('never lets two node discs overlap, including after the overlay nudge', () => {
    // Scale is chosen so the overlay band (top-right) has nodes in it, which is
    // the exact condition that re-created an overlap when the nudge ran after
    // separation: every banded node collapsed onto one y value.
    const manyConcepts = Array.from({ length: 60 }, (_, index) => ({
      id: `concept-${index}`,
      name: `Concept ${index}`,
      usageCount: 1 + (index % 7),
    }));
    const related = new Map<string, { id: string; name: string; sharedNotes: number }[]>();
    for (let index = 0; index < 60; index += 1) {
      related.set(`concept-${index}`, [
        { id: `concept-${(index + 1) % 60}`, name: 'x', sharedNotes: 1 },
        { id: `concept-${(index + 13) % 60}`, name: 'y', sharedNotes: 2 },
      ]);
    }

    const layout = computeConceptMapLayout(manyConcepts, related);
    let worstGap = Infinity;
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
        worstGap = Math.min(worstGap, gap);
      }
    }

    expect(worstGap, `worst gap ${worstGap.toFixed(2)}px`).toBeGreaterThan(0);
    expect(layout.nodes.every((node) => node.radius >= MAP_NODE_RADIUS_MIN - 0.001)).toBe(true);
    expect(layout.nodes.every((node) => node.radius <= MAP_NODE_RADIUS_MAX + 0.001)).toBe(true);
  });

  it('resolves the mesh around the hovered node and clears on leave', () => {
    setConcepts(concepts);
    flushRelated([
      { id: 'beta', name: 'Beta', sharedNotes: 3 },
      { id: 'gamma', name: 'Gamma', sharedNotes: 1 },
    ]);

    expect(component.activeNodeId()).toBeNull();
    expect(component.renderEdges().every((edge) => !edge.dimmed)).toBe(true);

    component.onNodeEnter('alpha');

    expect(component.activeNodeId()).toBe('alpha');
    const active = component.renderEdges().filter((edge) => edge.active);
    const dimmed = component.renderEdges().filter((edge) => edge.dimmed);
    expect(active.length).toBeGreaterThan(0);
    expect(dimmed.every((edge) => edge.renderOpacity < 0.1)).toBe(true);
    expect(active.every((edge) => edge.renderOpacity > 0.5)).toBe(true);
    // The active node and both its neighbours are named; everything else dims.
    const named = component.renderNodes().filter((node) => node.labelOpacity > 0.5);
    expect(named.map((node) => node.id).sort()).toEqual(['alpha', 'beta', 'gamma']);

    component.onNodeLeave('alpha');
    expect(component.activeNodeId()).toBeNull();
    expect(component.renderEdges().every((edge) => !edge.dimmed)).toBe(true);
  });

  it('fades placed labels up with zoom and never reveals a deferred one', () => {
    const manyConcepts = Array.from({ length: 18 }, (_, index) => ({
      id: `concept-${index}`,
      name: `Concept ${index}`,
      usageCount: 18 - index,
    }));
    setConcepts(manyConcepts);
    flushRelated();

    const placed = component.renderNodes().find((item) => !item.labelPriority && !item.labelDeferred);
    expect(placed, 'expected at least one placed unprioritised label').toBeTruthy();

    component.zoom.set(1);
    const atRest = component.renderNodes().find((item) => item.id === placed!.id)!.labelOpacity;
    component.zoom.set(2);
    const zoomedIn = component.renderNodes().find((item) => item.id === placed!.id)!.labelOpacity;

    expect(atRest).toBeGreaterThan(0);
    expect(atRest).toBeLessThan(0.5);
    expect(zoomedIn).toBeGreaterThan(atRest);

    // A deferred label must stay invisible at EVERY zoom. An earlier version
    // faded these in between zoom 1.4 and 2.2, which read as reasonable and
    // produced 16 colliding label pairs and 6 labels painted over a disc at 2.5,
    // because a deferred label is by definition one with no free slot.
    for (const deferred of component.renderNodes().filter((item) => item.labelDeferred)) {
      component.zoom.set(0.65);
      expect(component.renderNodes().find((item) => item.id === deferred.id)!.labelOpacity).toBe(0);
      component.zoom.set(1.5);
      expect(component.renderNodes().find((item) => item.id === deferred.id)!.labelOpacity).toBe(0);
      component.zoom.set(2.5);
      expect(component.renderNodes().find((item) => item.id === deferred.id)!.labelOpacity).toBe(0);
    }
  });

  it('names a deferred node while it is the active one', () => {
    // A dense fixture is what produces deferred labels: 150 concepts whose names
    // are long enough that six candidate slots per node cannot all be free. A
    // sparse fixture places everything and has no deferred node to test.
    const dense = Array.from({ length: MAX_MAP_CONCEPTS }, (_, index) => ({
      id: `dense-${index}`,
      name: `A fairly long concept name number ${index}`,
      usageCount: MAX_MAP_CONCEPTS - index,
    }));
    setConcepts(dense);
    flushRelated();

    const deferred = component.renderNodes().find((item) => item.labelDeferred);
    expect(deferred, 'a dense map must defer some labels').toBeTruthy();

    component.zoom.set(1);
    expect(component.renderNodes().find((item) => item.id === deferred!.id)!.labelOpacity).toBe(0);

    component.onNodeEnter(deferred!.id);
    const active = component.renderNodes().find((item) => item.id === deferred!.id)!;
    expect(active.labelOpacity).toBeGreaterThan(0.5);
  });
});
