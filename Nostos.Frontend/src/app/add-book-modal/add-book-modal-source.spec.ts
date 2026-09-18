import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AddBookModal } from './add-book-modal.component';
import { Book, BooksService } from '../core/services/books.service';
import { ProvidersService } from '../core/services/providers.service';
import { ProviderAcquisition, ProviderItem, ProviderSummary } from '../core/dtos/provider.dtos';

/**
 * The "From a Source" tab (issue #167).
 *
 * The states worth pinning are the ones a user notices when they are wrong:
 * which sources are offered, what a result looks like, that the import cannot
 * look finished before the server says it is, and that a failure explains
 * itself instead of silently doing nothing.
 */
const collections = [{ id: 'root', name: 'Root', parentId: null }];

const gutenberg: ProviderSummary = {
  id: 'gutenberg',
  displayName: 'Project Gutenberg',
  capabilities: ['search', 'itemretrieval', 'ebookacquisition'],
  rightsNotice: 'Public domain in the USA (Project Gutenberg)',
};

const pride: ProviderItem = {
  providerId: 'gutenberg',
  externalId: '1342',
  title: 'Pride and Prejudice',
  subtitle: null,
  author: 'Jane Austen',
  description: null,
  language: 'English',
  publisher: null,
  publishedDate: null,
  categories: 'England -- Fiction',
  narrator: null,
  duration: null,
  pageCount: null,
  assets: [
    {
      id: 'epub3-images',
      kind: 'ebook',
      label: 'EPUB3 (E-readers incl. Send-to-Kindle)',
      sourceFormat: 'epub3-images',
      sizeBytes: 24835578,
      isPreferred: true,
    },
    {
      id: 'epub-noimages',
      kind: 'ebook',
      label: 'EPUB (no images, older E-readers)',
      sourceFormat: 'epub-noimages',
      sizeBytes: 558381,
      isPreferred: false,
    },
  ],
  coverUrl: '/api/providers/gutenberg/items/1342/cover',
  sourceUrl: 'https://www.gutenberg.org/ebooks/1342',
  rightsStatement: 'Public domain in the USA.',
  partCount: null,
};

function job(overrides: Partial<ProviderAcquisition> = {}): ProviderAcquisition {
  return {
    jobId: 'job-1',
    state: 'running',
    stage: 'downloading',
    percent: 42,
    detail: '1/1 files',
    providerId: 'gutenberg',
    externalId: '1342',
    assetId: 'epub3-images',
    bookId: null,
    errorCode: null,
    message: null,
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-17T00:00:00Z',
    ...overrides,
  };
}

