import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SecondBrain } from './second-brain.component';
import { ConceptDetailDto, ConceptDto, ConceptStatsDto } from '../core/services/concepts.service';

/**
 * Second Brain behaviour that the "flashing" complaint was about.
 *
 * The page's background is identical for every concept, so the detail pane must
 * swap its content WITHOUT a loading surface and WITHOUT an arrival animation.
 * These specs pin the two mechanisms that made it flash: the `loadingDetail`
 * bit that used to drive a covering wait-field, and the re-fetch of an
 * already-seen concept.
 */
const concepts: ConceptDto[] = [
  { id: 'c-alpha', name: 'Alpha', usageCount: 9 },
  { id: 'c-beta', name: 'Beta', usageCount: 3 },
  { id: 'c-gamma', name: 'Gamma', usageCount: 3 },
];

const stats: ConceptStatsDto = {
  totalConcepts: 3,
  totalReferences: 15,
  singleNoteConcepts: 0,
  mostUsedName: 'Alpha',
  mostUsedCount: 9,
};

const detail = (id: string, name: string): ConceptDetailDto => ({
  id,
  name,
  notes: [
    {
      noteId: `${id}-n1`,
      content: `A note about [[${name}]]`,
      selectedText: undefined,
      cfiRange: undefined,
      bookId: 'b1',
      bookTitle: 'Meditations',
    },
  ],
});

