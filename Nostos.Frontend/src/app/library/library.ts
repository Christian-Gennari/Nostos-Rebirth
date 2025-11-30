import { Component, inject, OnInit, signal, computed } from '@angular/core';
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

  books = computed(() => {
    const all = this.rawBooks();
    const activeId = this.activeCollectionId();

    if (!activeId) return all;
    return all.filter((b) => b.collectionId === activeId);
  });

  ngOnInit(): void {
    this.loadBooks();
    this.loadCollections();
  }

  loadBooks(): void {
    this.booksService.list().subscribe({
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
    this.loadBooks();
    this.closeEditModal();
  }

  deleteBook(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this book?')) return;

    this.booksService.delete(id).subscribe({
      next: () => this.loadBooks(),
    });
  }
}
