import { Component, ElementRef, inject, input, output, signal, computed, effect, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { finalize } from 'rxjs';
import { BooksService, Book as BookModel } from '../core/services/books.service';
import { ProvidersService } from '../core/services/providers.service';
import { ImportService } from '../core/services/import.service';
import { ToastService } from '../core/services/toast.service';
import {
  ACQUISITION_FINISHED_STATES,
  ProviderAcquisition,
  ProviderItem,
  ProviderMetadataOverrides,
  ProviderSummary,
} from '../core/dtos/provider.dtos';
import { Collection } from '../core/dtos/collection.dtos';
import { BookType } from '../core/dtos/book.dtos';
import { IconButtonComponent } from '../ui/icon-button/icon-button.component';
import { CollectionPickerComponent } from '../ui/collection-picker/collection-picker.component';
import { ModalShell } from '../ui/modal-shell/modal-shell.component';
import { DialogActionsComponent } from '../ui/dialog-actions/dialog-actions.component';
import { ButtonComponent } from '../ui/button/button.component';
import { NostosIconComponent } from '../ui/icon/nostos-icon.component';
import { FormFieldComponent } from '../ui/form-field/form-field.component';
import { InputDirective, TextareaDirective } from '../ui/form-control/form-control.directive';
import { DropdownComponent, type DropdownOption } from '../ui/dropdown/dropdown.component';

@Component({
  selector: 'app-add-book-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NostosIconComponent,
    IconButtonComponent,
    CollectionPickerComponent,
    FormFieldComponent,
    InputDirective,
    DropdownComponent,
    TextareaDirective,
    ModalShell,
    DialogActionsComponent,
    ButtonComponent,
  ],
  templateUrl: './add-book-modal.component.html',
  styleUrl: './add-book-modal.component.css',
})
export class AddBookModal {
  readonly bookTypeOptions = [
    { value: 'physical', label: 'Physical Book' },
    { value: 'ebook', label: 'E-Book' },
    { value: 'audiobook', label: 'Audiobook' },
  ] satisfies readonly DropdownOption[];
  private booksService = inject(BooksService);
  private providers = inject(ProvidersService);
  private toast = inject(ToastService);
  /** The import feed: opened on demand once an import has actually been queued. */
  private imports = inject(ImportService);

  // Inputs & Outputs
  isOpen = input.required<boolean>();

  /** Open straight into the source search, for "Import from a source". */
  sourceFirst = input<boolean>(false);
  collections = input.required<Collection[]>();
  book = input<BookModel | null>(null);
  closeModal = output<void>();
  bookAdded = output<void>();
  bookUpdated = output<BookModel>();
  deleteBook = output<void>();

  // Tabs. Importing is no longer one of them: "where does this book come from"
  // is answered before the form, not inside it (see `sourceMode`).
  tabs = ['Book Info', 'Publishing', 'Files & Personal'] as const;
  activeTab = signal<(typeof this.tabs)[number]>('Book Info');

  /**
   * The source search, shown on its own before the form rather than as a fourth
   * tab — the answer decides what the form is even for.
   */
  sourceMode = signal(false);
  private titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  // Computed State
  isEditMode = computed(() => !!this.book());
  isFetching = signal(false);

  // Form State
  form = {
    type: 'physical' as BookType,
    title: '',
    subtitle: '' as string | null,

    author: '' as string | null,
    editor: '' as string | null,
    translator: '' as string | null,
    narrator: '' as string | null,

    description: '' as string | null,

    isbn: '' as string | null,
    asin: '' as string | null,

    publisher: '' as string | null,
    placeOfPublication: '' as string | null,
    publishedDate: '' as string | null,

    edition: '' as string | null,
    pageCount: null as number | null,
    duration: '' as string | null,
    language: 'en',
    categories: '' as string | null,
    series: '' as string | null,
    volumeNumber: '' as string | null,
    // Membership is a set: a book may belong to any number of collections.
    // The picker owns the checkbox list; this array is the value it edits.
    collectionIds: [] as string[],

    personalReview: '' as string | null,
  };