describe('AddBookModal — From a Source', () => {
  let component: AddBookModal;
  let fixture: ComponentFixture<AddBookModal>;
  let providers: ProvidersService;
  let books: BooksService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddBookModal],
      providers: [provideRouter([])],
    }).compileComponents();

    providers = TestBed.inject(ProvidersService);
    books = TestBed.inject(BooksService);
    vi.spyOn(providers, 'list').mockReturnValue(of([gutenberg]));
    vi.spyOn(providers, 'search').mockReturnValue(
      of({ items: [pride], hasMore: false, notice: null }),
    );
    // Search results carry no assets by design, so selecting one fetches the
    // full item. Mocked here so the tests never reach for the network.
    vi.spyOn(providers, 'item').mockImplementation((_providerId, externalId) =>
      of({ ...pride, externalId }),
    );

    fixture = TestBed.createComponent(AddBookModal);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('collections', collections);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function tabLabels(): string[] {
    return Array.from<Element>(fixture.nativeElement.querySelectorAll('.tab-btn')).map(
      (b) => b.textContent?.trim() ?? '',
    );
  }

  it('offers every form tab, and no import tab at all', () => {
    // Importing is not a tab: it is a step BEFORE the form, entered from the
    // Add Book chooser, so the form carries only the fields a book has.
    expect(tabLabels()).toEqual(['Book Info', 'Publishing', 'Files & Personal']);
  });

  it('refuses to enter the source search when editing a book', () => {
    fixture.componentRef.setInput('book', { id: 'b1', title: 'Meditations' } as unknown as Book);
    fixture.detectChanges();

    component.enterSourceMode();

    // Importing is a way to ADD a book, so it has no place in edit mode.
    expect(component.sourceMode()).toBe(false);
  });

  it('starts in the source search when the caller asks for it', async () => {
    fixture.componentRef.setInput('sourceFirst', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.sourceMode()).toBe(true);
    // The form is not on screen until the search has produced a book.
    expect(fixture.nativeElement.querySelector('.modal-tabs')?.hidden).toBe(true);
    // And the sources have to actually be loaded, or the search has nothing to
    // run against. Found by pressing the button, not by reading the code.
    expect(component.providerList().length).toBeGreaterThan(0);
  });

  it('loads the sources when the tab is opened and selects the first', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(providers.list).toHaveBeenCalled();
    expect(component.selectedProviderId()).toBe('gutenberg');
    expect(fixture.nativeElement.textContent).toContain('Search Project Gutenberg');
  });

  it('surfaces a source-failure instead of an empty screen', async () => {
    vi.spyOn(providers, 'list').mockReturnValue(throwError(() => new Error('down')));

    component.enterSourceMode();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.providersError()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.source-error')).toBeTruthy();
  });

  it('will not search on a single character, and searches on two', async () => {
    component.enterSourceMode();
    await fixture.whenStable();

    component.sourceQuery.set('p');
    component.searchSource();
    expect(providers.search).not.toHaveBeenCalled();

    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();

    expect(providers.search).toHaveBeenCalledWith('gutenberg', 'pride');
  });

  it('renders results with their metadata and the proxied cover', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.source-result');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Pride and Prejudice');
    expect(rows[0].textContent).toContain('Jane Austen');

    // The browser never talks to the source directly: the URL is Nostos's own.
    expect(fixture.nativeElement.querySelector('.source-cover').getAttribute('src')).toBe(
      '/api/providers/gutenberg/items/1342/cover',
    );
  });

  it('preselects the source\'s preferred asset and explains the rights position', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();

    component.selectSourceItem(pride);
    fixture.detectChanges();

    expect(component.selectedAssetId()).toBe('epub3-images');

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('EPUB3 (E-readers incl. Send-to-Kindle)');
    expect(text).toContain('EPUB (no images, older E-readers)');
    // Quoted from the source, not asserted by Nostos.
    expect(text).toContain('Source says: Public domain in the USA.');
  });

  it('hides the form submit button on the source tab', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    fixture.detectChanges();

    const submit = Array.from<Element>(fixture.nativeElement.querySelectorAll('button')).find(
      (b) => b.getAttribute('type') === 'submit',
    );
    expect(submit).toBeUndefined();
  });

  it('reports progress while the import runs, and does not claim to be finished', async () => {
    vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));
    vi.spyOn(providers, 'job').mockReturnValue(of(job({ percent: 70, stage: 'assembling' })));

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    vi.useFakeTimers();
    component.importSelected();
    await vi.advanceTimersByTimeAsync(1100);
    fixture.detectChanges();

    const progress = fixture.nativeElement.querySelector('.source-progress');
    expect(progress).toBeTruthy();
    // The stage is a coarsely-labelled pipeline step, not a raw enum.
    expect(progress.textContent).toContain('Preparing the file');
    expect(progress.textContent).toContain('70%');
    expect(component.bookAdded.emit).toBeDefined();
  });

  it('opens the resulting local book only once the server reports success', async () => {
    vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));
    vi.spyOn(providers, 'job').mockReturnValue(
      of(job({ state: 'succeeded', stage: 'done', percent: 100, bookId: 'book-9' })),
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const added = vi.fn();
    const closed = vi.fn();
    component.bookAdded.subscribe(added);
    component.closeModal.subscribe(closed);

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    vi.useFakeTimers();
    component.importSelected();
    await vi.advanceTimersByTimeAsync(1100);

    expect(added).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    // The user's own library stays the destination.
    expect(navigate).toHaveBeenCalledWith(['/library', 'book-9']);
  });

  it('shows the failure and its code, and leaves the dialog open', async () => {
    vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));
    vi.spyOn(providers, 'job').mockReturnValue(
      of(
        job({
          state: 'failed',
          stage: 'failed',
          message: 'The source has no file at that address (HTTP 404).',
          errorCode: 'download_not_found',
        }),
      ),
    );
    const closed = vi.fn();
    component.closeModal.subscribe(closed);

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    vi.useFakeTimers();
    component.importSelected();
    await vi.advanceTimersByTimeAsync(1100);
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.source-error');
    expect(error.textContent).toContain('download_not_found');
    expect(closed).not.toHaveBeenCalled();
  });

  it('reports a job the server no longer knows about rather than polling forever', async () => {
    vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));
    vi.spyOn(providers, 'job').mockReturnValue(throwError(() => new Error('404')));

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    vi.useFakeTimers();
    component.importSelected();
    await vi.advanceTimersByTimeAsync(1100);

    expect(component.sourceImportError()).toContain('no longer being tracked');
  });

  it('sends only the provider, item and asset — never a URL', async () => {
    const acquire = vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);
    component.seedFromSelectedItem();
    component.form.collectionIds = ['root'];
    component.importSelected();

    const body = acquire.mock.calls[0][1];

    expect(acquire).toHaveBeenCalledWith(
      'gutenberg',
      expect.objectContaining({
        externalId: '1342',
        assetId: 'epub3-images',
        collectionIds: ['root'],
      }),
    );

    // Nothing on the wire may carry a location: the server resolves those, and a
    // client-supplied URL would turn this endpoint into a general-purpose fetcher.
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);

    // Nothing was edited, so nothing is pinned. The source still owns every
    // field, and a later correction at the source can still reach the library.
    const overrides = Object.values(body.metadataOverrides ?? {});
    expect(overrides.every((value) => value === null)).toBe(true);
  });

  // --- Importing from a prefilled form ----------------------------------

  it('fills the form from the chosen item so it can be finished before importing', async () => {
    const acquire = vi.spyOn(providers, 'acquire');

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    component.seedFromSelectedItem();

    expect(component.form.title).toBe('Pride and Prejudice');
    expect(component.form.author).toBe('Jane Austen');
    expect(component.form.language).toBe('English');
    expect(component.form.categories).toBe('England -- Fiction');

    // Picking a result ends at the form, not at a download: the metadata is
    // reviewed and completed first, so the book is created once and already right.
    expect(component.activeTab()).toBe('Book Info');
    expect(component.seededFromSource()).toBe(true);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('takes the format from the asset being fetched', async () => {
    // The detail endpoint is what says this item is a recording.
    const audiobook = {
      ...pride,
      assets: [{ ...pride.assets[0], id: 'sections', kind: 'audiobook' }],
    } as ProviderItem;
    vi.spyOn(providers, 'item').mockReturnValue(of(audiobook));

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(audiobook);
    await fixture.whenStable();

    // An audiobook asset must not be filed where the ebook reader will open it.
    component.seedFromSelectedItem();

    expect(component.form.type).toBe('audiobook');
  });

  it('imports on save instead of creating from the form', async () => {
    const acquire = vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));
    const create = vi.spyOn(books, 'create');

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);
    component.seedFromSelectedItem();

    component.submit();

    expect(acquire).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends only the fields the user actually edited', async () => {
    const acquire = vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);
    component.seedFromSelectedItem();

    component.form.author = 'Austen, Jane';
    component.form.description = 'My own note.';
    component.importSelected();

    const overrides = acquire.mock.calls[0][1].metadataOverrides;

    expect(overrides?.author).toBe('Austen, Jane');
    expect(overrides?.description).toBe('My own note.');
    // Untouched fields stay null so the source keeps owning them.
    expect(overrides?.title).toBeNull();
    expect(overrides?.categories).toBeNull();
    expect(overrides?.publisher).toBeNull();
  });
});
