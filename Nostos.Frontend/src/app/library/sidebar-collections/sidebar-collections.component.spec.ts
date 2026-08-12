import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { SidebarCollections } from './sidebar-collections.component';
import { CollectionsService } from '../../core/services/collections.service';

describe('SidebarCollections', () => {
  let component: SidebarCollections;
  let fixture: ComponentFixture<SidebarCollections>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarCollections],
      providers: [
        provideRouter([]),
        {
          provide: CollectionsService,
          useValue: {
            sidebarExpanded: signal(true),
            activeCollectionId: signal<string | null>(null),
            list: vi.fn(() => of([])),
          } as unknown as CollectionsService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarCollections);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
