import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SecondBrain } from './second-brain.component';
import { ConceptDetailDto, ConceptDto, ConceptStatsDto } from '../core/services/concepts.service';
import { ToastService } from '../core/services/toast.service';

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

const detailWithNotes = (id: string, name: string): ConceptDetailDto => ({
  id,
  name,
  notes: [
    {
      noteId: `${id}-newest`,
      content: `Newest thought about [[${name}]]`,
      selectedText: undefined,
      cfiRange: 'epubcfi(/6/2)',
      bookId: 'b-ideas',
      bookTitle: 'Ideas in Motion',
      createdAt: '2026-09-10T12:00:00Z',
    },
    {
      noteId: `${id}-oldest`,
      content: `Oldest thought about [[${name}]]`,
      selectedText: 'An old passage',
      cfiRange: 'epubcfi(/6/4)',
      bookId: 'b-meditations',
      bookTitle: 'Meditations',
      createdAt: '2026-09-01T12:00:00Z',
    },
    {
      noteId: `${id}-middle`,
      content: `A middle thought about [[${name}]]`,
      selectedText: undefined,
      cfiRange: undefined,
      bookId: 'b-ideas',
      bookTitle: 'Ideas in Motion',
      createdAt: '2026-09-05T12:00:00Z',
    },
  ],
});

