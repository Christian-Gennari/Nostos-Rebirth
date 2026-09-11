import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
  effect,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BooksService } from '../core/services/books.service';
import { CollectionsService } from '../core/services/collections.service';
import { Collection } from '../core/dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AddBookModal } from '../add-book-modal/add-book-modal.component';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';
import { SidebarCollections } from './sidebar-collections/sidebar-collections.component';
import { Book, EditionSummaryDto } from '../core/dtos/book.dtos';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { InfiniteScrollDirective } from '../core/directives/infinite-scroll.directive';
import { BookSort } from '../core/dtos/book.enums';
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
  Headphones,
  BookOpen,
  FileText,
  Bookmark,
} from 'lucide-angular';

/** Legacy key retained for callers that need to verify the migration path. */
export const VIEW_MODE_STORAGE_KEY = 'nostos.viewMode';

function parseBookSort(value: string | null): BookSort | null {
  return value && Object.values(BookSort).includes(value as BookSort)
    ? (value as BookSort)
    : null;
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
    StarRatingComponent,
    SidebarCollections,
    InfiniteScrollDirective,
  ],
  templateUrl: './library.component.html',
  styleUrls: ['./library.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Library implements OnInit {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService);
  private preferences = inject(LibraryPreferencesService);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);

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

  // Pagination State
  currentPage = signal(1);
  pageSize = this.preferences.pageSize;
  totalItems = signal(0);

  // Data
  rawBooks = signal<Book[]>([]);
  collections = signal<Collection[]>([]);

  viewMode = this.preferences.viewMode;
  showAddModal = signal(false);

  setViewMode(mode: 'list' | 'grid'): void {
    this.preferences.setViewMode(mode);
  }

  // Search & Sort State
  searchQuery = signal('');

  activeSort = signal<BookSort>(
    parseBookSort(this.route.snapshot.queryParamMap.get('sort')) ?? this.preferences.sort(),
  );

  private searchSubject = new Subject<string>();

  // Modal edit system
  showEditModal = signal(false);
  editTarget = signal<Book | null>(null);

  // The URL owns selection: /library?collection=<id>&filter=<name>&format=<format>.
  // The one source of truth for collection-driven loads is the route queryParamMap.
  readonly urlSelection = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => ({
        collection: params.get('collection'),
        filter: params.get('filter'),
        sort: params.get('sort'),
        format: params.get('format'),
      })),
      distinctUntilChanged(
        (a, b) =>
          a.collection === b.collection &&
          a.filter === b.filter &&
          a.sort === b.sort &&
          a.format === b.format,
      ),
    ),
    {
      initialValue: {
        collection: this.route.snapshot.queryParamMap.get('collection'),
        filter: this.route.snapshot.queryParamMap.get('filter'),
        sort: this.route.snapshot.queryParamMap.get('sort'),
        format: this.route.snapshot.queryParamMap.get('format'),
      },
    },
  );

  books = computed(() => this.rawBooks());

  hasMoreBooks = computed(() => {
    return this.rawBooks().length < this.totalItems();
  });

  constructor() {
    // Search Subscription
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.searchQuery.set(term);
        this.refreshBooks();
      });

    // URL-driven load: exactly one refresh per collection/filter/sort change.
    effect(() => {
      const selection = this.urlSelection();
      untracked(() => {
        const routeSort = parseBookSort(selection.sort);
        if (routeSort) this.activeSort.set(routeSort);
        this.refreshBooks();
      });
    });
  }

  ngOnInit(): void {
    this.loadCollections();
  }

  refreshBooks(reset = true, showSkeleton = true): void {
    if (reset) {
      this.currentPage.set(1);
      if (showSkeleton) this.loading.set(true);
    } else {
      this.loadingMore.set(true);
    }

    const { collection, filter, format } = this.urlSelection();
    const sort = this.activeSort();
    const search = this.searchQuery();
    const page = this.currentPage();
    // Mobile cover decoding is the dominant first-paint cost. Load a smaller
    // first batch there; the existing sentinel still fetches every book as the
    // user scrolls.
    const pageSize = window.innerWidth < 768 ? Math.min(this.pageSize(), 12) : this.pageSize();

    this.booksService
      .list({
        filter: filter ?? undefined,
        sort,
        search,
        page,
        pageSize,
        collectionId: collection ?? undefined,
        groupByWork: this.preferences.groupByWork(),
        format,
      })
      .subscribe({
        next: (data) => {
          if (reset) {
            this.rawBooks.set(data.items);
          } else {
            this.rawBooks.update((current) => [...current, ...data.items]);
          }

          this.totalItems.set(data.totalCount);
          this.loading.set(false);
          this.loadingMore.set(false);
        },
        error: () => {
          this.toast.error('Failed to load books');
          this.loading.set(false);
          this.loadingMore.set(false);
        },
      });
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
    const parsedSort = parseBookSort(sort);
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
    this.closeEditModal();
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

  deleteBook(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this book?')) return;
    this.booksService.delete(id).subscribe({
      next: () => {
        this.rawBooks.update((books) => books.filter((b) => b.id !== id));
        this.totalItems.update((c) => c - 1);
      },
    });
  }

  toggleFavorite(book: Book, event: Event): void {
    event.stopPropagation();
    const newStatus = !book.isFavorite;

    // Optimistic update via signal (creates new object reference for OnPush)
    this.rawBooks.update((books) =>
      books.map((b) => (b.id === book.id ? { ...b, isFavorite: newStatus } : b)),
    );

    this.booksService.update(book.id, { isFavorite: newStatus }).subscribe({
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
