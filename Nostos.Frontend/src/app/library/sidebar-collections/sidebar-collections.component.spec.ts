import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SidebarCollections } from './sidebar-collections.component';
import { CollectionsService } from '../../core/services/collections.service';
import { ToastService } from '../../core/services/toast.service';
import { Collection } from '../../core/dtos/collection.dtos';

@Component({ template: '' })
class DummyComponent {}

describe('SidebarCollections', () => {
  let component: SidebarCollections;
  let fixture: ComponentFixture<SidebarCollections>;
  let router: Router;
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
        provideRouter([{ path: 'library', component: DummyComponent }]),
        { provide: CollectionsService, useValue: collectionsService },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
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

  it('selection navigates with the collection query param via the router', () => {
    const navigateSpy = vi.spyOn(router, 'navigate');
    component.select('c1');
    expect(navigateSpy).toHaveBeenCalledWith(['/library'], {
      queryParams: { collection: 'c1' },
      queryParamsHandling: 'merge',
    });
  });

  it('selection with null clears the collection query param', () => {
    const navigateSpy = vi.spyOn(router, 'navigate');
    component.select(null);
    expect(navigateSpy).toHaveBeenCalledWith(['/library'], {
      queryParams: { collection: null },
      queryParamsHandling: 'merge',
    });
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

  it('delete of the active collection navigates with collection:null', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await router.navigate(['/library'], { queryParams: { collection: 'c1' } });
    fixture.detectChanges();
    await fixture.whenStable();

    component.deleteCollection('c1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.url).not.toContain('collection=');
  });

  it('delete of a non-active collection does not navigate', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await router.navigate(['/library'], { queryParams: { collection: 'c1' } });
    fixture.detectChanges();
    await fixture.whenStable();

    const navigateSpy = vi.spyOn(router, 'navigate');
    component.deleteCollection('c2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigateSpy).not.toHaveBeenCalled();
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
});