describe('SecondBrain', () => {
  let component: SecondBrain;
  let fixture: ComponentFixture<SecondBrain>;
  let http: HttpTestingController;

  const flushChildConceptLists = (): void => {
    for (const request of http.match('/api/concepts')) {
      if (!request.cancelled) request.flush(concepts);
    }
  };

  const flushRelated = (id: string, related: object[] = []): void => {
    http.expectOne(`/api/concepts/${id}/related`).flush(related);
    fixture.detectChanges();
    flushChildConceptLists();
  };

  const flushDetail = (id: string, value: ConceptDetailDto, related: object[] = []): void => {
    http.expectOne(`/api/concepts/${id}`).flush(value);
    flushRelated(id, related);
  };

  const flushMutationRefresh = (
    refreshedConcepts: ConceptDto[] = concepts,
    refreshedStats: ConceptStatsDto = stats
  ): void => {
    http.expectOne('/api/concepts').flush(refreshedConcepts);
    http.expectOne('/api/concepts/stats').flush(refreshedStats);
  };

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
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    expect(component.loadingDetail()).toBe(false);

    // Second visit to the same concept: served from the detail cache, so the
    // pane must never enter — let alone render — a waiting state. No request,
    // and `loadingDetail` never true.
    component.selectConcept('c-beta');
    flushDetail('c-beta', detail('c-beta', 'Beta'));
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
    flushRelated('c-gamma');
    expect(component.loadingDetail()).toBe(false);
    expect(component.selectedDetail()!.name).toBe('Gamma');
  });

  it('ignores a slow response for a concept the user has already left', async () => {
    component.selectConcept('c-alpha');
    const slow = http.expectOne('/api/concepts/c-alpha');
    flushRelated('c-alpha');
    component.selectConcept('c-beta');
    flushDetail('c-beta', detail('c-beta', 'Beta'));
    await fixture.whenStable();

    // The abandoned Alpha response lands late and must not hijack the pane.
    slow.flush(detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    expect(component.selectedDetail()!.name).toBe('Beta');
  });

  it('renders no loading surface and no arrival animation on the pane', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    // The covering wait-field and the `is-waiting` dim class were the visible
    // flash: both are gone from the template.
    expect(el.querySelector('.wait-field')).toBeNull();
    expect(el.querySelector('.is-waiting')).toBeNull();
    expect(el.querySelector('.note-card')).not.toBeNull();
    expect(el.querySelector('.index-tools')).not.toBeNull();
  });

  it('filters notes by source and keeps the live count in sync', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detailWithNotes('c-alpha', 'Alpha'));
    await fixture.whenStable();
    fixture.detectChanges();

    const source = fixture.nativeElement.querySelector('#source-filter') as HTMLSelectElement;
    expect(source.textContent).toContain('Ideas in Motion (2)');
    expect(source.textContent).toContain('Meditations (1)');
    expect(component.filteredNotes()).toHaveLength(3);

    component.setSourceFilter('Meditations');
    fixture.detectChanges();
    expect(component.filteredNotes().map((note) => note.noteId)).toEqual(['c-alpha-oldest']);
    expect(fixture.nativeElement.querySelector('.note-count')?.textContent).toContain(
      'Showing 1 of 3 notes'
    );
  });

  it('sorts notes by newest, oldest and source order', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detailWithNotes('c-alpha', 'Alpha'));
    await fixture.whenStable();

    const ids = () => component.filteredNotes().map((note) => note.noteId);
    expect(ids()).toEqual(['c-alpha-newest', 'c-alpha-middle', 'c-alpha-oldest']);

    component.setNoteSort('oldest');
    expect(ids()).toEqual(['c-alpha-oldest', 'c-alpha-middle', 'c-alpha-newest']);

    component.setNoteSort('source');
    expect(ids()).toEqual(['c-alpha-middle', 'c-alpha-newest', 'c-alpha-oldest']);
  });

  it('renders related concepts and selects one in place', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'), [
      { id: 'c-beta', name: 'Beta', sharedNotes: 4 },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.related-chip')?.textContent).toContain('Beta');
    (fixture.nativeElement.querySelector('.related-chip') as HTMLButtonElement).click();
    expect(component.selectedId()).toBe('c-beta');

    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    http.expectOne('/api/concepts/c-beta/related').flush([]);
    fixture.detectChanges();
    flushChildConceptLists();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.concept-title')?.textContent).toContain('Beta');
  });

  it('optimistically edits a note and keeps the updated detail cached', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.note-actions .icon-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    const editor = fixture.nativeElement.querySelector('.note-input') as HTMLTextAreaElement;
    editor.value = 'Updated note about [[Alpha]]';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    (fixture.nativeElement.querySelector('.edit-actions .icon-btn') as HTMLButtonElement).click();

    expect(component.selectedDetail()!.notes[0].content).toBe('Updated note about [[Alpha]]');
    const update = http.expectOne('/api/notes/c-alpha-n1');
    expect(update.request.method).toBe('PUT');
    update.flush({
      id: 'c-alpha-n1',
      bookId: 'b1',
      content: 'Updated note about [[Alpha]]',
      selectedText: undefined,
      cfiRange: undefined,
      createdAt: '2026-09-12T12:00:00Z',
      bookTitle: 'Meditations',
    });
    await fixture.whenStable();

    component.selectConcept('c-beta');
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    flushRelated('c-beta');
    await fixture.whenStable();
    component.selectConcept('c-alpha');
    expect(component.selectedDetail()!.notes[0].content).toBe('Updated note about [[Alpha]]');
    http.expectNone('/api/concepts/c-alpha');
  });

  it('restores an optimistic note edit when saving fails', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();

    component.onUpdateNote({ id: 'c-alpha-n1', content: 'Unsaved change', selectedText: '' });
    expect(component.selectedDetail()!.notes[0].content).toBe('Unsaved change');
    http.expectOne('/api/notes/c-alpha-n1').error(new ProgressEvent('network-error'));
    await fixture.whenStable();

    expect(component.selectedDetail()!.notes[0].content).toBe('A note about [[Alpha]]');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('changes reverted');
  });

  it('confirms deletion before removing the note card', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    fixture.detectChanges();

    component.onDeleteNote('c-alpha-n1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.note-card')).toHaveLength(1);
    expect(http.match('/api/notes/c-alpha-n1')).toHaveLength(0);

    (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.note-card')).toHaveLength(0);
    const removal = http.expectOne('/api/notes/c-alpha-n1');
    expect(removal.request.method).toBe('DELETE');
    removal.flush(null);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeNull();
  });

  it('selects a concept tag rendered inside a note card', async () => {
    component.selectConcept('c-alpha');
    flushDetail(
      'c-alpha',
      {
        ...detail('c-alpha', 'Alpha'),
        notes: [{ ...detail('c-alpha', 'Alpha').notes[0], content: 'See [[Beta]] here' }],
      },
      []
    );
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.concept-tag') as HTMLElement).click();
    expect(component.selectedId()).toBe('c-beta');
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    http.expectOne('/api/concepts/c-beta/related').flush([]);
    fixture.detectChanges();
    flushChildConceptLists();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.concept-title')?.textContent).toContain('Beta');
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
    flushRelated('c-beta');
    http.expectOne('/api/concepts/c-alpha').flush(detail('c-alpha', 'Alpha'));
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    fixture.detectChanges();
    flushChildConceptLists();
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

  it('renames inline, sends the concept body, updates the pane, and refreshes stats', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();

    component.startRename('c-alpha', 'header');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.header-rename .inline-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Alpha');

    component.renameValue.set('Nietzsche');
    component.commitRename('c-alpha');
    const rename = http.expectOne('/api/concepts/c-alpha');
    expect(rename.request.method).toBe('PUT');
    expect(rename.request.body).toEqual({ concept: 'Nietzsche' });
    rename.flush({ id: 'c-alpha', name: 'Nietzsche', usageCount: 9 });

    http.expectOne('/api/concepts/c-alpha/related').flush([]);
    flushMutationRefresh([
      { id: 'c-alpha', name: 'Nietzsche', usageCount: 9 },
      concepts[1],
      concepts[2],
    ]);
    await fixture.whenStable();

    expect(component.renameId()).toBeNull();
    expect(component.concepts().find((concept) => concept.id === 'c-alpha')?.name).toBe('Nietzsche');
    expect(component.selectedDetail()?.name).toBe('Nietzsche');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe('Renamed to Nietzsche');
  });

  it('rejects an empty inline rename without a request and shows a quiet message', () => {
    component.startRename('c-alpha');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.inline-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Alpha');

    component.renameValue.set('   ');
    component.commitRename('c-alpha');
    fixture.detectChanges();

    expect(component.renameError()).toBe('A concept name is required.');
    expect(http.match('/api/concepts/c-alpha')).toHaveLength(0);
    expect(component.concepts().find((concept) => concept.id === 'c-alpha')?.name).toBe('Alpha');
  });

  it('rolls back a failed rename and reports the failure', async () => {
    component.startRename('c-alpha');
    component.renameValue.set('Unavailable');
    component.commitRename('c-alpha');
    http.expectOne('/api/concepts/c-alpha').error(new ProgressEvent('network-error'));
    await fixture.whenStable();

    expect(component.renameId()).toBeNull();
    expect(component.concepts().find((concept) => concept.id === 'c-alpha')?.name).toBe('Alpha');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('changes were not saved');
  });

  it('treats rename onto an existing name as a merge and refreshes the row count', () => {
    component.startRename('c-alpha');
    component.renameValue.set('Beta');
    component.commitRename('c-alpha');

    const rename = http.expectOne('/api/concepts/c-alpha');
    expect(rename.request.method).toBe('PUT');
    expect(rename.request.body).toEqual({ concept: 'Beta' });
    rename.flush({ id: 'c-beta', name: 'Beta', usageCount: 4 });
    flushMutationRefresh(
      [
        { id: 'c-beta', name: 'Beta', usageCount: 4 },
        concepts[2],
      ],
      { ...stats, totalConcepts: 2, totalReferences: 12 }
    );

    expect(component.concepts().map((concept) => concept.id)).toEqual(['c-beta', 'c-gamma']);
    expect(component.concepts()).toHaveLength(2);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe('Merged into Beta');
  });

  it('searches merge targets, confirms the consequence, and selects the survivor', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();

    component.openMergePicker();
    component.mergeSearchQuery.set('bet');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.merge-target')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.merge-target')?.textContent).toContain('Beta');

    component.chooseMergeTarget('c-beta');
    component.openMergeConfirmation();
    fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('.confirm-modal-card') as HTMLElement;
    expect(modal.textContent).toContain('move 1 note');
    expect(modal.textContent).toContain('source concept “Alpha” will disappear');

    (modal.querySelector('.btn-confirm') as HTMLButtonElement).click();
    const merge = http.expectOne('/api/concepts/c-alpha/merge');
    expect(merge.request.method).toBe('POST');
    expect(merge.request.body).toEqual({ targetId: 'c-beta' });
    expect(component.mergingConcept()).toBe(true);

    merge.flush({ id: 'c-beta', name: 'Beta', usageCount: 4 });
    http.expectOne('/api/concepts/c-beta/related').flush([]);
    http.expectOne('/api/concepts/c-beta').flush(detail('c-beta', 'Beta'));
    flushMutationRefresh(
      [concepts[1], concepts[2]],
      { ...stats, totalConcepts: 2, totalReferences: 14 }
    );
    await fixture.whenStable();

    expect(component.mergingConcept()).toBe(false);
    expect(component.selectedId()).toBe('c-beta');
    expect(component.concepts().map((concept) => concept.id)).toEqual(['c-beta', 'c-gamma']);
    expect(component.selectedDetail()?.name).toBe('Beta');
    expect(component.conceptStats()?.totalConcepts).toBe(2);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('Merged Alpha into Beta');
  });

  it('rolls back a failed merge and keeps both concepts', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();
    component.openMergePicker();
    component.chooseMergeTarget('c-beta');
    component.openMergeConfirmation();
    component.confirmMerge();

    http.expectOne('/api/concepts/c-alpha/merge').error(new ProgressEvent('network-error'));
    await fixture.whenStable();
    expect(component.mergingConcept()).toBe(false);
    expect(component.concepts().map((concept) => concept.id)).toEqual(['c-alpha', 'c-beta', 'c-gamma']);
    expect(component.selectedId()).toBe('c-alpha');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('changes were not saved');
  });

  it('confirms concept deletion with honest reference wording and refreshes the stats line', async () => {
    component.selectConcept('c-alpha');
    flushDetail('c-alpha', detail('c-alpha', 'Alpha'));
    await fixture.whenStable();

    component.openDeleteConcept('c-alpha');
    fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('.confirm-modal-card') as HTMLElement;
    expect(modal.textContent).toContain('does not edit note text');
    expect(modal.textContent).toContain('[[Alpha]] reference stays in notes');
    expect(modal.textContent).toContain('saving a note again will re-create the concept');

    (modal.querySelector('.btn-confirm') as HTMLButtonElement).click();
    const deletion = http.expectOne('/api/concepts/c-alpha');
    expect(deletion.request.method).toBe('DELETE');
    expect(component.deletingConcept()).toBe(true);
    deletion.flush(null);
    flushMutationRefresh(
      [concepts[1], concepts[2]],
      { ...stats, totalConcepts: 2, totalReferences: 6 }
    );
    await fixture.whenStable();

    expect(component.deletingConcept()).toBe(false);
    expect(component.selectedId()).toBeNull();
    expect(component.selectedDetail()).toBeNull();
    expect(component.concepts().map((concept) => concept.id)).toEqual(['c-beta', 'c-gamma']);
    expect(component.conceptStats()?.totalConcepts).toBe(2);
    expect(fixture.nativeElement.querySelector('.concept-title')).toBeNull();
  });

  it('rolls back a failed concept deletion and leaves its row intact', async () => {
    component.openDeleteConcept('c-alpha');
    component.confirmDeleteConcept();
    http.expectOne('/api/concepts/c-alpha').error(new ProgressEvent('network-error'));
    await fixture.whenStable();

    expect(component.deletingConcept()).toBe(false);
    expect(component.conceptDeleteTarget()).toBeNull();
    expect(component.concepts().some((concept) => concept.id === 'c-alpha')).toBe(true);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('still in your index');
  });

  it('restores the persisted sort order on construction', () => {
    localStorage.setItem('nostos.brain.indexSort', 'za');
    const second = TestBed.createComponent(SecondBrain);
    expect(second.componentInstance.indexSort()).toBe('za');
    // Flush the second instance's own list request before it is discarded.
    http.expectOne('/api/concepts').flush(concepts);
    http.expectOne('/api/concepts/stats').flush(stats);
  });

  it('toggles between list and map views and persists the choice', () => {
    const map = fixture.nativeElement.querySelector('.view-mode-control .toggle-opt:last-child') as HTMLButtonElement;
    map.click();
    fixture.detectChanges();

    expect(component.viewMode()).toBe('map');
    expect(localStorage.getItem('nostos.brain.viewMode')).toBe('map');
    expect(fixture.nativeElement.querySelector('app-concept-map')).toBeTruthy();
    flushChildConceptLists();
    http.match((request) => request.url.endsWith('/related')).forEach((request) => request.flush([]));

    const list = fixture.nativeElement.querySelector('.view-mode-control .toggle-opt:first-child') as HTMLButtonElement;
    list.click();
    fixture.detectChanges();
    expect(component.viewMode()).toBe('list');
    expect(localStorage.getItem('nostos.brain.viewMode')).toBe('list');
    expect(fixture.nativeElement.querySelector('app-concept-map')).toBeNull();
  });
});
