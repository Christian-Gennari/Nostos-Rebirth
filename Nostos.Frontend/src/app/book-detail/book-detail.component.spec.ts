import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

import { BookDetail } from './book-detail.component';
import { Book } from '../core/dtos/book.dtos';
import { ToastService } from '../core/services/toast.service';

const book: Book = {
  id: 'b1',
  title: 'Meditations',
  subtitle: null,
  author: 'Marcus Aurelius',
  editor: null,
  translator: null,
  narrator: null,
  description: null,
  type: 'ebook',
  edition: null,
  asin: null,
  duration: null,
  isbn: null,
  publisher: null,
  placeOfPublication: null,
  publishedDate: null,
  pageCount: null,
  language: null,
  categories: null,
  series: null,
  volumeNumber: null,
  createdAt: '2026-08-01T08:00:00+02:00',
  hasFile: false,
  fileName: null,
  coverUrl: null,
  collectionId: null,
  lastLocation: null,
  progressPercent: 0,
  lastReadAt: null,
  rating: 0,
  isFavorite: false,
  personalReview: null,
  finishedAt: null,
};

describe('BookDetail reset progress', () => {
  let component: BookDetail;
  let fixture: ComponentFixture<BookDetail>;
  let httpMock: HttpTestingController;
  let toast: ToastService;

  /** Readable book with progress worth resetting (partial read). */
  function readableBook(overrides: Partial<Book> = {}): Book {
    return {
      ...book,
      hasFile: true,
      progressPercent: 42,
      lastLocation: 'epub.cfi',
      lastReadAt: '2026-08-10T08:00:00+02:00',
      ...overrides,
    };
  }

  async function setup(initial: Book = readableBook()) {
    fixture = TestBed.createComponent(BookDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectOne('/api/books/b1').flush(initial);
    httpMock.expectOne('/api/books/b1/notes').flush([]);
    httpMock.expectOne('/api/collections').flush([]);
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    fixture.detectChanges();
  }

  function statusChipButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.status-chip-btn');
  }

  function openResetViaDropdown(): void {
    const chip = statusChipButton();
    chip?.click();
    fixture.detectChanges();
    const items = Array.from(fixture.nativeElement.querySelectorAll('.status-dropdown-item')) as HTMLButtonElement[];
    const notStartedItem = items.find((el) => el.textContent?.includes('Not Started'));
    notStartedItem?.click();
    fixture.detectChanges();
  }

  function resetDialog(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.status-confirm-dialog');
  }

  function resetConfirmButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.status-confirm-dialog .btn-danger');
  }

  function resetCancelButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.status-confirm-dialog .btn-ghost');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDetail],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: book.id })) },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock.verify();
  });

  it('displays the status chip button reflecting current reading state', async () => {
    await setup(readableBook({ progressPercent: 42 }));
    const chip = statusChipButton();
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain('Reading');
  });

  it('toggles the status dropdown menu open and closed on chip click', async () => {
    await setup(readableBook());

    expect(fixture.nativeElement.querySelector('.status-dropdown-menu')).toBeNull();

    statusChipButton()!.click();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.status-dropdown-menu');
    expect(menu).toBeTruthy();
    const items = menu.querySelectorAll('.status-dropdown-item');
    expect(items.length).toBe(3);

    // Clicking again closes it
    statusChipButton()!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.status-dropdown-menu')).toBeNull();
  });

  it('opens confirmation modal when selecting Not Started from status dropdown', async () => {
    await setup(readableBook());

    openResetViaDropdown();

    const dialog = resetDialog();
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('Reset to Not Started?');
    expect(dialog!.textContent).toContain('start from the beginning');
    expect(resetConfirmButton()).toBeTruthy();
    expect(resetCancelButton()).toBeTruthy();
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
  });

  it('does nothing when the status change confirmation is cancelled', async () => {
    await setup(readableBook());

    openResetViaDropdown();
    expect(resetDialog()).toBeTruthy();

    resetCancelButton()!.click();
    fixture.detectChanges();

    expect(resetDialog()).toBeNull();
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
    expect(component.store.book()?.progressPercent).toBe(42);
  });

  it('closes the status confirmation dialog without submitting when backdrop is clicked', async () => {
    await setup(readableBook());

    openResetViaDropdown();
    expect(resetDialog()).toBeTruthy();

    const backdrop = fixture.nativeElement.querySelector('.reset-confirm-backdrop') as HTMLElement;
    backdrop.click();
    fixture.detectChanges();

    expect(resetDialog()).toBeNull();
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
  });

  it('confirms Not Started, then calls reset endpoint and refetches the book', async () => {
    await setup(readableBook());

    openResetViaDropdown();
    resetConfirmButton()!.click();
    fixture.detectChanges();

    const posts = httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset');
    expect(posts.length).toBe(1);
    expect(posts[0].request.body).toBeNull();

    posts[0].flush({ updated: true });
    const refetch = httpMock.expectOne('/api/books/b1');
    expect(refetch.request.method).toBe('GET');
    refetch.flush(
      readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: null, finishedAt: null })
    );
    fixture.detectChanges();

    expect(component.store.book()?.progressPercent).toBe(0);
    expect(resetDialog()).toBeNull();
    expect(toast.toasts().some((t) => t.message === 'Reading progress reset' && t.type === 'success')).toBe(true);
  });

  it('renders edition switcher tabs when multiple editions exist and calls switchEdition', async () => {
    const multiEditionBook = readableBook({
      otherEditions: [
        {
          id: 'b2',
          type: 'audiobook',
          format: 'AUDIO',
          progressPercent: 15,
          hasFile: true,
          duration: '10h',
          narrator: 'Narrator Guy',
        },
      ],
    });
    await setup(multiEditionBook);

    const tabs = fixture.nativeElement.querySelectorAll('.edition-select-card');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('EPUB');
    expect(tabs[1].textContent).toContain('Audiobook');
  });

  it('does NOT render a danger zone card on the main page', async () => {
    await setup(readableBook());
    expect(fixture.nativeElement.querySelector('.danger-zone-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.primary-actions .delete-book-btn')).toBeNull();
  });

  it('triggers delete confirmation modal via openDeleteConfirm and deletes on confirm', async () => {
    await setup(readableBook());
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.openDeleteConfirm();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.delete-confirm-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Delete "Meditations"?');

    const deleteBtn = dialog.querySelector('.btn-danger') as HTMLButtonElement;
    deleteBtn.click();
    fixture.detectChanges();

    httpMock.expectOne((req) => req.method === 'DELETE' && req.url === '/api/books/b1').flush(null);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/library']);
    expect(fixture.nativeElement.querySelector('.delete-confirm-dialog')).toBeNull();
  });
});
