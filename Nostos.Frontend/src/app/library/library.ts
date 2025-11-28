import { Component, inject, model, OnInit, signal, computed } from '@angular/core';
import { BooksService, Book } from '../services/books.services';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
// NOTE: HttpEventType is no longer needed here as upload logic moved to modal.

// Icons
import {
  LucideAngularModule,
  LayoutList,
  LayoutGrid,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Book as BookIcon,
} from 'lucide-angular';
import { AddBookModal } from '../add-book-modal/add-book-modal'; // Corrected import path/name

@Component({
  selector: 'app-library',
  standalone: true,
  // Ensure AddBookModal is imported
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
  CheckIcon = Check;
  XIcon = X;
  BookIcon = BookIcon;

  // 1. Raw Data Source (All books from API)
  rawBooks = signal<Book[]>([]);

  // 2. Filter State (From Service)
  activeCollectionId = this.collectionsService.activeCollectionId;

  // 3. Computed View (What the template sees)
  books = computed(() => {
    const all = this.rawBooks();
    const activeId = this.activeCollectionId();

    if (!activeId) return all;
    return all.filter((b) => b.collectionId === activeId);
  });

  collections = signal<Collection[]>([]);

  // REMOVED: uploadProgress, uploadStartTime (Moved to modal)

  viewMode = signal<'list' | 'grid'>('grid');
  // MODAL STATE: Renamed/Changed from 'showAddDrawer'
  showAddModal = signal(false);

  editing = signal<Book | null>(null);
  editTitle = model<string>('');
  editAuthor = model<string>('');

  // REMOVED: newBook state (Moved to modal)
  // REMOVED: selectedFile, selectedCover (Moved to modal)

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

  // MODAL CONTROL METHODS
  openAddModal(): void {
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
  }

  // REMOVED: toggleAddDrawer(), closeDrawerSmooth(), resetDrawer()
  // REMOVED: onFileSelected(), onCoverSelected()
  // REMOVED: saveBook(), uploadCoverIfNeeded(), finishSave() (Logic moved to AddBookModal)

  deleteBook(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this book?')) return;

    this.booksService.delete(id).subscribe({
      next: () => this.loadBooks(),
    });
  }

  startEdit(book: Book): void {
    this.editing.set(book);
    this.editTitle.set(book.title);
    this.editAuthor.set(book.author ?? '');
  }

  /**
   * CORRECTED: Now includes all required fields from UpdateBookDto
   * by passing the existing values of the book being edited.
   */
  saveEdit(): void {
    const book = this.editing();
    if (!book) return;

    this.booksService
      .update(book.id, {
        title: this.editTitle(),
        author: this.editAuthor(),
        collectionId: book.collectionId,
        // Pass existing values for new DTO fields to satisfy interface:
        isbn: book.isbn,
        publisher: book.publisher,
        publicationDate: book.publicationDate,
        pageCount: book.pageCount,
        description: book.description,
      })
      .subscribe({
        next: () => {
          this.loadBooks();
          this.editing.set(null);
        },
      });
  }

  cancelEdit(): void {
    this.editing.set(null);
  }
}
