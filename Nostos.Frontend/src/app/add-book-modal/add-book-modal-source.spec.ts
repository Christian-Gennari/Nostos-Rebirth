import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AddBookModal } from './add-book-modal.component';
import { Book, BooksService } from '../core/services/books.service';
import { ProvidersService } from '../core/services/providers.service';
import { ProviderAcquisition, ProviderItem, ProviderSummary } from '../core/dtos/provider.dtos';
import { ToastService } from '../core/services/toast.service';

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

  it('exposes the form sections as keyboard-navigable ARIA tabs', () => {
    const tablist = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;
    const tabs = Array.from<HTMLButtonElement>(tablist.querySelectorAll('[role="tab"]'));

    expect(tablist.getAttribute('aria-label')).toBe('Book details sections');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-controls')).toBe('book-info-panel');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');

    const bookInfoPanel = fixture.nativeElement.querySelector('#book-info-panel') as HTMLElement;
    expect(bookInfoPanel.getAttribute('role')).toBe('tabpanel');
    expect(bookInfoPanel.getAttribute('aria-labelledby')).toBe('book-info-tab');

    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();

    expect(component.activeTab()).toBe('Publishing');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
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
    // The strip is not merely hidden — it is not rendered. `[hidden]` loses to
    // any author `display` rule, and `.modal-tabs` is `display: flex`, which is
    // exactly how the tabs stayed on screen above the search.
    expect(fixture.nativeElement.querySelector('.modal-tabs')).toBeNull();
    // And the sources have to actually be loaded, or the search has nothing to
    // run against. Found by pressing the button, not by reading the code.
    expect(component.providerList().length).toBeGreaterThan(0);
  });

  it('uses canonical controls for the ordinary source search field and import action', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    fixture.detectChanges();

    const query = fixture.nativeElement.querySelector('#source-query') as HTMLInputElement;
    expect(query.classList.contains('nostos-form-control')).toBe(true);

    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();
    component.selectSourceItem(pride);
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector('.source-action') as HTMLButtonElement;
    expect(action.classList.contains('nostos-button')).toBe(true);
    expect(action.classList.contains('nostos-button--primary')).toBe(true);
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

  it("preselects the source's preferred format, collapsed, and names who claims the rights", async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();

    component.selectSourceItem(pride);
    fixture.detectChanges();

    expect(component.selectedAssetId()).toBe('epub3-images');

    // The formats sit behind a collapsed disclosure. `textContent` reports them
    // whether or not it is open — the same way `[hidden]` reported `true` on a
    // visible element — so this asserts the state, not the presence of a string.
    const formats = fixture.nativeElement.querySelector('.source-formats') as HTMLDetailsElement;
    expect(formats).toBeTruthy();
    expect(formats.open).toBe(false);
    expect(formats.querySelector('.source-formats-current')?.textContent).toContain(
      'EPUB3 (E-readers incl. Send-to-Kindle)',
    );
    const assets = component.selectedSourceItem()?.assets ?? [];
    // More than one is the reason it is a disclosure at all.
    expect(assets.length).toBeGreaterThan(1);
    expect(formats.querySelectorAll('.source-asset').length).toBe(assets.length);

    // Status first, then who said it — in brackets, and the attribution is the
    // link. The source's own trailing full stop is dropped, because the line now
    // ends with the bracket rather than with the statement. The two are separate
    // nodes and the gap between them is a CSS margin (Angular strips whitespace
    // between inline elements), so each part is asserted on its own.
    const status = fixture.nativeElement
      .querySelector('.source-rights-status')
      ?.textContent?.trim();
    expect(status).toBe('Public domain in the USA');

    const link = fixture.nativeElement.querySelector(
      '.source-rights-link',
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('(via Project Gutenberg');
    // One link, and it is the attribution: a separate "view at source" would
    // have named the same place twice.
    expect(fixture.nativeElement.textContent).not.toContain('View at source');
  });

  it('asks for collections once, in the form, and not again in the source step', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();

    component.selectSourceItem(pride);
    fixture.detectChanges();

    // The form's own picker is the only one left. It sits behind the source
    // step, but the form is what the import reads, so it is the one that stays.
    expect(fixture.nativeElement.querySelectorAll('app-collection-picker').length).toBe(1);
  });

  it('shows the source cover as already handled and offers no upload on the import path', async () => {
    component.enterSourceMode();
    await fixture.whenStable();
    component.sourceQuery.set('pride');
    component.searchSource();
    await fixture.whenStable();

    component.selectSourceItem(pride);
    fixture.detectChanges();

    // The import brings both files itself. A dropped file on this path is
    // discarded without a word, so neither upload belongs here at all.
    const inputs = [
      ...fixture.nativeElement.querySelectorAll('input[type="file"]'),
    ] as HTMLInputElement[];
    expect(inputs.some((i) => (i.getAttribute('accept') ?? '').includes('.epub'))).toBe(false);
    expect(inputs.some((i) => i.getAttribute('accept') === 'image/*')).toBe(false);

    // It says what will happen instead of asking.
    expect(fixture.nativeElement.textContent).toContain('no file needed');

    // And the cover is shown, credited, and actually rendered — not merely
    // present in a hidden tab, which is the trap this suite fell into before.
    component.setTab('Files & Personal');
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.querySelector('.cover-from-source') as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(getComputedStyle(wrapper!).display).not.toBe('none');

    const preview = wrapper!.querySelector('img') as HTMLImageElement;
    expect(preview.getAttribute('src')).toBe(pride.coverUrl);
    expect(wrapper!.textContent).toContain('Project Gutenberg');
  });

  it('still offers both uploads for a hand-entered digital book, and names a chosen file', async () => {
    fixture.detectChanges();

    const formatTrigger = fixture.nativeElement.querySelector('#book-type') as HTMLButtonElement;
    formatTrigger.click();
    fixture.detectChanges();

    const ebookOption = Array.from(
      fixture.nativeElement.querySelectorAll(
        'app-dropdown [role="option"]',
      ) as NodeListOf<HTMLElement>,
    ).find((option) => option.textContent?.includes('E-Book')) as HTMLElement;
    ebookOption.click();
    fixture.detectChanges();

    component.setTab('Files & Personal');
    fixture.detectChanges();

    const inputs = [
      ...fixture.nativeElement.querySelectorAll('input[type="file"]'),
    ] as HTMLInputElement[];
    expect(inputs.some((i) => (i.getAttribute('accept') ?? '').includes('.epub'))).toBe(true);
    expect(inputs.some((i) => i.getAttribute('accept') === 'image/*')).toBe(true);

    // A chosen file names itself, so the zone never looks untouched.
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    component.selectedFile.set(file);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chosen-file')?.textContent).toContain('book.epub');
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

  it('closes modal, refreshes library, and toasts when import is accepted', async () => {
    vi.spyOn(providers, 'acquire').mockReturnValue(of(job()));
    const added = vi.fn();
    const closed = vi.fn();
    const toast = TestBed.inject(ToastService);
    const toastSpy = vi.spyOn(toast, 'success');
    component.bookAdded.subscribe(added);
    component.closeModal.subscribe(closed);

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    component.importSelected();

    expect(toastSpy).toHaveBeenCalledWith(
      'Import started — it will appear in your library when it finishes.',
    );
    expect(added).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('shows error when import fails to start', async () => {
    vi.spyOn(providers, 'acquire').mockReturnValue(
      throwError(() => ({ error: { detail: 'The import could not be started.' } })),
    );
    const closed = vi.fn();
    component.closeModal.subscribe(closed);

    component.enterSourceMode();
    await fixture.whenStable();
    component.selectSourceItem(pride);

    component.importSelected();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.source-error');
    expect(error.textContent).toContain('The import could not be started.');
    expect(closed).not.toHaveBeenCalled();
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
