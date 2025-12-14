import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'; // 👈 NEW
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { BooksService, Book } from '../services/books.services';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AddBookModal } from '../add-book-modal/add-book-modal';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';
import { SidebarCollections } from './sidebar-collections/sidebar-collections';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';
import { InfiniteScrollDirective } from '../directives/infinite-scroll.directive';
import {
  LucideAngularModule,
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
} from 'lucide-angular';

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
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
  changeDetection: ChangeDetectionStrategy.OnPush, // 👈 OPTIMIZATION
})
export class Library implements OnInit {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

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

  loading = signal(true);
  loadingMore = signal(false);

  // Pagination State
  currentPage = signal(1);
  pageSize = 20;
  totalItems = signal(0);

  // Data
  rawBooks = signal<Book[]>([]);
  collections = signal<Collection[]>([]);

  viewMode = signal<'list' | 'grid'>('grid');
  showAddModal = signal(false);

  // Search & Sort State
  searchQuery = signal('');
  activeSort = signal('lastread');
  private searchSubject = new Subject<string>();

  // Modal edit system
  showEditModal = signal(false);
  editTarget = signal<Book | null>(null);

  activeCollectionId = this.collectionsService.activeCollectionId;

  books = computed(() => {
    const all = this.rawBooks();
    const activeId = this.activeCollectionId();

    if (activeId) {
      return all.filter((b) => b.collectionId === activeId);
    }
    return all;
  });

  hasMoreBooks = computed(() => {
    return this.rawBooks().length < this.totalItems();
  });

  constructor() {
    // 1. Search Subscription (Auto-cleanup)
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed() // 👈 Safe
      )
      .subscribe((term) => {
        this.searchQuery.set(term);
        this.refreshBooks(true);
      });

    // 2. Query Params Subscription (Auto-cleanup)
    this.route.queryParams
      .pipe(takeUntilDestroyed()) // 👈 Safe
      .subscribe((params) => {
        // Only refresh if we have parameters or if it's strictly necessary to react to changes
        // This logic remains the same, just safely subscribed.
        this.refreshBooks(true);
      });

    // 3. Router Events (Auto-cleanup)
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed() // 👈 Safe
      )
      .subscribe(() => {
        if (this.router.url.startsWith('/library')) {
          const shouldShowSkeleton = this.rawBooks().length === 0;
          this.refreshBooks(true, shouldShowSkeleton);
        }
      });
  }

  ngOnInit(): void {
    // Moved subscriptions to constructor, just loading initial data here
    this.loadCollections();
  }

  refreshBooks(reset = true, showSkeleton = true): void {
    if (reset) {
      this.currentPage.set(1);
      if (showSkeleton) this.loading.set(true);
    } else {
      this.loadingMore.set(true);
    }

    const filter = this.route.snapshot.queryParams['filter'];
    const sort = this.activeSort();
    const search = this.searchQuery();
    const page = this.currentPage();

    // Note: HTTP Observables complete automatically, so they don't strictly need takeUntilDestroyed,
    // but it's good practice in complex flows. For simple GETs, it's optional.
    this.booksService
      .list({
        filter,
        sort,
        search,
        page,
        pageSize: this.pageSize,
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
        error: (err) => {
          console.error('Error loading books:', err);
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

  setSort(sort: string): void {
    this.activeSort.set(sort);
    this.refreshBooks(true);
  }

  loadCollections(): void {
    this.collectionsService.list().subscribe({
      next: (data) => this.collections.set(data),
      error: (err) => console.error('Error loading collections:', err),
    });
  }

  // ... (Keep Modal and Action methods exactly as they are)
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
    book.isFavorite = newStatus;
    this.booksService.update(book.id, { isFavorite: newStatus }).subscribe({
      error: () => {
        book.isFavorite = !newStatus;
        alert('Failed to update favorite status');
      },
    });
  }

  toggleFinished(book: Book, event: Event): void {
    event.stopPropagation();
    const isCurrentlyFinished = !!book.finishedAt;
    const newIsFinished = !isCurrentlyFinished;
    const oldFinishedAt = book.finishedAt;
    const oldProgress = book.progressPercent;

    book.finishedAt = newIsFinished ? new Date().toISOString() : null;
    book.progressPercent = newIsFinished ? 100 : book.progressPercent;

    this.booksService.update(book.id, { isFinished: newIsFinished }).subscribe({
      error: () => {
        book.finishedAt = oldFinishedAt;
        book.progressPercent = oldProgress;
        alert('Failed to update finished status');
      },
    });
  }

  updateRating(book: Book, newRating: number): void {
    const oldRating = book.rating;
    book.rating = newRating;
    this.booksService.update(book.id, { rating: newRating }).subscribe({
      error: () => {
        book.rating = oldRating;
        alert('Failed to update rating');
      },
    });
  }
}
