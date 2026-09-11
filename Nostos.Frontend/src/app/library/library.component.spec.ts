import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

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
    expect(component.pageTitle()).toBe('Library');
    expect(component.activeFilterChips()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.active-filters')).toBeNull();
  });

  it('reflects a status filter in the title and chips', () => {
    component.filters.toggleStatus('reading');
    fixture.detectChanges();

    expect(component.pageTitle()).toBe('In Progress');
    expect(component.activeFilterChips()).toEqual([{ key: 'status', label: 'In Progress' }]);
    expect(fixture.nativeElement.querySelector('.active-filters')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#library-title').textContent).toContain(
      'In Progress',
    );
  });

  it('combines format and collection in the title and chips', () => {
    component.collections.set([{ id: 'c1', name: 'Science Fiction', parentId: null }]);
    component.filters.toggleFormat('audiobook');
    component.filters.toggleCollection('c1');
    fixture.detectChanges();

    expect(component.pageTitle()).toBe('Audiobooks in Science Fiction');
    expect(component.activeFilterChips()).toEqual([
      { key: 'format', label: 'Audiobooks' },
      { key: 'collection', label: 'Science Fiction' },
    ]);
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

  it('opens DeleteBookModal when delete button is clicked and cancels', () => {
    const testBook = { id: 'b1', title: 'Test Book', type: 'ebook', progressPercent: 0 } as any;
    component.rawBooks.set([testBook]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.delete-modal-card')).toBeNull();

    component.openDeleteModal(testBook, new MouseEvent('click'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.delete-modal-card')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.delete-title').textContent).toContain('Test Book');

    component.cancelDelete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.delete-modal-card')).toBeNull();
  });

  it('deletes book when confirmed through DeleteBookModal', () => {
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
    expect(fixture.nativeElement.querySelector('.delete-modal-card')).toBeNull();
  });
});
