import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ChangeDetectionStrategy,
  effect,
  untracked,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { BooksService } from '../core/services/books.service';
import { CollectionsService } from '../core/services/collections.service';
import { Collection } from '../core/dtos/collection.dtos';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AddBookModal } from '../add-book-modal/add-book-modal.component';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';
import { SidebarCollections } from './sidebar-collections/sidebar-collections.component';
import { Book, EditionSummaryDto, PaginatedResponse } from '../core/dtos/book.dtos';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InfiniteScrollDirective } from '../core/directives/infinite-scroll.directive';
import { BookSort } from '../core/dtos/book.enums';
import { LibraryFilterService } from './library-filter.service';
import { LibraryPreferencesService } from '../core/services/library-preferences.service';
import { ToastService } from '../core/services/toast.service';
import {
  LucideAngularModule,
  LucideIconData,
  LayoutList,
  LayoutGrid,
  Plus,
  Trash2,
  Edit2,
  Book as BookIcon,
  Heart,
  CheckCircle,
  Search,
  ArrowUpDown,
  Loader2,
  X,
  Headphones,
  BookOpen,
  FileText,
  Bookmark,
} from 'lucide-angular';

/** Legacy key retained for callers that need to verify the migration path. */
export const VIEW_MODE_STORAGE_KEY = 'nostos.viewMode';

function statusFilterLabel(value: string | null | undefined): string | null {
  switch ((value ?? '').toLowerCase()) {
    case 'notstarted':
      return 'Not Started';
    case 'reading':
      return 'In Progress';
    case 'favorites':
      return 'Favorites';
    case 'finished':
      return 'Finished';
    case 'unsorted':
      return 'Unsorted';
    default:
      return null;
  }
}

function formatFilterLabel(value: string | null | undefined): string | null {
  switch ((value ?? '').toLowerCase()) {
    case 'audiobook':
    case 'audio':
      return 'Audiobooks';
    case 'ebook':
    case 'epub':
      return 'eBooks';
    case 'pdf':
      return 'PDFs';
    case 'physical':
      return 'Physical';
    default:
      return null;
  }
}

/**
 * Results cross-fade: the out-phase is the one duration TypeScript must honour
 * (it gates when the new page may be committed), so it lives here and must stay
 * equal to — never longer than — `--library-swap-out` in library.component.css,
 * or the DOM would swap while the old results are still moving.
 * The in-phase (300ms desktop / 260ms mobile, `--library-swap-in`) needs no TS
 * scheduler: it is purely the CSS release of `.is-swapping` once the commit lands.
 */
const SWAP_OUT_MS = 200;

/**
 * A skeleton that was on screen for less than this was never really perceived
 * (a fast or cached response). Cross-fading it would only add latency to a load
 * the user never saw, so below this threshold the first results commit at once.
 */
const SKELETON_SEEN_MS = 120;

