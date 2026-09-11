import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { SidebarCollections } from './sidebar-collections.component';
import { CollectionsService } from '../../core/services/collections.service';
import { LibraryPreferencesService } from '../../core/services/library-preferences.service';
import { ToastService } from '../../core/services/toast.service';
import { Collection } from '../../core/dtos/collection.dtos';

describe('SidebarCollections', () => {
  let component: SidebarCollections;
  let fixture: ComponentFixture<SidebarCollections>;
  let collectionsService: {
    sidebarExpanded: ReturnType<typeof signal<boolean>>;
    list: ReturnType<typeof vi.fn>;
    getCounts: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };

  const sampleCollections: Collection[] = [{ id: 'c1', name: 'Philosophy', parentId: null }];
  const rootCollection: Collection = { id: 'root-1', name: 'Root', parentId: null };
  const nestedCollection: Collection = { id: 'nested-1', name: 'Nested', parentId: 'root-1' };

  beforeEach(async () => {
    localStorage.clear();
    collectionsService = {
      sidebarExpanded: signal(true),
      list: vi.fn(() => of(sampleCollections)),
      getCounts: vi.fn(() => of([{ collectionId: 'c1', bookCount: 5 }])),
      create: vi.fn(() => of({ id: 'c2', name: 'New', parentId: null })),
      update: vi.fn(() => of({ id: 'c1', name: 'Philosophy', parentId: null })),
      delete: vi.fn(() => of(null)),
    };
    toast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SidebarCollections],
      providers: [
        { provide: CollectionsService, useValue: collectionsService },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    const prefs = TestBed.inject(LibraryPreferencesService);
    prefs.setSidebarExpanded(true);
    fixture = TestBed.createComponent(SidebarCollections);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not own selection state on the HTTP service', () => {
    const service = collectionsService as unknown as Record<string, unknown>;
    expect(service['activeCollectionId']).toBeUndefined();
  });

  it('renders count badges from the counts fetch', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Philosophy');
    expect(fixture.nativeElement.textContent).toContain('5');
  });

  it('selection sets the collection filter (no navigation)', () => {
    component.select('c1');
    expect(component.filters.collectionId()).toBe('c1');
  });

  it('selecting the active collection toggles it off', () => {
    component.select('c1');
    component.select('c1');
    expect(component.filters.collectionId()).toBeNull();
  });

  it('rename sends both name and parentId', () => {
    component.saveRename('c1', 'Renamed');
    expect(collectionsService.update).toHaveBeenCalledWith('c1', {
      name: 'Renamed',
      parentId: null,
    });
  });

  it('move sends both name and parentId', () => {
    component.moveCollection({ id: 'c1', name: 'Philosophy', parentId: null }, 'c2');
    expect(collectionsService.update).toHaveBeenCalledWith('c1', {
      name: 'Philosophy',
      parentId: 'c2',
    });
  });

  it('delete of the active collection clears the collection filter', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.select('c1');
    fixture.detectChanges();

    component.deleteCollection('c1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.filters.collectionId()).toBeNull();
  });

  it('delete of a non-active collection keeps the active filter', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.select('c1');
    fixture.detectChanges();

    component.deleteCollection('c2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.filters.collectionId()).toBe('c1');
  });

  describe('rename', () => {
    it('sends the current parentId for a nested collection (rename must not move to root)', () => {
      collectionsService.list.mockReturnValue(of([rootCollection, nestedCollection]));
      collectionsService.update.mockReturnValue(of({}));
      component.load();

      component.saveRename('nested-1', 'Renamed');

      expect(collectionsService.update).toHaveBeenCalledWith('nested-1', {
        name: 'Renamed',
        parentId: 'root-1',
      });
    });

    it('sends an explicit null parentId for a root collection', () => {
      collectionsService.list.mockReturnValue(of([rootCollection]));
      collectionsService.update.mockReturnValue(of({}));
      component.load();

      component.saveRename('root-1', 'Renamed');

      expect(collectionsService.update).toHaveBeenCalledWith('root-1', {
        name: 'Renamed',
        parentId: null,
      });
    });

    it('shows the conflict message when a sibling name collides', () => {
      collectionsService.update.mockReturnValue(
        throwError(() => ({
          error: { title: 'collection_name_conflict', detail: 'A collection named X already exists here.' },
        })),
      );

      component.saveRename('nested-1', 'X');

      expect(toast.error).toHaveBeenCalledWith('A collection named X already exists here.');
      expect(component.editingId()).toBeNull();
    });
  });

  describe('delete', () => {
    it('explains that children must be removed first when delete is rejected', () => {
      collectionsService.delete.mockReturnValue(
        throwError(() => ({
          error: { title: 'collection_has_children', detail: 'Collection contains children.' },
        })),
      );
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      component.deleteCollection('root-1');

      expect(toast.error).toHaveBeenCalledWith('Move or delete the child collections first.');
      expect(component.collections()).toEqual(sampleCollections);
    });

    it('confirms before deleting and reloads on success', () => {
      collectionsService.list.mockReturnValue(of([rootCollection]));
      collectionsService.delete.mockReturnValue(of(undefined));
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      component.load();

      component.deleteCollection('root-1');

      expect(confirmSpy).toHaveBeenCalled();
      expect(collectionsService.delete).toHaveBeenCalledWith('root-1');
      expect(toast.info).toHaveBeenCalledWith('Collection deleted');
    });
  });

  describe('move', () => {
    it('surfaces move failures instead of failing silently', () => {
      collectionsService.update.mockReturnValue(
        throwError(() => ({
          error: { title: 'collection_cycle', detail: 'A collection cannot be moved into itself.' },
        })),
      );

      component.moveCollection(nestedCollection, 'nested-1');

      expect(toast.error).toHaveBeenCalledWith('A collection cannot be moved into itself or its children.');
    });

    it('skips the request when the parent is unchanged', () => {
      component.moveCollection(rootCollection, null);

      expect(collectionsService.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('surfaces creation failures', () => {
      collectionsService.create.mockReturnValue(
        throwError(() => ({ error: { title: 'invalid_collection_name', detail: 'Collection name is required.' } })),
      );
      component.newName.set('X');

      component.create();

      expect(toast.error).toHaveBeenCalledWith('Could not create collection.');
    });
  });

  describe('status filters (single progress-filter surface)', () => {
    function navGroups(): HTMLElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('.nav-group') as NodeListOf<HTMLElement>,
      );
    }

    function statusButtons(): HTMLButtonElement[] {
      // The first .nav-group is the status list (All Books … Unsorted).
      return Array.from(
        navGroups()[0].querySelectorAll('.nav-item') as NodeListOf<HTMLButtonElement>,
      );
    }

    function formatButtons(): HTMLButtonElement[] {
      // The second .nav-group holds the MEDIA format filters.
      return Array.from(
        navGroups()[1].querySelectorAll('.nav-item') as NodeListOf<HTMLButtonElement>,
      );
    }

    function navButton(buttons: HTMLButtonElement[], label: string): HTMLButtonElement {
      return buttons.find((el) => {
        const textSpan = el.querySelector('.label');
        return (textSpan?.textContent?.trim() ?? el.textContent?.trim()) === label;
      }) as HTMLButtonElement;
    }

    function statusButton(label: string): HTMLButtonElement {
      return navButton(statusButtons(), label);
    }

    function formatButton(label: string): HTMLButtonElement {
      return navButton(formatButtons(), label);
    }

    it('renders exactly six status choices in the expected order', () => {
      fixture.detectChanges();

      const labels = statusButtons().map((el) => el.textContent?.trim());
      expect(labels).toEqual([
        'All Books',
        'Not Started',
        'In Progress',
        'Favorites',
        'Finished',
        'Unsorted',
      ]);
    });

    it('does not show a "Reading" label or tooltip anywhere in the sidebar', () => {
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Reading');
      const readingTooltips = Array.from(
        fixture.nativeElement.querySelectorAll('[title]') as NodeListOf<HTMLElement>,
      ).filter((el) => el.getAttribute('title')?.includes('Reading') ?? false);
      expect(readingTooltips).toHaveLength(0);
    });

    it('clicking "In Progress" sets the status filter (no URL involved)', async () => {
      fixture.detectChanges();

      statusButton('In Progress').click();
      await fixture.whenStable();

      expect(component.filters.status()).toBe('reading');
    });

    it('clicking the active status filter toggles it off', async () => {
      fixture.detectChanges();

      statusButton('In Progress').click();
      await fixture.whenStable();
      statusButton('In Progress').click();
      await fixture.whenStable();

      expect(component.filters.status()).toBe('all');
    });

    it('clicking "Not Started" sets status=notstarted', async () => {
      fixture.detectChanges();

      statusButton('Not Started').click();
      await fixture.whenStable();

      expect(component.filters.status()).toBe('notstarted');
    });

    it('status selection keeps the existing collection filter', async () => {
      component.select('c1');
      fixture.detectChanges();

      statusButton('In Progress').click();
      await fixture.whenStable();

      expect(component.filters.collectionId()).toBe('c1');
      expect(component.filters.status()).toBe('reading');
    });

    it('collection then format keeps both (order-independent)', async () => {
      fixture.detectChanges();

      component.select('c1');
      formatButton('Audiobooks').click();
      await fixture.whenStable();

      expect(component.filters.collectionId()).toBe('c1');
      expect(component.filters.format()).toBe('audiobook');
    });

    it('format then collection keeps both (order-independent)', async () => {
      fixture.detectChanges();

      formatButton('Audiobooks').click();
      component.select('c1');
      await fixture.whenStable();

      expect(component.filters.collectionId()).toBe('c1');
      expect(component.filters.format()).toBe('audiobook');
    });

    it('clicking "All Books" clears status, format and collection', async () => {
      component.select('c1');
      component.toggleStatus('reading');
      component.toggleFormat('ebook');
      fixture.detectChanges();

      statusButton('All Books').click();
      await fixture.whenStable();

      expect(component.filters.status()).toBe('all');
      expect(component.filters.format()).toBe('all');
      expect(component.filters.collectionId()).toBeNull();
    });

    it('active state follows the filter service', async () => {
      component.toggleStatus('finished');
      fixture.detectChanges();
      await fixture.whenStable();

      let active = fixture.nativeElement.querySelector('.nav-item.active') as HTMLElement;
      expect(active.textContent).toContain('Finished');

      component.toggleStatus('reading');
      fixture.detectChanges();
      await fixture.whenStable();

      active = fixture.nativeElement.querySelector('.nav-item.active') as HTMLElement;
      expect(active.textContent).toContain('In Progress');
      expect(active.textContent).not.toContain('Finished');
    });

    it('mobile selection closes the drawer and restores focus to its opener', async () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', {
        value: 390,
        writable: true,
        configurable: true,
      });

      try {
        fixture.destroy();
        fixture = TestBed.createComponent(SidebarCollections);
        component = fixture.componentInstance;
        await fixture.whenStable();

        // On mobile the drawer starts closed; open it via the toggle.
        expect(component.expanded()).toBe(false);
        component.toggle();
        fixture.detectChanges();
        expect(component.expanded()).toBe(true);

        statusButton('In Progress').click();
        await fixture.whenStable();

        expect(component.expanded()).toBe(false);
        expect(document.activeElement).toBe(
          fixture.nativeElement.querySelector('.floating-toggle'),
        );
      } finally {
        Object.defineProperty(window, 'innerWidth', {
          value: originalWidth,
          writable: true,
          configurable: true,
        });
      }
    });

    it('desktop selection keeps the sidebar open and does not move focus', async () => {
      fixture.detectChanges();

      statusButton('In Progress').click();
      await fixture.whenStable();

      expect(component.expanded()).toBe(true);
      expect(document.activeElement).not.toBe(
        fixture.nativeElement.querySelector('.floating-toggle'),
      );
    });
  });
});