  selectedFile = signal<File | null>(null);
  selectedCover = signal<File | null>(null);

  /**
   * What the cover zone shows: an object URL for a locally chosen file — which
   * is ours to release — or the provider's URL when the cover comes from the
   * source. A source-seeded form deliberately does NOT set a File: the import
   * fetches and stores the provider's cover server-side (`IncludeCover` defaults
   * to true), so there is nothing for the browser to upload. A File set here on
   * that path would be silently discarded, because the import never calls the
   * cover upload.
   */
  coverPreview = signal<string | null>(null);

  /** The picked book's cover, shown as already handled on the import path. */
  sourceCoverUrl = computed(() => this.selectedSourceItem()?.coverUrl ?? null);

  /** A chosen book file, so the zone never looks empty after a choice. */
  fileSummary = computed(() => {
    const file = this.selectedFile();
    if (!file) return null;
    const size = this.formatBytes(file.size);
    return size ? `${file.name} · ${size}` : file.name;
  });
  uploadProgress = signal<number | null>(null);
  uploadStartTime: number | null = null;

  // Drag-over highlight for the two dropzones. The native file input stretched
  // across each zone still owns the actual drop, so these only toggle styling.
  fileDragActive = signal(false);
  coverDragActive = signal(false);

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        const currentBook = this.book();
        if (currentBook) {
          this.fillForm(currentBook);
        } else {
          this.resetForm();
        }
        // An edit never starts at the source search: importing is a way to ADD a
        // book, and there is nothing to search for when changing one. Routed
        // through `enterSourceMode` so the providers are loaded either way.
        if (this.sourceFirst() && !currentBook) {
          this.enterSourceMode();
        } else {
          this.sourceMode.set(false);
        }
        setTimeout(() => this.titleInput()?.nativeElement?.focus(), 0);
      }
    });
  }

  setTab(tab: (typeof this.tabs)[number]) {
    this.activeTab.set(tab);
  }

  onTabKeydown(event: KeyboardEvent, tab: (typeof this.tabs)[number]): void {
    const currentIndex = this.tabs.indexOf(tab);
    let nextIndex: number | null = null;

    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = this.tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.activeTab.set(this.tabs[nextIndex]);

    const tablist = (event.currentTarget as HTMLElement | null)?.closest('[role="tablist"]');
    const tabs = tablist?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.item(nextIndex).focus();
  }

  onTypeChange(type: BookType): void {
    this.form.type = type;

    // A file belongs to a digital edition, never to a physical metadata record.
    // Clear a previously chosen file when switching back to Physical so it
    // cannot be carried invisibly into a later submit.
    if (type === 'physical') {
      this.selectedFile.set(null);
      this.fileDragActive.set(false);
    }
  }

  fillForm(b: BookModel) {
    this.form = {
      type: b.type || 'physical',
      title: b.title,
      subtitle: b.subtitle || '',

      author: b.author,
      editor: b.editor || '',
      translator: b.translator || '',
      narrator: b.narrator || '',

      description: b.description || '',

      isbn: b.isbn || '',
      asin: b.asin || '',

      publisher: b.publisher || '',
      placeOfPublication: b.placeOfPublication || '',
      publishedDate: b.publishedDate || '',

      edition: b.edition || '',
      pageCount: b.pageCount || null,
      duration: b.duration || '',
      language: b.language || 'en',
      categories: b.categories || '',
      series: b.series || '',
      volumeNumber: b.volumeNumber || '',
      collectionIds: b.collectionIds ?? [],

      personalReview: b.personalReview || '',
    };
    this.clearChosenFiles();
    this.activeTab.set('Book Info'); // Reset to first tab
    this.resetSourceTab();
  }

  resetForm(): void {
    this.form = {
      type: 'physical',
      title: '',
      subtitle: null,

      author: null,
      editor: null,
      translator: null,
      narrator: null,

      description: null,

      isbn: null,
      asin: null,

      publisher: null,
      placeOfPublication: null,
      publishedDate: null,

      edition: null,
      pageCount: null,
      duration: null,
      language: 'en',
      categories: null,
      series: null,
      volumeNumber: null,
      collectionIds: [],

      personalReview: null,
    };
    this.clearChosenFiles();
    this.uploadProgress.set(null);
    this.isFetching.set(false);
    this.fileDragActive.set(false);
    this.coverDragActive.set(false);
    this.activeTab.set('Book Info');
    // The source tab holds its own search, selection and job state; a stale
    // poll from a previous visit must not survive into this one.
    this.resetSourceTab();
  }

  /**
   * Helper to format dates into YYYY or YYYY-MM-DD
   */
  sanitizeDate(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const clean = dateStr.trim();

    // 1. If it's already just a year (e.g. "1999"), keep it.
    if (/^\d{4}$/.test(clean)) return clean;

    // 2. Try parsing as a standard date (handles "Jan 1, 2020", "2020/01/01")
    const timestamp = Date.parse(clean);
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
    }

    // 3. Fallback: Try to just find a 4-digit year in the string
    const yearMatch = clean.match(/\d{4}/);
    return yearMatch ? yearMatch[0] : clean;
  }

  /**
   * Helper to clean ISBNs (remove dashes, spaces, keep only digits and X)
   */
  sanitizeIsbn(isbn: string | null): string | null {
    if (!isbn) return null;
    // Removes anything that is NOT a digit or 'X', and uppercases it
    return isbn.replace(/[^0-9X]/gi, '').toUpperCase();
  }

  fetchMetadata(): void {
    // 1. Clean the ISBN immediately
    this.form.isbn = this.sanitizeIsbn(this.form.isbn);
    const isbn = this.form.isbn;

    if (!isbn) return;
    this.isFetching.set(true);

    this.booksService
      .lookup(isbn)
      .pipe(finalize(() => this.isFetching.set(false)))
      .subscribe({
        next: (data) => {
          this.form = {
            ...this.form,
            title: data.title || this.form.title,
            subtitle: data.subtitle || this.form.subtitle,
            author: data.author || this.form.author,
            // Note: Editor usually isn't returned clearly by basic lookup, but Place is:
            description: data.description || this.form.description,
            publisher: data.publisher || this.form.publisher,
            placeOfPublication: data.placeOfPublication || this.form.placeOfPublication, // <--- Map from API
            // Sanitize the date coming from the API
            publishedDate: this.sanitizeDate(data.publishedDate) || this.form.publishedDate,
            pageCount: data.pageCount || this.form.pageCount,
            language: this.getFullLanguageName(data.language) || this.form.language,
            categories: data.categories || this.form.categories,
          };
          this.toast.success('Metadata fetched successfully.');
        },
        error: () => this.toast.error('Book details not found.'),
      });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  onCoverSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.setCoverPreview(file);
    this.selectedCover.set(file);
  }

  /** Object URLs are ours to release, and the modal is opened many times. */
  private setCoverPreview(file: File | null): void {
    const previous = this.coverPreview();
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    this.coverPreview.set(file ? URL.createObjectURL(file) : null);
  }

  /** Both reset paths clear the chosen file, the cover, and the preview URL. */
  private clearChosenFiles(): void {
    this.selectedFile.set(null);
    this.setCoverPreview(null);
    this.selectedCover.set(null);
  }

  onDragOver(_event: DragEvent, zone: 'file' | 'cover'): void {
    // Do not preventDefault: the native <input type="file"> is the real drop
    // target and must populate its file list on drop.
    if (zone === 'file') this.fileDragActive.set(true);
    else this.coverDragActive.set(true);
  }

  onDragLeave(_event: DragEvent, zone: 'file' | 'cover'): void {
    if (zone === 'file') this.fileDragActive.set(false);
    else this.coverDragActive.set(false);
  }

  submit(): void {
    if (!this.form.title.trim()) return;

    // A chosen source item turns the form into the import's own confirmation:
    // the download starts from the values on screen rather than from what the
    // source said. A hand-typed book and an edit both still go to the library.
    if (this.seededFromSource()) {
      this.importSelected();
      return;
    }

    // Sanitize Language
    if (this.form.language) {
      this.form.language = this.getFullLanguageName(this.form.language) || this.form.language;
    }

    // Sanitize Date
    const cleanDate = this.sanitizeDate(this.form.publishedDate);

    // Sanitize ISBN (in case user typed it and hit save directly)
    this.form.isbn = this.sanitizeIsbn(this.form.isbn);

    // Membership is sent as the authoritative set from the picker. No singular
    // mirror is written any more — the column is gone, so sending one would be
    // a dead field on the wire.
    const payload = { ...this.form, publishedDate: cleanDate || null };

    if (this.isEditMode()) {
      this.booksService.update(this.book()!.id, payload).subscribe({
        next: (updated) => {
          this.bookUpdated.emit(updated);
          this.closeModal.emit();
        },
        error: () => this.toast.error('Failed to update book'),
      });
    } else {
      this.booksService.create(payload).subscribe({
        next: (createdBook) => {
          if (this.form.type !== 'physical' && this.selectedFile()) {
            this.handleFileUpload(createdBook);
          } else {
            this.uploadCoverIfNeeded(createdBook.id);
          }
        },
        error: () => this.toast.error('Failed to create book'),
      });
    }
  }

  handleFileUpload(createdBook: BookModel): void {
    this.uploadStartTime = performance.now();
    this.booksService.uploadFile(createdBook.id, this.selectedFile()!).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const percent = Math.round((event.loaded / (event.total ?? 1)) * 100);
          this.uploadProgress.set(percent);
        }
        if (event.type === HttpEventType.Response) {
          const elapsed = performance.now() - (this.uploadStartTime ?? 0);
          setTimeout(
            () => {
              this.uploadProgress.set(null);
              this.uploadCoverIfNeeded(createdBook.id);
            },
            Math.max(0, 1200 - elapsed),
          );
        }
      },
      error: () => this.uploadProgress.set(null),
    });
  }

  uploadCoverIfNeeded(bookId: string) {
    const cover = this.selectedCover();
    if (!cover) {
      this.finishAdd();
      return;
    }
    this.booksService.uploadCover(bookId, cover).subscribe({
      next: (event) => {
        if (event.type === 4) this.finishAdd();
      },
      error: () => this.finishAdd(),
    });
  }

  finishAdd() {
    this.resetForm();
    this.closeModal.emit();
    this.bookAdded.emit();
  }

  // Escape and the backdrop now belong to `app-modal-shell`, which emits
  // `closed`; both were hand-rolled here before.

  // ------------------------------------------------------------------
  // From a source (issue #167)
  // ------------------------------------------------------------------
  // An acquisition surface, not a second library. Its whole job is to put a
  // file into the user's own library and then get out of the way — so there is
  // no feed, no recommendations and no browsing beyond the search the user
  // actually asked for.

  providerList = signal<ProviderSummary[]>([]);
  providersLoading = signal(false);
  providersError = signal<string | null>(null);
  selectedProviderId = signal<string | null>(null);

  sourceQuery = signal('');
  sourceResults = signal<ProviderItem[]>([]);
  sourceNotice = signal<string | null>(null);
  sourceHasMore = signal(false);
  sourceSearching = signal(false);
  sourceSearched = signal(false);
  sourceSearchError = signal<string | null>(null);

  selectedItem = signal<ProviderItem | null>(null);

  /**
   * The asset that will actually be imported, named in the collapsed summary so
   * the answer is visible without opening the list.
   */
  selectedAssetLabel = computed(() => {
    const item = this.selectedSourceItem();
    if (!item) return '';

    const id = this.selectedAssetId();
    const asset =
      item.assets.find((a) => a.id === id) ??
      item.assets.find((a) => a.isPreferred) ??
      item.assets[0];
    if (!asset) return '';

    const size = this.formatBytes(asset.sizeBytes);
    return size ? `${asset.label} · ${size}` : asset.label;
  });
  /**
   * The catalogue's rights text, minus the full stop it ends with: the line
   * finishes with the attribution in parentheses, so the source's own terminal
   * punctuation would sit mid-sentence. Only the final one is dropped — any
   * full stops inside the statement are the source's and stay.
   */
  rightsText = computed(() => {
    const statement = this.selectedSourceItem()?.rightsStatement ?? '';
    return statement.trim().replace(/\.+$/, '');
  });

  /** The full item behind the selected result: this is what carries the assets. */
  selectedDetail = signal<ProviderItem | null>(null);
  selectedAssetId = signal<string | null>(null);

  /**
   * The picked result with its assets. A search result carries none of its own,
   * so the fetched detail wins as soon as it arrives and the thin search result
   * is only a stand-in until then.
   */
  selectedSourceItem = computed(() => this.selectedDetail() ?? this.selectedItem());

  /** The live job, or null when nothing has been started. */
  acquisition = signal<ProviderAcquisition | null>(null);
  sourceImportError = signal<string | null>(null);


  selectedProvider = computed(
    () => this.providerList().find((p) => p.id === this.selectedProviderId()) ?? null,
  );

  /**
   * True when the form was seeded from a source item, which is what turns the
   * primary action into "Import" instead of "Create".
   */
  seededFromSource = computed(() => !this.isEditMode() && this.selectedItem() !== null);

  /** The name of the source the form was seeded from, for the banner. */
  seededSourceName = computed(() => this.selectedProvider()?.displayName ?? 'the source');

  /** Non-null only while an import is actually in flight. */
  runningAcquisition = computed(() => {
    const job = this.acquisition();
    return job && !ACQUISITION_FINISHED_STATES.has(job.state) ? job : null;
  });

  /**
   * Human wording for the pipeline's stage names. The stages are deliberately
   * coarse and stable so the client never has to know which source is running.
   */
  private readonly stageLabels: Record<string, string> = {
    queued: 'Queued',
    starting: 'Starting',
    resolving: 'Contacting the source',
    checking: 'Checking your library',
    downloading: 'Downloading',
    validating: 'Validating the download',
    assembling: 'Preparing the file',
    importing: 'Adding to your library',
    done: 'Finished',
    failed: 'Failed',
  };

  stageLabel(job: ProviderAcquisition): string {
    return this.stageLabels[job.stage] ?? job.stage;
  }

  formatBytes(bytes: number | null): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Show the source search on its own, before the form.
   *
   * Reached from "Import from a source". The user searches, picks a result, and
   * the form opens prefilled — so the metadata is reviewed and completed before
   * anything is downloaded.
   */
  enterSourceMode(): void {
    if (this.isEditMode()) return;

    this.sourceMode.set(true);
    if (this.providerList().length === 0 && !this.providersLoading()) this.loadProviders();
  }

  private loadProviders(): void {
    this.providersLoading.set(true);
    this.providersError.set(null);

    this.providers
      .list()
      .pipe(finalize(() => this.providersLoading.set(false)))
      .subscribe({
        next: (list) => {
          this.providerList.set(list);
          if (!this.selectedProviderId() && list.length > 0) {
            this.selectedProviderId.set(list[0].id);
          }
          if (list.length === 0) {
            this.providersError.set('No content sources are configured on this server.');
          }
        },
        error: () => this.providersError.set('Could not load the available sources.'),
      });
  }

  chooseProvider(id: string): void {
    if (id === this.selectedProviderId()) return;

    // Results belong to the source that produced them.
    this.selectedProviderId.set(id);
    this.clearSourceResults();
  }

  searchSource(): void {
    const providerId = this.selectedProviderId();
    const query = this.sourceQuery().trim();
    if (!providerId || query.length < 2 || this.sourceSearching()) return;

    this.sourceSearching.set(true);
    this.sourceSearchError.set(null);
    this.selectedItem.set(null);
    this.selectedAssetId.set(null);

    this.providers
      .search(providerId, query)
      .pipe(finalize(() => this.sourceSearching.set(false)))
      .subscribe({
        next: (result) => {
          this.sourceResults.set(result.items);
          this.sourceNotice.set(result.notice);
          this.sourceHasMore.set(result.hasMore);
          this.sourceSearched.set(true);
        },
        error: (error) => {
          this.sourceResults.set([]);
          this.sourceNotice.set(null);
          this.sourceSearched.set(true);
          this.sourceSearchError.set(
            this.describeError(error, 'That source could not be searched right now.'),
          );
        },
      });
  }

  selectSourceItem(item: ProviderItem): void {
    this.selectedItem.set(item);
    this.selectedDetail.set(null);
    this.sourceImportError.set(null);

    // Default to the source's own preferred asset, which is also what the
    // server would choose if no asset were named.
    const preferred = item.assets.find((asset) => asset.isPreferred) ?? item.assets[0];
    this.selectedAssetId.set(preferred?.id ?? null);

    // A search result carries no assets, which is why the import action is
    // disabled until the full item has been fetched. Without this it stays
    // disabled for every result a search returns.
    const providerId = this.selectedProviderId();
    if (!providerId) return;

    this.providers.item(providerId, item.externalId).subscribe({
      next: (detail) => {
        // A late response for a result the user has moved on from must not
        // overwrite what they are looking at now.
        if (this.selectedItem()?.externalId !== detail.externalId) return;

        this.selectedDetail.set(detail);
        const preferredDetail = detail.assets.find((a) => a.isPreferred) ?? detail.assets[0];
        this.selectedAssetId.set(preferredDetail?.id ?? null);
      },
      error: () =>
        this.sourceImportError.set(
          "That book's details could not be loaded, so it cannot be imported right now.",
        ),
    });
  }

  /**
   * Turn the chosen item into a prefilled form, instead of importing it on the
   * spot.
   *
   * Importing and adding were the same job split across two surfaces: the source
   * tab created a book from the source's metadata and closed, so anything the
   * user wanted to add — a collection, a corrected author, their own note — meant
   * finding the book afterwards and editing it. Seeding the form means the
   * metadata is reviewed and completed BEFORE anything is downloaded, and the
   * import carries the result, so the book is created once and already right.
   */
  seedFromSelectedItem(): void {
    const item = this.selectedSourceItem();
    if (!item) return;

    // Collections are deliberately not offered here: the form that follows has
    // its own picker, and the same question twice is one too many.
    const asset = item.assets.find((a) => a.isPreferred) ?? item.assets[0];

    this.form.title = item.title ?? '';
    this.form.subtitle = item.subtitle ?? '';
    this.form.author = item.author ?? '';
    this.form.narrator = item.narrator ?? '';
    this.form.description = item.description ?? '';
    this.form.language = item.language ?? 'en';
    this.form.publisher = item.publisher ?? '';
    this.form.publishedDate = item.publishedDate ?? '';
    this.form.categories = item.categories ?? '';
    this.form.duration = item.duration ?? '';
    this.form.pageCount = item.pageCount;

    // The type follows what is actually being fetched. An audiobook asset makes
    // an audiobook; guessing otherwise would file it where no reader can open it.
    if (asset?.kind === 'audiobook') this.form.type = 'audiobook';
    else if (asset?.kind === 'ebook') this.form.type = 'ebook';

    this.sourceImportError.set(null);
    this.acquisition.set(null);
    // The search has done its job: the form is the rest of the flow.
    this.sourceMode.set(false);
    this.setTab('Book Info');
  }

  /**
   * Only what the user actually changed, keyed for the server.
   *
   * An untouched field goes as null so the source still owns it: echoing the
   * whole form back would pin every value to this moment and a later
   * correction at the source could never reach the library. An emptied field
   * goes as an empty string, which the server reads as "clear it".
   */
  private buildOverrides(): ProviderMetadataOverrides {
    const item = this.selectedSourceItem();
    if (!item) return {};

    const againstSource = (
      fromForm: string | null | undefined,
      fromSource: string | null | undefined,
    ): string | null => {
      const entered = (fromForm ?? '').trim();
      return entered === (fromSource ?? '').trim() ? null : entered;
    };

    return {
      title: againstSource(this.form.title, item.title),
      subtitle: againstSource(this.form.subtitle, item.subtitle),
      author: againstSource(this.form.author, item.author),
      narrator: againstSource(this.form.narrator, item.narrator),
      description: againstSource(this.form.description, item.description),
      language: againstSource(this.form.language, item.language),
      publisher: againstSource(this.form.publisher, item.publisher),
      publishedDate: againstSource(this.form.publishedDate, item.publishedDate),
      categories: againstSource(this.form.categories, item.categories),
      duration: againstSource(this.form.duration, item.duration),
      pageCount: this.form.pageCount === item.pageCount ? null : this.form.pageCount,
    };
  }

  importSelected(): void {
    const item = this.selectedItem();
    const providerId = this.selectedProviderId();
    if (!item || !providerId || this.runningAcquisition()) return;

    this.sourceImportError.set(null);
    this.acquisition.set(null);

    this.providers
      .acquire(providerId, {
        externalId: item.externalId,
        assetId: this.selectedAssetId(),
        collectionIds: this.form.collectionIds,
        metadataOverrides: this.buildOverrides(),
      })
      .subscribe({
        next: () => {
          this.toast.success(
            'Import started — it will appear in your library when it finishes.',
          );
          // The feed is opened here, on demand: the user just created work to
          // watch, so the "Imports in Progress" section starts following it before
          // the modal is even gone. Nothing in the library query is refetched.
          this.imports.ensureConnected();
          this.bookAdded.emit();
          this.closeModal.emit();
        },
        error: (error) =>
          this.sourceImportError.set(
            this.describeError(error, 'The import could not be started.'),
          ),
      });
  }

  cancelImport(): void {
    const job = this.runningAcquisition();
    if (!job) return;

    this.providers.cancel(job.jobId).subscribe({
      next: () => {
        this.acquisition.set({ ...job, state: 'cancelled', stage: 'cancelled' });
      },
      error: () => undefined,
    });
  }

  private clearSourceResults(): void {
    this.sourceResults.set([]);
    this.sourceNotice.set(null);
    this.sourceHasMore.set(false);
    this.sourceSearched.set(false);
    this.sourceSearchError.set(null);
    this.selectedItem.set(null);
    this.selectedAssetId.set(null);
  }

  private resetSourceTab(): void {
    this.clearSourceResults();
    this.sourceQuery.set('');
    this.acquisition.set(null);
    this.sourceImportError.set(null);
  }

  private describeError(error: unknown, fallback: string): string {
    const body = (error as { error?: { detail?: string; title?: string } })?.error;
    return body?.detail || body?.title || fallback;
  }

  /**
   * The facts that decide between two recordings of the same work: who reads
   * it, how long it is and how many sections it has. Empty for an ebook, so a
   * Gutenberg row renders exactly as it did.
   */
  sourceFacts(item: ProviderItem): string {
    return [
      item.narrator ? `Narrated by ${item.narrator}` : null,
      item.duration,
      item.partCount && item.partCount > 1 ? `${item.partCount} sections` : null,
    ]
      .filter((part): part is string => !!part)
      .join(' · ');
  }

  private getFullLanguageName(input: string | null): string | null {
    if (!input) return null;
    const clean = input.trim();
    if (clean.length > 3) return clean;
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(clean) || clean;
    } catch (e) {
      return clean;
    }
  }
}
