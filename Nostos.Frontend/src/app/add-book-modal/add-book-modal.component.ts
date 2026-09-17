import { Component, ElementRef, HostListener, OnDestroy, inject, input, output, signal, computed, effect, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { LucideAngularModule, X, Info, UploadIcon, Book, Layers, FileText, Trash2, Globe, Search, Download, AlertCircle, Check } from 'lucide-angular';
import { BooksService, Book as BookModel } from '../core/services/books.service';
import { ProvidersService } from '../core/services/providers.service';
import { ToastService } from '../core/services/toast.service';
import {
  ACQUISITION_FINISHED_STATES,
  ProviderAcquisition,
  ProviderItem,
  ProviderSummary,
} from '../core/dtos/provider.dtos';
import { Collection } from '../core/dtos/collection.dtos';
import { BookType } from '../core/dtos/book.dtos';
import { IconButtonComponent } from '../ui/icon-button/icon-button.component';
import { CollectionPickerComponent } from '../ui/collection-picker/collection-picker.component';

@Component({
  selector: 'app-add-book-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    IconButtonComponent,
    CollectionPickerComponent,
  ],
  templateUrl: './add-book-modal.component.html',
  styleUrl: './add-book-modal.component.css',
})
export class AddBookModal implements OnDestroy {
  private booksService = inject(BooksService);
  private providers = inject(ProvidersService);
  private router = inject(Router);
  private toast = inject(ToastService);

  // Inputs & Outputs
  isOpen = input.required<boolean>();
  collections = input.required<Collection[]>();
  book = input<BookModel | null>(null);
  closeModal = output<void>();
  bookAdded = output<void>();
  bookUpdated = output<BookModel>();
  deleteBook = output<void>();

  // Icons
  XIcon = X;
  UploadIcon = UploadIcon;
  InfoIcon = Info;
  Trash2Icon = Trash2;
  // Tab Icons
  GeneralIcon = Book;
  MetadataIcon = Layers;
  FileIcon = FileText;
  SourceIcon = Globe;
  SearchIcon = Search;
  DownloadIcon = Download;
  ErrorIcon = AlertCircle;
  CheckIcon = Check;

  // Tabs
  tabs = ['Book Info', 'Publishing', 'Files & Personal', 'From a Source'] as const;
  activeTab = signal<(typeof this.tabs)[number]>('Book Info');
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

  selectedFile: File | null = null;
  selectedCover: File | null = null;
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
        setTimeout(() => this.titleInput()?.nativeElement?.focus(), 0);
      } else {
        // Closing the dialog must stop the poll: otherwise a background timer
        // keeps hitting the API for a surface nobody is looking at.
        this.stopPolling();
      }
    });
  }

  setTab(tab: (typeof this.tabs)[number]) {
    this.activeTab.set(tab);
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
    this.selectedFile = null;
    this.selectedCover = null;
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
    this.selectedFile = null;
    this.selectedCover = null;
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
    this.selectedFile = input.files?.[0] ?? null;
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedCover = input.files?.[0] ?? null;
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
          if (this.selectedFile) this.handleFileUpload(createdBook);
          else this.uploadCoverIfNeeded(createdBook.id);
        },
        error: () => this.toast.error('Failed to create book'),
      });
    }
  }

  handleFileUpload(createdBook: BookModel): void {
    this.uploadStartTime = performance.now();
    this.booksService.uploadFile(createdBook.id, this.selectedFile!).subscribe({
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
    if (!this.selectedCover) {
      this.finishAdd();
      return;
    }
    this.booksService.uploadCover(bookId, this.selectedCover).subscribe({
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.closeModal.emit();
  }

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
  selectedAssetId = signal<string | null>(null);
  sourceCollectionIds = signal<string[]>([]);

  /** The live job, or null when nothing has been started. */
  acquisition = signal<ProviderAcquisition | null>(null);
  sourceImportError = signal<string | null>(null);

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  selectedProvider = computed(
    () => this.providerList().find((p) => p.id === this.selectedProviderId()) ?? null,
  );

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

  openSourceTab(): void {
    this.setTab('From a Source');
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
    this.sourceImportError.set(null);

    // Default to the source's own preferred asset, which is also what the
    // server would choose if no asset were named.
    const preferred = item.assets.find((asset) => asset.isPreferred) ?? item.assets[0];
    this.selectedAssetId.set(preferred?.id ?? null);
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
        collectionIds: this.sourceCollectionIds(),
      })
      .subscribe({
        next: (job) => {
          this.acquisition.set(job);
          this.startPolling(job.jobId);
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
        this.stopPolling();
        this.acquisition.set({ ...job, state: 'cancelled', stage: 'cancelled' });
      },
      error: () => this.stopPolling(),
    });
  }

  private startPolling(jobId: string): void {
    this.stopPolling();

    // A second is fine: the stages it reports change on the scale of whole
    // tracks, and the alternative is a socket for something the user watches
    // once.
    this.pollHandle = setInterval(() => {
      this.providers.job(jobId).subscribe({
        next: (job) => {
          this.acquisition.set(job);
          if (ACQUISITION_FINISHED_STATES.has(job.state)) {
            this.stopPolling();
            if (job.state === 'succeeded') this.finishImport(job);
          }
        },
        error: () => {
          // A job this server no longer knows about is the expected outcome of
          // a restart, so say so instead of polling a dead id forever.
          this.stopPolling();
          this.sourceImportError.set(
            'This import is no longer being tracked. It may have finished before the server restarted — check your library.',
          );
        },
      });
    }, 1000);
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /**
   * Only reached once the server reports the final file stored and the library
   * row attached — never merely because the downloads finished.
   */
  private finishImport(job: ProviderAcquisition): void {
    this.toast.success(job.message || 'Imported into your library.');
    this.bookAdded.emit();
    this.closeModal.emit();

    // The local library stays the destination, so the flow ends by opening the
    // book that was actually created (or the one already there).
    if (job.bookId) void this.router.navigate(['/library', job.bookId]);
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
    this.sourceCollectionIds.set([]);
    this.acquisition.set(null);
    this.sourceImportError.set(null);
    this.stopPolling();
  }

  private describeError(error: unknown, fallback: string): string {
    const body = (error as { error?: { detail?: string; title?: string } })?.error;
    return body?.detail || body?.title || fallback;
  }

  ngOnDestroy(): void {
    this.stopPolling();
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
