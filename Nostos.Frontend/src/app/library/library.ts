import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BooksService, Book } from '../services/books.services';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AddBookModal } from '../add-book-modal/add-book-modal';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';
import {
  LucideAngularModule,
  LayoutList,
  LayoutGrid,
  Plus,
  Trash2,
  Edit2,
  Book as BookIcon,
  Heart,
  CheckCircle, // <--- NEW IMPORT
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
  ],
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
})
export class Library implements OnInit {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService);
  private route = inject(ActivatedRoute);

  ListIcon = LayoutList;
  GridIcon = LayoutGrid;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  BookIcon = BookIcon;
  HeartIcon = Heart;
  CheckCircleIcon = CheckCircle; // <--- NEW ICON

  rawBooks = signal<Book[]>([]);
  collections = signal<Collection[]>([]);

  viewMode = signal<'list' | 'grid'>('grid');
  showAddModal = signal(false);

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

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const filter = params['filter'];
      const sort = params['sort'];
      this.loadBooks(filter, sort);
    });

    this.loadCollections();
  }

  loadBooks(filter?: string, sort?: string): void {
    this.booksService.list(filter, sort).subscribe({
      next: (data) => this.rawBooks.set(data),
      error: (err) => console.error('Error loading books:', err),
    });
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
    const params = this.route.snapshot.queryParams;
    this.loadBooks(params['filter'], params['sort']);
    this.closeEditModal();
  }

  deleteBook(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this book?')) return;

    this.booksService.delete(id).subscribe({
      next: () => {
        const params = this.route.snapshot.queryParams;
        this.loadBooks(params['filter'], params['sort']);
      },
    });
  }

  // === FEATURES METHODS ===

  toggleFavorite(book: Book, event: Event): void {
    event.stopPropagation();

    const newStatus = !book.isFavorite;

    // Optimistic UI update
    book.isFavorite = newStatus;

    this.booksService.update(book.id, { isFavorite: newStatus }).subscribe({
      error: () => {
        // Revert on failure
        book.isFavorite = !newStatus;
        alert('Failed to update favorite status');
      },
    });
  }

  toggleFinished(book: Book, event: Event): void {
    event.stopPropagation();

    const isCurrentlyFinished = !!book.finishedAt;
    const newIsFinished = !isCurrentlyFinished;

    // Store old values for revert
    const oldFinishedAt = book.finishedAt;
    const oldProgress = book.progressPercent;

    // Optimistic UI update
    book.finishedAt = newIsFinished ? new Date().toISOString() : null;
    book.progressPercent = newIsFinished ? 100 : book.progressPercent;

    const updatePayload: any = {
      isFinished: newIsFinished,
    };

    this.booksService.update(book.id, updatePayload).subscribe({
      error: () => {
        // Revert on failure
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
