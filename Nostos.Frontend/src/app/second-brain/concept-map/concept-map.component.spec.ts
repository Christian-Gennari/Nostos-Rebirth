import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  ConceptMapComponent,
  computeConceptMapLayout,
  MAP_NODE_RADIUS_MAX,
  MAP_NODE_RADIUS_MIN,
  mapNodeRadius,
  MAX_MAP_CONCEPTS,
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
});
