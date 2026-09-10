import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
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
  let router: Router;
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

    router = TestBed.inject(Router);
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

  it('one collection change triggers exactly one books request with collectionId', async () => {
    listSpy.mockClear();

    await router.navigate(['/library'], { queryParams: { collection: 'c1' } });
    fixture.detectChanges();
    await fixture.whenStable();

    const collectionCalls = listSpy.mock.calls.filter(
      (args: unknown[]) => (args[0] as { collectionId?: string }).collectionId !== undefined,
    );
    expect(collectionCalls).toHaveLength(1);
    expect((collectionCalls[0][0] as { collectionId: string }).collectionId).toBe('c1');
  });

  it('restores grid filtering from the collection query param', async () => {
    await router.navigate(['/library'], { queryParams: { collection: 'c1' } });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.urlSelection().collection).toBe('c1');
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: 'c1' }),
    );
  });

  it('clearing selection removes the query param and reloads all books', async () => {
    await router.navigate(['/library'], { queryParams: { collection: 'c1' } });
    fixture.detectChanges();
    await fixture.whenStable();
    listSpy.mockClear();

    await router.navigate(['/library'], {
      queryParams: { collection: null },
      queryParamsHandling: 'merge',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.url).not.toContain('collection=');
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

  it('restores the filter from the initial URL and requests filtered books', async () => {
    await router.navigate(['/library'], { queryParams: { filter: 'notstarted' } });
    listSpy.mockClear();

    fixture.destroy();
    fixture = TestBed.createComponent(Library);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.urlSelection().filter).toBe('notstarted');
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'notstarted' }));
  });

  it('URL changes (history-driven) update the active filter request', async () => {
    listSpy.mockClear();

    await router.navigate(['/library'], { queryParams: { filter: 'reading' } });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.urlSelection().filter).toBe('reading');
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
});
