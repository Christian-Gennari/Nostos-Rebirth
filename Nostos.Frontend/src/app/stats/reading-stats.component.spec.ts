import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ReadingStats } from './reading-stats.component';
import { BooksService } from '../core/services/books.service';

describe('ReadingStats', () => {
  let fixture: ComponentFixture<ReadingStats>;
  let component: ReadingStats;

  const counts = {
    all: 15,
    notStarted: 3,
    reading: 7,
    favorites: 3,
    finished: 5,
    unsorted: 2,
  };
  const readingBooks = [
    { id: 'b1', title: 'Dune', author: 'Frank Herbert', progressPercent: 64, rating: 5 },
    { id: 'b2', title: 'Neuromancer', author: 'William Gibson', progressPercent: 12, rating: 4 },
  ];
  const ratedBooks = [
    { id: 'b1', title: 'Dune', author: 'Frank Herbert', progressPercent: 100, rating: 5 },
    { id: 'b3', title: 'Unrated', author: 'Anon', progressPercent: 10, rating: 0 },
  ];

  const listSpy = vi.fn((options: { filter?: string; sort?: string }) => {
    if (options.filter === 'reading') return of({ items: readingBooks, totalCount: 2 });
    return of({ items: ratedBooks, totalCount: 2 });
  });

  beforeEach(async () => {
    listSpy.mockClear();

    await TestBed.configureTestingModule({
      imports: [ReadingStats],
      providers: [
        provideRouter([]),
        {
          provide: BooksService,
          useValue: {
            getStatusCounts: vi.fn(() => of(counts)),
            list: listSpy,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReadingStats);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders totals and the finished share from status counts', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Reading Stats');
    expect(component.counts()).toEqual(counts);
    expect(component.finishedShare()).toBe(33); // 5/15

    const values = Array.from(
      fixture.nativeElement.querySelectorAll('.stat-value') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());
    expect(values).toEqual(['15', '7', '5', '3', '3']);
  });

  it('lists currently-reading books with progress', () => {
    expect(component.currentlyReading().length).toBe(2);

    const rows = fixture.nativeElement.querySelectorAll(
      '[aria-label="Currently reading"] .stats-row',
    );
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Dune');
    expect(rows[0].textContent).toContain('64%');
    expect(rows[0].getAttribute('href')).toContain('/library/b1');
  });

  it('lists only rated books in top rated', () => {
    const rows = fixture.nativeElement.querySelectorAll('[aria-label="Top rated"] .stats-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Dune');
  });

  it('shows empty states when lists are empty', () => {
    component.currentlyReading.set([]);
    component.topRated.set([]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nothing in progress');
    expect(text).toContain('No rated books yet');
  });
});