describe('SecondBrain', () => {
  let component: SecondBrain;
  let fixture: ComponentFixture<SecondBrain>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecondBrain],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SecondBrain);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/concepts').flush(concepts);
    http.expectOne('/api/concepts/stats').flush(stats);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('never raises the loading state when a concept is selected from cache', async () => {
    component.selectConcept('c-alpha');
    expect(component.loadingDetail()).toBe(true);
    http.expectOne('/api/concepts/c-alpha').flush(detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    expect(component.loadingDetail()).toBe(false);

    // Second visit to the same concept: served from the detail cache, so the
    // pane must never enter — let alone render — a waiting state. No request,
    // and `loadingDetail` never true.
    component.selectConcept('c-beta');
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    await fixture.whenStable();

    component.selectConcept('c-alpha');
    expect(component.loadingDetail()).toBe(false);
    expect(component.selectedDetail()!.name).toBe('Alpha');
    http.expectNone('/api/concepts/c-alpha');
  });

  it('prefetches on hover so the click is already a cache hit', async () => {
    component.prefetch('c-gamma');
    http.expectOne('/api/concepts/c-gamma').flush(detail('c-gamma', 'Gamma'));
    await fixture.whenStable();

    component.selectConcept('c-gamma');
    expect(component.loadingDetail()).toBe(false);
    expect(component.selectedDetail()!.name).toBe('Gamma');
  });

  it('ignores a slow response for a concept the user has already left', async () => {
    component.selectConcept('c-alpha');
    const slow = http.expectOne('/api/concepts/c-alpha');
    component.selectConcept('c-beta');
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    await fixture.whenStable();

    // The abandoned Alpha response lands late and must not hijack the pane.
    slow.flush(detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    expect(component.selectedDetail()!.name).toBe('Beta');
  });

  it('renders no loading surface and no arrival animation on the pane', async () => {
    component.selectConcept('c-alpha');
    http.expectOne('/api/concepts/c-alpha').flush(detail('c-alpha', 'Alpha'));
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    // The covering wait-field and the `is-waiting` dim class were the visible
    // flash: both are gone from the template.
    expect(el.querySelector('.wait-field')).toBeNull();
    expect(el.querySelector('.is-waiting')).toBeNull();
    expect(el.querySelector('.note-card')).not.toBeNull();
    expect(el.querySelector('.index-tools')).not.toBeNull();
  });

  it('sorts the index by usage, A-Z and Z-A, and persists the choice', () => {
    const names = () => component.filteredConcepts().map((c) => c.name);

    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);

    component.setSort('az');
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(localStorage.getItem('nostos.brain.indexSort')).toBe('az');

    component.setSort('za');
    expect(names()).toEqual(['Gamma', 'Beta', 'Alpha']);

    component.setSort('usage');
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('filters by name and reports the filtered count', () => {
    component.searchQuery.set('bet');
    expect(component.filteredConcepts().map((c) => c.name)).toEqual(['Beta']);
    component.searchQuery.set('nothing-matches-this');
    expect(component.filteredConcepts().length).toBe(0);
  });

  it('shows the decorative stats line and ignores a failed stats request', async () => {
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    expect(el.querySelector('.index-stats')?.textContent).toContain('3 concepts · 15 references');

    const second = TestBed.createComponent(SecondBrain);
    second.detectChanges();
    http.expectOne('/api/concepts').flush(concepts);
    http.expectOne('/api/concepts/stats').error(new ProgressEvent('network-error'));
    await second.whenStable();
    expect(second.nativeElement.querySelector('.index-stats')).toBeNull();
  });

  it('normalizes diacritics and ranks exact, prefix and substring matches', () => {
    component.concepts.set([
      { id: 'exact', name: 'Théâtre', usageCount: 1 },
      { id: 'prefix-a', name: 'Theatre Alpha', usageCount: 1 },
      { id: 'prefix-b', name: 'Theatre Beta', usageCount: 1 },
      { id: 'substring', name: 'A Theatre', usageCount: 99 },
    ]);
    component.setSort('az');
    component.searchQuery.set('theatre');

    expect(component.filteredConcepts().map((concept) => concept.name)).toEqual([
      'Théâtre',
      'Theatre Alpha',
      'Theatre Beta',
      'A Theatre',
    ]);
  });

  it('highlights a diacritic-insensitive match without replacing the source name', () => {
    component.searchQuery.set('theatre');

    expect(component.highlightName('Théâtre')).toEqual([
      { text: 'Théâtre', highlight: true },
    ]);
  });

  it('clears search through the affordance and Escape', () => {
    component.setSearchQuery('bet');
    fixture.detectChanges();

    const clear = fixture.nativeElement.querySelector('.clear-search') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    clear.click();
    expect(component.searchQuery()).toBe('');

    component.setSearchQuery('alp');
    const input = fixture.nativeElement.querySelector('input[aria-label="Search concepts"]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.searchQuery()).toBe('');
  });

  it('moves the roving cursor with arrows and selects on Enter', async () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.index-item') as NodeListOf<HTMLElement>;
    const scrollSpy = vi.fn();
    rows[1].scrollIntoView = scrollSpy;

    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(component.cursorIndex()).toBe(1);
    expect(document.activeElement).toBe(rows[1]);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });

    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(component.selectedId()).toBe('c-beta');
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    http.expectOne('/api/concepts/c-alpha').flush(detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
  });

  it('moves from the search input into the first filtered row', () => {
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[aria-label="Search concepts"]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    const firstRow = fixture.nativeElement.querySelector('.index-item') as HTMLElement;
    expect(component.cursorIndex()).toBe(0);
    expect(document.activeElement).toBe(firstRow);
    http.expectOne('/api/concepts/c-alpha').flush(detail('c-alpha', 'Alpha'));
  });

  it('renders distinct empty states for an empty index and an empty search', () => {
    component.concepts.set([]);
    component.loadingConcepts.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty-index-state')?.textContent).toContain(
      '[[Concept Name]]'
    );
    expect(fixture.nativeElement.querySelector('a[routerLink="/library"]')).toBeTruthy();

    component.concepts.set(concepts);
    component.setSearchQuery('xyz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty-index-state')?.textContent).toContain(
      'No concepts match “xyz”'
    );
    expect(fixture.nativeElement.querySelector('.empty-clear')).toBeTruthy();
  });

  it('uses a structureless wait field while the first list request is pending', () => {
    const loadingFixture = TestBed.createComponent(SecondBrain);
    loadingFixture.detectChanges();

    expect(loadingFixture.nativeElement.querySelector('.wait-field')).toBeTruthy();
    expect(loadingFixture.nativeElement.querySelector('.index-item')).toBeNull();

    http.expectOne('/api/concepts').flush(concepts);
    http.expectOne('/api/concepts/stats').flush(stats);
  });

  it('shows letter separators for alphabetical order but not usage order', () => {
    component.concepts.set([
      { id: 'a', name: 'Aster', usageCount: 1 },
      { id: 'b', name: 'Birch', usageCount: 2 },
      { id: 'c', name: 'Cedar', usageCount: 3 },
    ]);

    component.setSort('az');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.letter-separator').length).toBe(3);

    component.setSort('usage');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.letter-separator').length).toBe(0);
  });

  it('reveals row actions and emits their concept id without selecting the row', () => {
    fixture.detectChanges();
    const rename = fixture.nativeElement.querySelector('.row-action:not(.danger)') as HTMLButtonElement;
    const remove = fixture.nativeElement.querySelector('.row-action.danger') as HTMLButtonElement;
    const renameSpy = vi.fn();
    const deleteSpy = vi.fn();
    component.renameRequested.subscribe(renameSpy);
    component.deleteRequested.subscribe(deleteSpy);

    rename.click();
    remove.click();

    expect(renameSpy).toHaveBeenCalledWith('c-alpha');
    expect(deleteSpy).toHaveBeenCalledWith('c-alpha');
    expect(component.selectedId()).toBeNull();
  });

  it('restores the persisted sort order on construction', () => {
    localStorage.setItem('nostos.brain.indexSort', 'za');
    const second = TestBed.createComponent(SecondBrain);
    expect(second.componentInstance.indexSort()).toBe('za');
    // Flush the second instance's own list request before it is discarded.
    http.expectOne('/api/concepts').flush(concepts);
    http.expectOne('/api/concepts/stats').flush(stats);
  });
});
