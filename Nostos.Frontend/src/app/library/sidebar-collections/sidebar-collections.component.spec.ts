import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

import { SidebarCollections } from './sidebar-collections.component';
import { CollectionsService } from '../../core/services/collections.service';

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

  beforeEach(async () => {
    collectionsService = {
      sidebarExpanded: signal(true),
      list: vi.fn(() => of([{ id: 'c1', name: 'Philosophy', parentId: null }])),
      getCounts: vi.fn(() => of([{ collectionId: 'c1', bookCount: 5 }])),
      create: vi.fn(() => of({ id: 'c2', name: 'New', parentId: null })),
      update: vi.fn(() => of({ id: 'c1', name: 'Philosophy', parentId: null })),
      delete: vi.fn(() => of(null)),
    };

    await TestBed.configureTestingModule({
      imports: [SidebarCollections],
      providers: [
        provideRouter([{ path: 'library', component: DummyComponent }]),
        { provide: CollectionsService, useValue: collectionsService },
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
});
