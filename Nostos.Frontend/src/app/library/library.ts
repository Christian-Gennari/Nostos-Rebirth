import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router'; // Added Router, NavigationEnd
import { BooksService, Book } from '../services/books.services';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AddBookModal } from '../add-book-modal/add-book-modal';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs/operators'; // Added filter
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
  ],
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
})
export class Library implements OnInit {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router); // Inject Router

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

  loading = signal(true);

  rawBooks = signal<Book[]>([]);
  collections = signal<Collection[]>([]);

  viewMode = signal<'list' | 'grid'>('grid');
  showAddModal = signal(false);

  // Search & Sort State
  searchQuery = signal('');
  activeSort = signal('recent'); // Default sort
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

  constructor() {
    // Setup Debounce for Search
    this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe((term) => {
      this.searchQuery.set(term);
      this.refreshBooks();
    });
  }

  ngOnInit(): void {
    // Listen to sidebar/URL changes
    this.route.queryParams.subscribe((params) => {
      this.refreshBooks();
    });

    // FIX: Listen for re-entry events (Back Button) because RouteReuseStrategy skips ngOnInit
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      // Only refresh if we are currently on the library page
      // We pass 'false' to avoid showing the skeleton loader again
      if (this.router.url.startsWith('/library')) {
        this.refreshBooks(false);
      }
    });

    this.loadCollections();
  }

  // Unified load function: Combines Sidebar (URL) + Toolbar (Local State)
  // Added optional 'showLoading' param to allow background updates
  refreshBooks(showLoading = true): void {
    if (showLoading) {
      this.loading.set(true);
    }

    // Get Context (Sidebar)
    const filter = this.route.snapshot.queryParams['filter'];

    // Get Refinement (Toolbar)
    const sort = this.activeSort();
    const search = this.searchQuery();

    this.booksService.list(filter, sort, search).subscribe({
      next: (data) => {
        this.rawBooks.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading books:', err);
        this.loading.set(false);
      },
    });
  }

  onSearch(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchSubject.next(val);
  }

  setSort(sort: string): void {
    this.activeSort.set(sort);
    this.refreshBooks();
  }

  loadCollections(): void {
    this.collectionsService.list().subscribe({
      next: (data) => this.collections.set(data),
      error: (err) => console.error('Error loading collections:', err),
    });
  }

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
    this.refreshBooks(false); // Background update
    this.closeEditModal();
  }

  deleteBook(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this book?')) return;

    this.booksService.delete(id).subscribe({
      next: () => {
        this.refreshBooks(false);
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
