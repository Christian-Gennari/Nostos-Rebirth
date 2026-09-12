import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';

import { Library } from './library.component';
import { BooksService } from '../core/services/books.service';
import { CollectionsService } from '../core/services/collections.service';
import { PaginatedResponse } from '../core/dtos/book.dtos';
import { BookSort } from '../core/dtos/book.enums';
import {
  LIBRARY_PREFERENCES_STORAGE_KEY,
  LibraryPreferencesService,
} from '../core/services/library-preferences.service';

@Component({ template: '' })
class DummyComponent {}

describe('Library', () => {
  let component: Library;
  let fixture: ComponentFixture<Library>;
  let listSpy: ReturnType<typeof vi.fn>;

  /** Wall-clock budget a spec must advance to let a deferred swap commit. */
  const SWAP_BUDGET = 400;

  beforeEach(async () => {
    localStorage.clear();
    listSpy = vi.fn(() => of({ items: [], totalCount: 0 } as PaginatedResponse<never>));

    await TestBed.configureTestingModule({
      imports: [Library],
      providers: [
        provideRouter([{ path: 'library', component: DummyComponent }]),
        {
          provide: BooksService,
          useValue: {
            list: listSpy,
            getStatusCounts: vi.fn(() =>
              of({ all: 0, notStarted: 0, reading: 0, favorites: 0, finished: 0, unsorted: 0 }),
            ),
            update: vi.fn(() => of({})),
            delete: vi.fn(() => of(null)),
          } as unknown as BooksService,
        },
        {
          provide: CollectionsService,
          useValue: {
            sidebarExpanded: signal(true),
            list: vi.fn(() => of([])),
            getCounts: vi.fn(() => of([])),
            create: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            delete: vi.fn(() => of(null)),
          } as unknown as CollectionsService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Library);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads books exactly once on init (no duplicate collection load)', () => {
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0][0].collectionId).toBeUndefined();
  });

  it('one collection change triggers exactly one books request with collectionId', () => {
    listSpy.mockClear();

    component.filters.toggleCollection('c1');
    TestBed.flushEffects();

    const collectionCalls = listSpy.mock.calls.filter(
      (args: unknown[]) => (args[0] as { collectionId?: string }).collectionId !== undefined,
    );
    expect(collectionCalls).toHaveLength(1);
    expect((collectionCalls[0][0] as { collectionId: string }).collectionId).toBe('c1');
  });

  it('requests books for the selected collection', () => {
    listSpy.mockClear();

    component.filters.toggleCollection('c1');
    TestBed.flushEffects();

    expect(component.filters.collectionId()).toBe('c1');
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ collectionId: 'c1' }));
  });

  it('toggling the collection off reloads all books', () => {
    component.filters.toggleCollection('c1');
    TestBed.flushEffects();
    listSpy.mockClear();

    component.filters.toggleCollection('c1');
    TestBed.flushEffects();

    expect(component.filters.collectionId()).toBeNull();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0][0].collectionId).toBeUndefined();
  });

  it('renders no toolbar progress-filter dropdown (trigger/menu/options removed)', () => {
    expect(fixture.nativeElement.querySelector('.filter-dropdown')).toBeNull();
    expect(fixture.nativeElement.querySelector('.filter-trigger')).toBeNull();
    expect(fixture.nativeElement.querySelector('.filter-menu')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.filter-option').length).toBe(0);

    const filterButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.toolbar button') as NodeListOf<HTMLButtonElement>,
    ).filter((el) => el.getAttribute('title')?.includes('Filter books') ?? false,
    );
    expect(filterButtons).toHaveLength(0);
  });

  it('does not render a "Reading" label anywhere in the library UI', () => {
    expect(fixture.nativeElement.textContent).not.toContain('Reading');
    const readingTooltips = Array.from(
      fixture.nativeElement.querySelectorAll('[title]') as NodeListOf<HTMLElement>,
    ).filter((el) => el.getAttribute('title')?.includes('Reading') ?? false);
    expect(readingTooltips).toHaveLength(0);
  });

  it('filter changes trigger exactly one books request', () => {
    listSpy.mockClear();

    component.filters.toggleStatus('reading');
    TestBed.flushEffects();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'reading' }));
  });

  it('hydrates a stored valid viewMode from localStorage', () => {
    const preferences = TestBed.inject(LibraryPreferencesService);
    preferences.setViewMode('list');

    expect(component.viewMode()).toBe('list');
  });

  it('ignores an invalid stored viewMode and falls back to the default', () => {
    const preferences = TestBed.inject(LibraryPreferencesService);
    preferences.setViewMode('grid');

    expect(component.viewMode()).toBe('grid');
  });

  it('persists the viewMode preference to localStorage when toggled', () => {
    const toggles = Array.from(
      fixture.nativeElement.querySelectorAll('.toggle-opt'),
    ) as HTMLButtonElement[];

    toggles[0].click();
    fixture.detectChanges();
    expect(component.viewMode()).toBe('list');
    expect(JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_STORAGE_KEY)!).viewMode).toBe('list');

    toggles[1].click();
    fixture.detectChanges();
    expect(component.viewMode()).toBe('grid');
    expect(JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_STORAGE_KEY)!).viewMode).toBe('grid');
  });

  it('updates the active sort and persists it through the preferences service', () => {
    const preferences = TestBed.inject(LibraryPreferencesService);

    component.setSort(BookSort.Title);

    expect(component.activeSort()).toBe(BookSort.Title);
    expect(preferences.sort()).toBe(BookSort.Title);
  });

  it('initializes the sort from preferences (not the URL)', () => {
    expect(component.activeSort()).toBe(TestBed.inject(LibraryPreferencesService).sort());
  });

  it('shows an empty state with a creation action when the library is empty', () => {
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.container.lg .books-empty-state') as HTMLElement;
    expect(empty.textContent).toContain('Your library is empty');
    empty.querySelector('button')!.click();

    expect(component.showAddModal()).toBe(true);
  });

  it('offers to clear the search when nothing matches', () => {
    component.searchQuery.set('zzz');
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.container.lg .books-empty-state') as HTMLElement;
    expect(empty.textContent).toContain('No books match "zzz"');
  });

  it('shows "Library" with no chips when no filter is active', () => {
    expect(component.activeFilterChips()).toEqual([]);
    // The chip row stays mounted so its height can animate on the first chip;
    // with no chips it is collapsed and renders nothing to announce.
    expect(fixture.nativeElement.querySelector('.filter-bar.is-empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.filter-chip').length).toBe(0);
  });

  it('reflects a status filter in chips', () => {
    component.filters.toggleStatus('reading');
    fixture.detectChanges();

    expect(component.activeFilterChips()).toEqual([{ key: 'status', label: 'In Progress' }]);
    expect(fixture.nativeElement.querySelector('.active-filters')).not.toBeNull();
  });

  it('combines format and collection in chips', () => {
    component.collections.set([{ id: 'c1', name: 'Science Fiction', parentId: null }]);
    component.filters.toggleFormat('audiobook');
    component.filters.toggleCollection('c1');
    fixture.detectChanges();

    expect(component.activeFilterChips()).toEqual([
      { key: 'format', label: 'Audiobooks' },
      { key: 'collection', label: 'Science Fiction' },
    ]);
  });

  it('keeps a static Library heading when filters and search change', () => {
    fixture.detectChanges();
    const title = fixture.nativeElement.querySelector('#library-title') as HTMLElement;

    expect(title.textContent?.trim()).toBe('Library');
    expect(title.classList.contains('library-title')).toBe(true);

    component.collections.set([{ id: 'c1', name: 'Science Fiction', parentId: null }]);
    component.filters.toggleStatus('reading');
    component.filters.toggleFormat('audiobook');
    component.filters.toggleCollection('c1');
    component.searchQuery.set('zzz');
    fixture.detectChanges();

    expect(title.textContent?.trim()).toBe('Library');
    expect(fixture.nativeElement.querySelectorAll('.title-swap').length).toBe(0);
  });

  it('clearing a chip resets just that filter and reloads', () => {
    component.filters.toggleStatus('finished');
    component.filters.toggleFormat('ebook');
    TestBed.flushEffects();
    expect(component.activeFilterChips().length).toBe(2);
    listSpy.mockClear();

    component.clearChip('status');
    TestBed.flushEffects();

    expect(component.filters.status()).toBe('all');
    expect(component.filters.format()).toBe('ebook');
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ filter: undefined, format: 'ebook' }),
    );
  });

  it('opens the confirm dialog when the delete button is clicked, and cancels', () => {
    const testBook = { id: 'b1', title: 'Test Book', type: 'ebook', progressPercent: 0 } as any;
    component.rawBooks.set([testBook]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeNull();

    component.openDeleteModal(testBook, new MouseEvent('click'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.confirm-title').textContent).toContain('Test Book');

    component.cancelDelete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeNull();
  });

  it('deletes book when confirmed through the confirm dialog', () => {
    const testBook = { id: 'b1', title: 'Test Book', type: 'ebook', progressPercent: 0 } as any;
    component.rawBooks.set([testBook]);
    fixture.detectChanges();

    component.openDeleteModal(testBook, new MouseEvent('click'));
    fixture.detectChanges();

    const booksService = TestBed.inject(BooksService);
    const deleteSpy = vi.spyOn(booksService, 'delete').mockReturnValue(of(null as any));

    component.confirmDelete();
    fixture.detectChanges();

    expect(deleteSpy).toHaveBeenCalledWith('b1');
    expect(component.rawBooks().length).toBe(0);
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeNull();
  });

  // --- Filter/sort cross-fade (no waiting placeholder, no layout jitter) --

  it('never puts the waiting field back up after the first load', () => {
    expect(component.loading()).toBe(false);

    const onScreen = { id: 'b1', title: 'On Screen', type: 'ebook' } as never;
    component.rawBooks.set([onScreen]);
    component.filters.toggleStatus('reading');
    fixture.detectChanges();

    // The results region belongs to the first paint only; a filter change
    // cross-fades the results that are already on screen.
    expect(component.loading()).toBe(false);
    expect(component.swapping()).toBe(true);
    expect(fixture.nativeElement.querySelector('.results-stage.is-swapping')).not.toBeNull();
  });

  it('holds the current results on screen until the out-phase ends, then swaps', () => {
    vi.useFakeTimers();
    try {
      const oldBook = { id: 'old', title: 'Old', type: 'ebook' } as never;
      const newBook = { id: 'new', title: 'New', type: 'ebook' } as never;
      // There must be results on screen for the out-phase to be worth holding.
      component.rawBooks.set([oldBook]);

      listSpy.mockReturnValueOnce(of({ items: [newBook], totalCount: 1 } as never));

      component.filters.toggleStatus('reading');
      TestBed.flushEffects();

      expect(component.loading()).toBe(false);
      expect(component.swapping()).toBe(true);
      expect(component.rawBooks()).toEqual([oldBook]);

      vi.advanceTimersByTime(SWAP_BUDGET);
      expect(component.rawBooks()).toEqual([newBook]);
      expect(component.swapping()).toBe(false);

      const thirdBook = { id: 'third', title: 'Third', type: 'ebook' } as never;
      listSpy.mockReturnValueOnce(of({ items: [thirdBook], totalCount: 1 } as never));

      component.filters.toggleStatus('finished');
      TestBed.flushEffects();

      // Still the old page at this instant: the DOM swaps at the bottom of the blur.
      expect(component.rawBooks()).toEqual([newBook]);

      vi.advanceTimersByTime(SWAP_BUDGET);
      expect(component.rawBooks()).toEqual([thirdBook]);
      expect(component.swapping()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits at once when there is nothing on screen to blur out', () => {
    const book = { id: 'b1', title: 'Only', type: 'ebook' } as never;
    listSpy.mockReturnValueOnce(of({ items: [book], totalCount: 1 } as never));

    component.filters.toggleStatus('reading');
    TestBed.flushEffects();

    // No empty stage holding for 200ms: the results (and their fade-in) start now.
    expect(component.rawBooks()).toEqual([book]);
    expect(component.swapping()).toBe(false);
  });

  it('leaves the results region empty through a cold load, then resolves in', () => {
    vi.useFakeTimers();
    try {
      const preferences = TestBed.inject(LibraryPreferencesService);
      const book = { id: 'b1', title: 'First', type: 'ebook' } as never;
      // A genuine cold start: nothing has been shown in this session, so the
      // results region is held open and empty while the first page is in flight.
      preferences.hasLoadedBooks.set(false);
      const pending = new Subject<PaginatedResponse<never>>();
      listSpy.mockReturnValueOnce(pending);

      component.filters.toggleStatus('reading');
      TestBed.flushEffects();
      fixture.detectChanges();
      expect(component.loading()).toBe(true); // the region is reserved
      expect(fixture.nativeElement.querySelector('.results-stage.is-waiting')).not.toBeNull();
      // Nothing is drawn in the content's place — no placeholder to jitter.
      expect(fixture.nativeElement.querySelector('.book-grid')).toBeNull();
      expect(fixture.nativeElement.querySelector('.table-view')).toBeNull();

      // The page lands after the region has been open a while.
      vi.advanceTimersByTime(300);
      pending.next({ items: [book], totalCount: 1 } as never);
      pending.complete();

      // A cold load has no out-phase to wait for: the results commit at once and
      // fade in over the space that was already reserved for them.
      fixture.detectChanges();
      expect(component.loading()).toBe(false);
      expect(component.swapping()).toBe(false);
      expect(component.rawBooks()).toEqual([book]);
      expect(fixture.nativeElement.querySelector('.results-stage.is-waiting')).toBeNull();
      expect(fixture.nativeElement.querySelector('.book-grid')).not.toBeNull();
      expect(preferences.hasLoadedBooks()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a stale response that arrives after a newer filter change', () => {
    vi.useFakeTimers();
    try {
      const pending: Subject<PaginatedResponse<never>>[] = [];
      listSpy.mockImplementation(() => {
        const subject = new Subject<PaginatedResponse<never>>();
        pending.push(subject);
        return subject;
      });

      component.filters.toggleStatus('reading');
      TestBed.flushEffects();
      component.filters.toggleStatus('finished');
      TestBed.flushEffects();
      expect(pending).toHaveLength(2);

      const newer = { id: 'newer', title: 'Newer', type: 'ebook' } as never;
      const stale = { id: 'stale', title: 'Stale', type: 'ebook' } as never;
      pending[1].next({ items: [newer], totalCount: 1 } as never);
      pending[1].complete();
      vi.advanceTimersByTime(SWAP_BUDGET);
      expect(component.rawBooks()).toEqual([newer]);

      // The abandoned request answers late: it must not repaint the list.
      pending[0].next({ items: [stale], totalCount: 1 } as never);
      pending[0].complete();
      vi.advanceTimersByTime(SWAP_BUDGET);
      expect(component.rawBooks()).toEqual([newer]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reserves the page scrollbar gutter only while the library is mounted', () => {
    expect(document.body.classList.contains('nostos-library')).toBe(true);

    fixture.destroy();

    expect(document.body.classList.contains('nostos-library')).toBe(false);
  });

  it('reflects sidebarExpanded on layout-wrapper directly without depending on child initialization', () => {
    const preferences = TestBed.inject(LibraryPreferencesService);
    preferences.setSidebarExpanded(false);
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.querySelector('.layout-wrapper') as HTMLElement;
    expect(wrapper.classList.contains('sidebar-collapsed')).toBe(true);

    component.toggleSidebar();
    fixture.detectChanges();
    expect(preferences.sidebarExpanded()).toBe(true);
    expect(wrapper.classList.contains('sidebar-collapsed')).toBe(false);
  });

  it('cross-fades rather than waiting again when re-entering the library', () => {
    // First visit: the waiting field is legitimate and the results are now known.
    expect(component.loading()).toBe(false);
    expect(TestBed.inject(LibraryPreferencesService).hasLoadedBooks()).toBe(true);

    // Leaving for the Studio / Second Brain destroys this component; coming back
    // rebuilds it with no results in hand.
    fixture.destroy();
    const second = TestBed.createComponent(Library);
    const secondComponent = second.componentInstance;
    TestBed.flushEffects();
    second.detectChanges();

    expect(secondComponent.loading()).toBe(false);
    expect(second.nativeElement.querySelector('.results-stage')).not.toBeNull();

    second.destroy();
  });
});
