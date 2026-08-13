import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

import { Library } from './library.component';
import { BooksService } from '../core/services/books.service';
import { CollectionsService } from '../core/services/collections.service';
import { PaginatedResponse } from '../core/dtos/book.dtos';

@Component({ template: '' })
class DummyComponent {}

describe('Library', () => {
  let component: Library;
  let fixture: ComponentFixture<Library>;
  let router: Router;
  let listSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listSpy = vi.fn(() => of({ items: [], totalCount: 0 } as PaginatedResponse<never>));

    await TestBed.configureTestingModule({
      imports: [Library],
      providers: [
        provideRouter([{ path: 'library', component: DummyComponent }]),
        {
          provide: BooksService,
          useValue: {
            list: listSpy,
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

  it('filter dropdown renders all options', () => {
    const trigger = fixture.nativeElement.querySelector('.filter-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.filter-option'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(labels).toEqual([
      'All Books',
      'Not Started',
      'In Progress',
      'Finished',
      'Favorites',
      'Unsorted',
    ]);
  });

  it('selecting a filter navigates with merge and triggers exactly one books request', async () => {
    await router.navigate(['/library'], { queryParams: { collection: 'c1' } });
    fixture.detectChanges();
    await fixture.whenStable();
    listSpy.mockClear();

    const trigger = fixture.nativeElement.querySelector('.filter-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const options = Array.from(fixture.nativeElement.querySelectorAll('.filter-option'));
    const notStarted = options.find(
      (el) => (el as HTMLElement).textContent?.trim() === 'Not Started',
    ) as HTMLButtonElement;
    notStarted.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.url).toContain('collection=c1');
    expect(router.url).toContain('filter=notstarted');
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0][0].filter).toBe('notstarted');
    expect(listSpy.mock.calls[0][0].collectionId).toBe('c1');
  });

  it('dropdown active state reflects the route filter param (In Progress = Reading)', async () => {
    await router.navigate(['/library'], { queryParams: { filter: 'reading' } });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.activeFilter()).toBe('reading');
    expect(component.activeFilterLabel()).toBe('In Progress');

    const trigger = fixture.nativeElement.querySelector('.filter-trigger') as HTMLButtonElement;
    expect(trigger.textContent).toContain('In Progress');

    trigger.click();
    fixture.detectChanges();

    const activeOption = fixture.nativeElement.querySelector(
      '.filter-option.active',
    ) as HTMLElement;
    expect(activeOption.textContent).toContain('In Progress');
  });
});
