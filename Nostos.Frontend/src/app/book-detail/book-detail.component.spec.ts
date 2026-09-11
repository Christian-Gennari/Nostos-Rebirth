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

  function resetButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.reset-progress-btn');
  }

  function resetDialog(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.reset-confirm-dialog');
  }

  function resetConfirmButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.reset-confirm-dialog .btn-danger');
  }

  function resetCancelButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.reset-confirm-dialog .btn-ghost');
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

  it('is hidden for an untouched book, even when it has a file', async () => {
    await setup(readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: null, finishedAt: null }));
    expect(resetButton()).toBeNull();
  });

  it('is hidden for a book without a file even when progress exists', async () => {
    await setup({ ...book, hasFile: false, progressPercent: 42, lastLocation: 'epub.cfi' });
    expect(resetButton()).toBeNull();
  });

  it('is visible for a partially read book', async () => {
    await setup(readableBook());
    const button = resetButton();
    expect(button).toBeTruthy();
    expect(button!.getAttribute('aria-label')).toBe('Reset reading progress');
  });

  it('is visible for a finished book', async () => {
    await setup(
      readableBook({
        progressPercent: 100,
        finishedAt: '2026-08-10T08:00:00+02:00',
      })
    );
    expect(resetButton()).toBeTruthy();
  });

  it('is visible when only a saved location or recency exists', async () => {
    await setup(readableBook({ progressPercent: 0, lastLocation: 'epub.cfi', lastReadAt: null }));
    expect(resetButton()).toBeTruthy();

    await setup(readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: '2026-08-10T08:00:00+02:00' }));
    expect(resetButton()).toBeTruthy();
  });

  it('opens the styled confirmation dialog on click, with the next-open warning', async () => {
    await setup(readableBook());

    resetButton()!.click();
    fixture.detectChanges();

    const dialog = resetDialog();
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('Reset reading progress?');
    expect(dialog!.textContent).toContain('start from the beginning');
    expect(resetConfirmButton()).toBeTruthy();
    expect(resetCancelButton()).toBeTruthy();
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    await setup(readableBook());

    resetButton()!.click();
    fixture.detectChanges();
    expect(resetDialog()).toBeTruthy();

    resetCancelButton()!.click();
    fixture.detectChanges();

    expect(resetDialog()).toBeNull();
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
    expect(component.store.book()?.progressPercent).toBe(42);
  });

  it('closes the dialog without submitting when the backdrop is clicked', async () => {
    await setup(readableBook());

    resetButton()!.click();
    fixture.detectChanges();
    expect(resetDialog()).toBeTruthy();

    const backdrop = fixture.nativeElement.querySelector('.reset-confirm-backdrop') as HTMLElement;
    backdrop.click();
    fixture.detectChanges();

    expect(resetDialog()).toBeNull();
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
  });

  it('confirms, then calls exactly one reset endpoint and refetches the book on success', async () => {
    await setup(readableBook());

    resetButton()!.click();
    fixture.detectChanges();
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
    expect(component.store.book()?.lastLocation).toBeNull();
    expect(resetButton()).toBeNull();
    expect(resetDialog()).toBeNull();
    expect(toast.toasts().some((t) => t.message === 'Reading progress reset' && t.type === 'success')).toBe(true);
  });

  it('disables the button while the reset is pending and never submits twice', async () => {
    await setup(readableBook());

    resetButton()!.click();
    fixture.detectChanges();
    resetConfirmButton()!.click();
    fixture.detectChanges();
    expect(resetButton()!.disabled).toBe(true);
    expect(resetButton()!.title).toContain('Resetting');
    expect(resetButton()!.querySelector('.spinning')).toBeTruthy();
    expect(resetDialog()).toBeNull();

    // A second click on the disabled trigger must not fire another request.
    resetButton()!.click();
    fixture.detectChanges();

    const posts = httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset');
    // Exactly one reset submission despite the duplicate click.
    expect(posts.length).toBe(1);
    posts[0].flush({ updated: true });
    httpMock.expectOne('/api/books/b1').flush(readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: null, finishedAt: null }));
    fixture.detectChanges();
    expect(resetButton()).toBeNull();
  });

  it('preserves the displayed state and shows an error toast on failure', async () => {
    await setup(readableBook());

    resetButton()!.click();
    fixture.detectChanges();
    resetConfirmButton()!.click();
    fixture.detectChanges();

    httpMock
      .expectOne((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset')
      .flush({ data: { code: 'book_not_found' } }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(httpMock.match((req) => req.method === 'GET' && req.url === '/api/books/b1').length).toBe(0);
    expect(component.store.book()?.progressPercent).toBe(42);
    expect(resetButton()).toBeTruthy();
    expect(resetDialog()).toBeNull();
    expect(toast.toasts().some((t) => t.message === 'Failed to reset progress' && t.type === 'error')).toBe(true);
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

  it('renders a dedicated Danger Zone card placed before the notes container', async () => {
    await setup(readableBook());

    const dangerZone = fixture.nativeElement.querySelector('.danger-zone-card');
    const notesContainer = fixture.nativeElement.querySelector('.notes-container');
    expect(dangerZone).toBeTruthy();
    expect(notesContainer).toBeTruthy();
    // Danger Zone sits before the notes container in DOM order
    expect(dangerZone.compareDocumentPosition(notesContainer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.primary-actions .delete-book-btn')).toBeNull();
  });

  it('opens and closes the custom glass delete confirmation modal', async () => {
    await setup(readableBook());

    expect(fixture.nativeElement.querySelector('.delete-confirm-dialog')).toBeNull();

    const trigger = fixture.nativeElement.querySelector('.delete-book-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.delete-confirm-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Delete "Meditations"?');

    // Cancel closes dialog
    const cancelBtn = dialog.querySelector('.btn-ghost') as HTMLButtonElement;
    cancelBtn.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.delete-confirm-dialog')).toBeNull();
  });

  it('deletes the book and navigates to library when confirmed in modal', async () => {
    await setup(readableBook());
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const trigger = fixture.nativeElement.querySelector('.delete-book-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.delete-confirm-dialog');
    const deleteBtn = dialog.querySelector('.btn-danger') as HTMLButtonElement;
    deleteBtn.click();
    fixture.detectChanges();

    httpMock.expectOne((req) => req.method === 'DELETE' && req.url === '/api/books/b1').flush(null);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/library']);
    expect(fixture.nativeElement.querySelector('.delete-confirm-dialog')).toBeNull();
  });
});
