import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Library } from './library.component';
import { BooksService } from '../core/services/books.service';
import { CollectionsService } from '../core/services/collections.service';
import { PaginatedResponse } from '../core/dtos/book.dtos';

describe('Library', () => {
  let component: Library;
  let fixture: ComponentFixture<Library>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Library],
      providers: [
        provideRouter([]),
        {
          provide: BooksService,
          useValue: {
            list: vi.fn(() => of({ items: [], totalCount: 0 } as PaginatedResponse<never>)),
            update: vi.fn(() => of({})),
            delete: vi.fn(() => of(null)),
          } as unknown as BooksService,
        },
        {
          provide: CollectionsService,
          useValue: {
            activeCollectionId: signal<string | null>(null),
            sidebarExpanded: signal(true),
            list: vi.fn(() => of([])),
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
});
