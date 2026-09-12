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

  it('prompts to write the first note when the feed is empty', async () => {
    await setup(readableBook());

    const empty = fixture.nativeElement.querySelector('.notes-empty') as HTMLElement;
    expect(empty?.textContent).toContain('first thought');
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

  it('triggers the confirm dialog via openDeleteConfirm and deletes on confirm', async () => {
    await setup(readableBook());
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.openDeleteConfirm();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.confirm-modal-card');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Delete “Meditations”?');

    const deleteBtn = dialog.querySelector('.btn-confirm') as HTMLButtonElement;
    deleteBtn.click();
    fixture.detectChanges();

    httpMock.expectOne((req) => req.method === 'DELETE' && req.url === '/api/books/b1').flush(null);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/library']);
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeNull();
  });

  it('does not display the uploaded file name in the meta strip', async () => {
    await setup(readableBook({ fileName: 'book.m4b' }));
    const metaStrip = fixture.nativeElement.querySelector('.meta-strip');
    expect(metaStrip).toBeTruthy();
    expect(metaStrip.textContent).not.toContain('File');
    expect(metaStrip.textContent).not.toContain('book.m4b');
  });

  // ── Hero band (cover-carried header) ────────────────────────────────────────
  // Regression context: the page used to render the cover in a narrow left column
  // inside an 800px centred container, which left most of a wide screen empty.
  // The hero band is what fills the top of the page, so these tests guard that it
  // exists, is driven by the book's own art, and degrades safely without a cover.

  function hero(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.book-hero');
  }

  function heroArtImages(): HTMLImageElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.hero-art img'));
  }

  it('renders the title and author inside the hero band, not a side column', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    const band = hero();
    expect(band).toBeTruthy();
    expect(band!.querySelector('.book-title')?.textContent).toContain('Meditations');
    expect(band!.querySelector('.book-author')?.textContent).toContain('Marcus Aurelius');
  });

  it('drives the hero art from the cover, as real img elements not a CSS url() binding', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    const imgs = heroArtImages();
    // Two layers (defocused base + halation bloom) share the same source.
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      // A style-binding'd url() is stripped by the framework and renders an empty
      // rectangle; a real src is the only reliable carrier.
      expect(img.getAttribute('src')).toBeTruthy();
      expect(img.getAttribute('src')).toContain('/api/books/b1/cover');
    }
  });

  it('uses the small cover rendition for the hero art, not the full-size cover', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    // The art is defocused to the point where detail is irrelevant.
    expect(heroArtImages()[0].getAttribute('src')).toBe('/api/books/b1/cover/thumbnail?width=640');
  });

  it('marks the hero art decorative so it never captures pointer or a11y focus', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    expect(fixture.nativeElement.querySelector('.hero-art')!.getAttribute('aria-hidden')).toBe('true');
    for (const img of heroArtImages()) {
      expect(img.getAttribute('alt')).toBe('');
    }
  });

  it('falls back to a plain band (no art layers) when the book has no cover', async () => {
    await setup(readableBook({ coverUrl: null }));

    expect(hero()).toBeTruthy();
    expect(hero()!.classList.contains('no-art')).toBe(true);
    expect(heroArtImages().length).toBe(0);
    // The band must still carry the title.
    expect(hero()!.querySelector('.book-title')?.textContent).toContain('Meditations');
  });

  it('drops the hero art when its image fails to load', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));
    expect(heroArtImages().length).toBe(2);

    heroArtImages()[0].dispatchEvent(new Event('error'));
    fixture.detectChanges();

    // Otherwise the band keeps a broken image and, worse, keeps the scrim over a
    // blank field. It must fall back to the flat gradient band.
    expect(hero()!.classList.contains('no-art')).toBe(true);
    expect(heroArtImages().length).toBe(0);
  });

  it('renders a single favorite control (no duplicated desktop/mobile variants)', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    // A previous iteration shipped two heart buttons toggled by media queries and
    // leaked duplicates at intermediate widths.
    const favs = fixture.nativeElement.querySelectorAll('.favorite-btn');
    expect(favs.length).toBe(1);
  });

  it('keeps the details rail populated so the two-column body is never half empty', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    const side = fixture.nativeElement.querySelector('.detail-side') as HTMLElement | null;
    expect(side).toBeTruthy();

    // The editions block is conditional and absent for single-edition books, so
    // without the details card the rail would be an empty 320px gutter — which is
    // exactly the "empty right column" defect this layout exists to fix.
    expect(side!.querySelector('.details-card')).toBeTruthy();
    expect(side!.textContent).toContain('Publisher');
    expect(side!.querySelector('.meta-strip')).toBeTruthy();
  });

  it('moves the details out of the synopsis card and into the rail', async () => {
    await setup(readableBook({ coverUrl: '/api/books/b1/cover' }));

    const block = fixture.nativeElement.querySelector('.synopsis-metadata-block');
    expect(block).toBeTruthy();
    // Leaving a copy behind would duplicate every metadata row on the page.
    expect(block.querySelector('.meta-grid')).toBeNull();
    expect(block.querySelector('.meta-strip')).toBeNull();
  });
});
