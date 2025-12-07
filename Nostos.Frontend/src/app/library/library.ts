import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router'; // Import ActivatedRoute
import { BooksService, Book } from '../services/books.services';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AddBookModal } from '../add-book-modal/add-book-modal';
import {
  LucideAngularModule,
  LayoutList,
  LayoutGrid,
  Plus,
  Trash2,
  Edit2,
  Book as BookIcon,
} from 'lucide-angular';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, LucideAngularModule, AddBookModal],
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
})
export class Library implements OnInit {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService);
  private route = inject(ActivatedRoute); // Inject Route

  ListIcon = LayoutList;
  GridIcon = LayoutGrid;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  BookIcon = BookIcon;

  rawBooks = signal<Book[]>([]);
  collections = signal<Collection[]>([]);

  viewMode = signal<'list' | 'grid'>('grid');
  showAddModal = signal(false);

  // New modal edit system
  showEditModal = signal(false);
  editTarget = signal<Book | null>(null);

  activeCollectionId = this.collectionsService.activeCollectionId;

  // Filter Logic:
  // 1. If backend 'filter' is active (Favorites/Reading), 'rawBooks' already contains ONLY those books.
  // 2. If 'activeCollectionId' is set, we filter the rawBooks by that collection.
  books = computed(() => {
    const all = this.rawBooks();
    const activeId = this.activeCollectionId();

    // If we have a user collection selected, filter by it
    if (activeId) {
      return all.filter((b) => b.collectionId === activeId);
    }

    // Otherwise return whatever the backend gave us (All Books OR Smart Filtered results)
    return all;
  });

  ngOnInit(): void {
    // Subscribe to query params to reload data when filters change
    this.route.queryParams.subscribe((params) => {
      const filter = params['filter'];
      const sort = params['sort'];

      // Reload books whenever URL changes
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

  // Add modal
  openAddModal(): void {
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
  }

  // Edit modal
  openEditModal(book: Book): void {
    this.editTarget.set(book);
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.editTarget.set(null);
  }

  onBookUpdated(updated: Book): void {
    // Reload with current params to keep context
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
}