/** True when the OS asks for reduced motion; the swap then commits instantly. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

type WorkFormatType = 'audio' | 'epub' | 'pdf' | 'physical';

interface WorkFormatGlyph {
  type: WorkFormatType;
  icon: LucideIconData;
  label: string;
}

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    LucideAngularModule,
    AddBookModal,
    ConfirmModal,
    StarRatingComponent,
    SidebarCollections,
    InfiniteScrollDirective,
  ],
  templateUrl: './library.component.html',
  styleUrls: ['./library.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Library implements OnInit, OnDestroy {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService);
  private preferences = inject(LibraryPreferencesService);
  private toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  readonly filters = inject(LibraryFilterService);

  // Icons
  ListIcon = LayoutList;
  GridIcon = LayoutGrid;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  BookIcon = BookIcon;
  HeartIcon = Heart;
  CheckCircleIcon = CheckCircle;
  SearchIcon = Search;
  XIcon = X;
  SortIcon = ArrowUpDown;
  LoaderIcon = Loader2;
  HeadphonesIcon = Headphones;
  BookOpenIcon = BookOpen;
  FileTextIcon = FileText;
  BookmarkIcon = Bookmark;

  // Enums for Template Access
  BookSort = BookSort;

  loading = signal(true);
  loadingMore = signal(false);

  /** True while the existing results blur out before the new page is swapped in. */
  swapping = signal(false);

  private requestSeq = 0;
  private swapStartedAt = 0;
  private skeletonStartedAt = 0;

  // Pagination State
  currentPage = signal(1);
  pageSize = this.preferences.pageSize;
  totalItems = signal(0);

  // Data
  rawBooks = signal<Book[]>([]);
  collections = signal<Collection[]>([]);

  @ViewChild(SidebarCollections) private sidebar?: SidebarCollections;

  viewMode = this.preferences.viewMode;
  readonly sidebarExpanded = this.preferences.sidebarExpanded;
  showAddModal = signal(false);

  toggleSidebar(): void {
    this.preferences.setSidebarExpanded(!this.sidebarExpanded());
  }

  setViewMode(mode: 'list' | 'grid'): void {
    this.preferences.setViewMode(mode);
  }

  // Search & Sort State
  searchQuery = signal('');

  activeSort = signal<BookSort>(this.preferences.sort());

  private searchSubject = new Subject<string>();

  // Modal edit & delete system
  showEditModal = signal(false);
  editTarget = signal<Book | null>(null);
  deleteTarget = signal<Book | null>(null);
  deletingBook = signal(false);

  /** The confirmation question, composed here so the modal stays generic. */
  deleteHeading = computed(() => {
    const target = this.deleteTarget();
    return target ? `Delete “${target.title}”?` : 'Delete book?';
  });

  books = computed(() => this.rawBooks());

  hasMoreBooks = computed(() => {
    return this.rawBooks().length < this.totalItems();
  });

  activeFilterChips = computed(() => {
    const chips: { key: string; label: string }[] = [];
    const status = statusFilterLabel(this.filters.status());
    if (status) chips.push({ key: 'status', label: status });
    const format = formatFilterLabel(this.filters.format());
    if (format) chips.push({ key: 'format', label: format });
    const collectionId = this.filters.collectionId();
    if (collectionId) {
      const name = this.collections().find((c) => c.id === collectionId)?.name ?? 'Collection';
      chips.push({ key: 'collection', label: name });
    }
    const search = this.searchQuery().trim();
    if (search) chips.push({ key: 'search', label: `"${search}"` });
    return chips;
  });

  clearChip(key: string): void {
    switch (key) {
      case 'status':
        this.filters.status.set('all');
        break;
      case 'format':
        this.filters.format.set('all');
        break;
      case 'collection':
        this.filters.collectionId.set(null);
        break;
      case 'search':
        this.searchQuery.set('');
        this.refreshBooks();
        break;
    }
  }

  constructor() {
    // Phones scroll the document itself. Reserve the styled scrollbar gutter for
    // as long as the library is mounted so a filter that returns a short or empty
    // result set cannot make the whole page jump sideways by 8px.
    this.document.body?.classList.add('nostos-library');

    // Returning from the Studio or the Second Brain rebuilds this component with
    // no results in hand. The user has already seen the library in this session,
    // so cross-fade the results in instead of flashing the skeleton again.
    if (this.preferences.hasLoadedBooks()) this.loading.set(false);

    // Search Subscription
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.searchQuery.set(term);
        this.refreshBooks();
      });

    // Filter-driven load: exactly one refresh per filter change.
    effect(() => {
      this.filters.status();
      this.filters.format();
      this.filters.collectionId();
      untracked(() => this.refreshBooks());
    });
  }

  ngOnInit(): void {
    this.loadCollections();
  }

  ngOnDestroy(): void {
    this.document.body?.classList.remove('nostos-library');
  }

  refreshBooks(reset = true, showSkeleton = true): void {
    if (reset) {
      this.currentPage.set(1);
      if (!this.preferences.hasLoadedBooks()) {
        // Genuine first paint: the skeleton's single legitimate use.
        if (showSkeleton) {
          this.loading.set(true);
          this.skeletonStartedAt = performance.now();
        }
      } else if (showSkeleton && !prefersReducedMotion()) {
        // Filter/sort/search change, or re-entering the library from another
        // section: fade the results through the swap instead of tearing them
        // down for a skeleton.
        // (Reduced motion skips the swap state entirely — no dimming, no blur.)
        this.swapping.set(true);
        this.swapStartedAt = performance.now();
      }
    } else {
      this.loadingMore.set(true);
    }

    const seq = ++this.requestSeq;
    const status = this.filters.status();
    const format = this.filters.format();
    const collectionId = this.filters.collectionId();
    const sort = this.activeSort();
    const search = this.searchQuery();
    const page = this.currentPage();
    // Mobile cover decoding is the dominant first-paint cost. Load a smaller
    // first batch there; the existing sentinel still fetches every book as the
    // user scrolls.
    const pageSize = window.innerWidth < 768 ? Math.min(this.pageSize(), 12) : this.pageSize();

    this.booksService
      .list({
        filter: status === 'all' ? undefined : status,
        sort,
        search,
        page,
        pageSize,
        collectionId: collectionId ?? undefined,
        groupByWork: this.preferences.groupByWork(),
        format: format === 'all' ? null : format,
      })
      .subscribe({
        next: (data) => {
          // A stale response must never paint over a newer request's results.
          if (seq !== this.requestSeq) return;
          this.commitResults(data, reset, seq);
        },
        error: () => {
          if (seq !== this.requestSeq) return;
          this.toast.error('Failed to load books');
          this.loading.set(false);
          this.loadingMore.set(false);
          this.swapping.set(false);
        },
      });
  }

  /**
   * Replaces the visible page. When the stage is blurred out, the commit is
   * deferred to the end of the out-phase so the DOM swap is never visible.
   * The swap itself is a pure signal flip, which is legal from any async
   * callback — the timer only co-ordinates the visual clock.
   */
  private commitResults(data: PaginatedResponse<Book>, reset: boolean, seq: number): void {
    const apply = () => {
      if (seq !== this.requestSeq) return;
      if (reset) {
        this.rawBooks.set(data.items);
      } else {
        this.rawBooks.update((current) => [...current, ...data.items]);
      }
      this.totalItems.set(data.totalCount);
      this.preferences.hasLoadedBooks.set(true);
      this.loading.set(false);
      this.loadingMore.set(false);
      this.swapping.set(false); // releases the in-phase: new books resolve in
    };

    if (!reset || prefersReducedMotion()) {
      apply();
      return;
    }

    // Only fade out something the user can actually see: real results, or a
    // skeleton that stayed up long enough to register. On a warm change the swap
    // state was already set when the request went out (network time counts
    // toward the out-phase); on a cold load the skeleton is what fades away.
    const skeletonWasSeen =
      this.loading() && performance.now() - this.skeletonStartedAt >= SKELETON_SEEN_MS;
    if (!skeletonWasSeen && this.rawBooks().length === 0) {
      // Nothing on screen to fade out — re-entry from another section, or a
      // response that beat the skeleton. Commit now; if the swap state is
      // already set, releasing it still fades the new results in.
      apply();
      return;
    }

    if (!this.swapping()) {
      this.swapping.set(true);
      this.swapStartedAt = performance.now();
    }

    // Network time already spent counts toward the out-phase, so a fast local
    // response still gets the full blur instead of a one-frame blink.
    const elapsed = performance.now() - this.swapStartedAt;
    setTimeout(apply, Math.max(0, SWAP_OUT_MS - elapsed));
  }

  loadMore(): void {
    if (!this.hasMoreBooks() || this.loadingMore()) return;

    this.currentPage.update((p) => p + 1);
    this.refreshBooks(false);
  }

  onSearch(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchSubject.next(val);
  }

  setSort(sort: BookSort | string): void {
    const parsedSort =
      sort && Object.values(BookSort).includes(sort as BookSort) ? (sort as BookSort) : null;
    if (!parsedSort) return;

    this.activeSort.set(parsedSort);
    this.preferences.setSort(parsedSort);
    this.refreshBooks(true);
  }

  loadCollections(): void {
    this.collectionsService.list().subscribe({
      next: (data) => this.collections.set(data),
      error: () => this.toast.error('Failed to load collections'),
    });
  }

  // ... (Modals and Actions remain unchanged)
  openAddModal(): void {
    this.showAddModal.set(true);
  }
  closeAddModal(): void {
    this.showAddModal.set(false);
  }
  openEditModal(book: Book): void {
    this.editTarget.set(book);
    this.showEditModal.set(true);
  }
  closeEditModal(): void {
    this.showEditModal.set(false);
    this.editTarget.set(null);
  }

  onBookUpdated(updated: Book): void {
    this.refreshBooks(true, false);
    this.refreshStatusCounts();
    this.closeEditModal();
  }

  onBookAdded(): void {
    this.refreshBooks();
    this.refreshStatusCounts();
  }

  private matchesActiveFilter(book: Book): boolean {
    switch (this.filters.status()) {
      case 'favorites':
        return book.isFavorite;
      case 'finished':
        return !!book.finishedAt;
      case 'reading':
        return !book.finishedAt && book.progressPercent > 0;
      case 'notstarted':
        return book.progressPercent === 0;
      case 'unsorted':
        return !book.collectionId;
      default:
        return true;
    }
  }

  private syncToggledBook(updated: Book): void {
    if (this.matchesActiveFilter(updated)) {
      this.rawBooks.update((books) => books.map((b) => (b.id === updated.id ? updated : b)));
    } else {
      this.rawBooks.update((books) => books.filter((b) => b.id !== updated.id));
      this.totalItems.update((c) => Math.max(0, c - 1));
    }
    this.refreshStatusCounts();
  }

  private refreshStatusCounts(): void {
    this.sidebar?.loadStatusCounts();
  }

  getFormatLabel(book: Book | EditionSummaryDto): string {
    const extension = book.fileName?.split('.').pop()?.trim().toLowerCase();
    if (extension) {
      return extension.toUpperCase();
    }

    const format = 'format' in book ? book.format?.trim().toLowerCase() : undefined;
    if (format) {
      switch (format) {
        case 'audiobook':
        case 'audio':
          return 'AUDIO';
        case 'ebook':
        case 'epub':
          return 'EPUB';
        case 'physical':
          return 'PHYSICAL';
        default:
          return format.toUpperCase();
      }
    }

    switch (book.type) {
      case 'audiobook':
        return 'AUDIO';
      case 'ebook':
        return 'EPUB';
      case 'physical':
        return 'PHYSICAL';
      default:
        return book.type.toUpperCase();
    }
  }

  getLibraryCoverUrl(coverUrl: string | null): string | null {
    if (!coverUrl) return null;
    return `${coverUrl}/thumbnail?width=320`;
  }

  /** Hero art in flight, keyed by URL, so a hover does not re-request it. */
  private readonly prefetchedCovers = new Map<string, HTMLImageElement>();

  /**
   * Warm the HTTP cache for a book's hero art as soon as the pointer signals
   * intent, so opening the detail page does not flash an empty dark band.
   *
   * The hero cannot start its own fetch until the book JSON arrives, because
   * `heroArtUrl` is derived from `coverUrl` — the two requests are serialised.
   * Prefetching on hover overlaps them, so by the time the click lands the 640px
   * thumbnail is in flight or already cached and the band paints on its first
   * frame. Costs nothing unless the user actually hovers.
   */
  prefetchHeroCover(coverUrl: string | null): void {
    if (!coverUrl) return;

    const url = `${coverUrl}/thumbnail?width=640`;
    if (this.prefetchedCovers.has(url)) return;

    const img = new Image();
    img.decoding = 'async';
    const release = () => this.prefetchedCovers.delete(url);
    img.addEventListener('load', release);
    img.addEventListener('error', release);
    img.src = url;
    // Hold a reference while in flight — an Image collected mid-request can have
    // the fetch cancelled before it reaches the cache.
    this.prefetchedCovers.set(url, img);
  }

  getBookRouteId(book: Book): string {
    return this.preferences.getActiveEditionId(book.workId, book.id);
  }

  getWorkFormatGlyphs(book: Book): WorkFormatGlyph[] {
    const editions: (Book | EditionSummaryDto)[] = [book, ...(book.otherEditions || [])];
    const presentFormats = new Set(editions.map((edition) => this.getWorkFormatType(edition)));
    const formats: WorkFormatGlyph[] = [
      { type: 'audio', icon: this.HeadphonesIcon, label: 'Audiobook' },
      { type: 'epub', icon: this.BookOpenIcon, label: 'eBook' },
      { type: 'pdf', icon: this.FileTextIcon, label: 'PDF' },
      { type: 'physical', icon: this.BookmarkIcon, label: 'Physical Book' },
    ];

    return formats.filter((format) => presentFormats.has(format.type));
  }

  getWorkFormatsTooltip(book: Book): string {
    const labels = this.getWorkFormatGlyphs(book).map((glyph) => glyph.label);
    return `Available in ${labels.join(', ')}`;
  }

  private getWorkFormatType(book: Book | EditionSummaryDto): WorkFormatType {
    const type = book.type.toLowerCase();
    const format = 'format' in book ? book.format?.trim().toLowerCase() : undefined;
    const extension = book.fileName?.split('.').pop()?.trim().toLowerCase();

    if (type === 'audiobook' || type === 'audio' || format === 'audiobook' || format === 'audio') {
      return 'audio';
    }
    if (type === 'physical' || format === 'physical') return 'physical';
    if (extension === 'pdf' || format === 'pdf' || type === 'pdf') return 'pdf';
    return 'epub';
  }

  openDeleteModal(book: Book, event?: Event): void {
    event?.stopPropagation();
    this.deleteTarget.set(book);
  }

  cancelDelete(): void {
    if (this.deletingBook()) return;
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target || this.deletingBook()) return;

    this.deletingBook.set(true);
    this.booksService.delete(target.id).subscribe({
      next: () => {
        this.rawBooks.update((books) => books.filter((b) => b.id !== target.id));
        this.totalItems.update((c) => Math.max(0, c - 1));
        this.refreshStatusCounts();
        this.toast.success(`"${target.title}" deleted`);
        this.deleteTarget.set(null);
        this.deletingBook.set(false);
      },
      error: () => {
        this.deletingBook.set(false);
        this.toast.error('Failed to delete book');
      },
    });
  }

  deleteBook(bookOrId: Book | string, event: Event): void {
    event.stopPropagation();
    if (typeof bookOrId === 'string') {
      const found = this.rawBooks().find((b) => b.id === bookOrId) ?? null;
      this.deleteTarget.set(found ?? ({ id: bookOrId, title: 'Book' } as Book));
    } else {
      this.deleteTarget.set(bookOrId);
    }
  }

  toggleFavorite(book: Book, event: Event): void {
    event.stopPropagation();
    const newStatus = !book.isFavorite;

    // Optimistic update via signal (creates new object reference for OnPush)
    this.rawBooks.update((books) =>
      books.map((b) => (b.id === book.id ? { ...b, isFavorite: newStatus } : b)),
    );

    this.booksService.update(book.id, { isFavorite: newStatus }).subscribe({
      next: (updated) => this.syncToggledBook(updated),
      error: () => {
        this.rawBooks.update((books) =>
          books.map((b) => (b.id === book.id ? { ...b, isFavorite: !newStatus } : b)),
        );
        this.toast.error('Failed to update favorite status');
      },
    });
  }

  toggleFinished(book: Book, event: Event): void {
    event.stopPropagation();
    const isCurrentlyFinished = !!book.finishedAt;
    const newIsFinished = !isCurrentlyFinished;
    const oldFinishedAt = book.finishedAt;
    const oldProgress = book.progressPercent;

    const newFinishedAt = newIsFinished ? new Date().toISOString() : null;
    const newProgress = newIsFinished ? 100 : book.progressPercent;

    // Optimistic update via signal
    this.rawBooks.update((books) =>
      books.map((b) =>
        b.id === book.id ? { ...b, finishedAt: newFinishedAt, progressPercent: newProgress } : b,
      ),
    );

    this.booksService.update(book.id, { isFinished: newIsFinished }).subscribe({
      next: (updated) => this.syncToggledBook(updated),
      error: () => {
        this.rawBooks.update((books) =>
          books.map((b) =>
            b.id === book.id
              ? { ...b, finishedAt: oldFinishedAt, progressPercent: oldProgress }
              : b,
          ),
        );
        this.toast.error('Failed to update finished status');
      },
    });
  }

  updateRating(book: Book, newRating: number): void {
    const oldRating = book.rating;

    // Optimistic update via signal
    this.rawBooks.update((books) =>
      books.map((b) => (b.id === book.id ? { ...b, rating: newRating } : b)),
    );

    this.booksService.update(book.id, { rating: newRating }).subscribe({
      error: () => {
        this.rawBooks.update((books) =>
          books.map((b) => (b.id === book.id ? { ...b, rating: oldRating } : b)),
        );
        this.toast.error('Failed to update rating');
      },
    });
  }
}
