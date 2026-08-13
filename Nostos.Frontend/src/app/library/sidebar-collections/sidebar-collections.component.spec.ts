import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SidebarCollections } from './sidebar-collections.component';
import { CollectionsService } from '../../core/services/collections.service';
import { ToastService } from '../../core/services/toast.service';
import { Collection } from '../../core/dtos/collection.dtos';

describe('SidebarCollections', () => {
  let component: SidebarCollections;
  let fixture: ComponentFixture<SidebarCollections>;
  let collectionsService: {
    sidebarExpanded: ReturnType<typeof signal<boolean>>;
    activeCollectionId: ReturnType<typeof signal<string | null>>;
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };

  const rootCollection: Collection = { id: 'root-1', name: 'Root', parentId: null };
  const nestedCollection: Collection = { id: 'nested-1', name: 'Nested', parentId: 'root-1' };

  beforeEach(async () => {
    collectionsService = {
      sidebarExpanded: signal(true),
      activeCollectionId: signal<string | null>(null),
      list: vi.fn(() => of([])),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    toast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SidebarCollections],
      providers: [
        provideRouter([]),
        { provide: CollectionsService, useValue: collectionsService },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarCollections);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
      expect(component.collections()).toEqual([]);
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
