import { Component, inject, model, OnInit, signal } from '@angular/core';
import { BooksService, Book } from '../services/books.services';
import { CollectionsService } from '../services/collections.services'; // <--- NEW IMPORT
import { Collection } from '../dtos/collection.dtos'; // <--- NEW IMPORT
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';
import { HttpEventType } from '@angular/common/http';

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

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, SidebarCollections, LucideAngularModule],
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
  // DELETED: animations: [ ... ]
})
export class Library implements OnInit {
  private booksService = inject(BooksService);
  private collectionsService = inject(CollectionsService); // <--- INJECT SERVICE

  ListIcon = LayoutList;
  GridIcon = LayoutGrid;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  CheckIcon = Check;
  XIcon = X;
  BookIcon = BookIcon;

  books = signal<Book[]>([]);
  collections = signal<Collection[]>([]); // <--- NEW SIGNAL

  uploadProgress = signal<number | null>(null);
  uploadStartTime: number | null = null;

  viewMode = signal<'list' | 'grid'>('grid');
  showAddDrawer = signal(false);

  editing = signal<Book | null>(null);
  editTitle = model<string>('');
  editAuthor = model<string>('');

  newBook = {
    title: '',
    author: null as string | null,
    collectionId: null as string | null, // <--- NEW FIELD
  };

  selectedFile: File | null = null;
  selectedCover: File | null = null;

  ngOnInit(): void {
    this.loadBooks();
    this.loadCollections(); // <--- LOAD COLLECTIONS
  }

  loadBooks(): void {
    this.booksService.list().subscribe({
      next: (data) => this.books.set(data),
      error: (err) => console.error('Error loading books:', err),
    });
  }

  loadCollections(): void {
    this.collectionsService.list().subscribe({
      next: (data) => this.collections.set(data),
      error: (err) => console.error('Error loading collections:', err),
    });
  }

  toggleAddDrawer(): void {
    this.showAddDrawer.update((v) => !v);
  }

  closeDrawerSmooth() {
    this.showAddDrawer.set(false);
  }

  resetDrawer(): void {
    this.newBook = { title: '', author: null, collectionId: null }; // <--- RESET collectionId
    this.selectedFile = null;
    this.selectedCover = null;
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedCover = input.files?.[0] ?? null;
  }

  saveBook(): void {
    if (!this.newBook.title.trim()) return;

    this.booksService
      .create({
        title: this.newBook.title,
        author: this.newBook.author,
        collectionId: this.newBook.collectionId, // <--- SEND TO BACKEND
      })
      .subscribe({
        next: (createdBook) => {
          if (this.selectedFile) {
            this.uploadStartTime = performance.now();
            this.booksService.uploadFile(createdBook.id, this.selectedFile).subscribe({
              next: (event) => {
                if (event.type === HttpEventType.UploadProgress) {
                  const percent = Math.round((event.loaded / (event.total ?? 1)) * 100);
                  this.uploadProgress.set(percent);
                }

                if (event.type === HttpEventType.Response) {
                  const MIN_VISIBLE = 1200;
                  const elapsed = performance.now() - (this.uploadStartTime ?? 0);
                  const remaining = Math.max(0, MIN_VISIBLE - elapsed);

                  setTimeout(() => {
                    this.uploadProgress.set(null);
                    this.uploadStartTime = null;
                    this.uploadCoverIfNeeded(createdBook.id);
                  }, remaining);
                }
              },
              error: (err) => {
                console.error('File upload error:', err);
                this.uploadProgress.set(null);
              },
            });
          } else {
            this.uploadCoverIfNeeded(createdBook.id);
          }
        },
        error: (err) => console.error('Error creating book:', err),
      });
  }

  uploadCoverIfNeeded(bookId: string) {
    if (!this.selectedCover) {
      this.finishSave();
      return;
    }

    this.booksService.uploadCover(bookId, this.selectedCover).subscribe({
      next: (event) => {
        if (event.type === 4) {
          this.finishSave();
        }
      },
      error: (err) => console.error('Cover upload error:', err),
    });
  }

  finishSave() {
    this.resetDrawer();
    this.closeDrawerSmooth();
    this.loadBooks();
  }

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

  saveEdit(): void {
    const book = this.editing();
    if (!book) return;

    // Note: If updating requires collectionId, you'll need to add it here too.
    // For now, keeping title/author as per previous implementation.
    this.booksService
      .update(book.id, {
        title: this.editTitle(),
        author: this.editAuthor(),
        collectionId: book.collectionId, // Preserving existing collection if not editable here
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
