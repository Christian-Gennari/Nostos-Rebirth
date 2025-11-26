import { Component, inject, model, OnInit, signal } from '@angular/core';
import { BooksService, Book } from '../services/books.services';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';

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
})
export class Library implements OnInit {
  /* ---------------------------------------------
     Services & Icon Bindings
  ---------------------------------------------- */
  private booksService = inject(BooksService);

  ListIcon = LayoutList;
  GridIcon = LayoutGrid;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  CheckIcon = Check;
  XIcon = X;
  BookIcon = BookIcon;

  /* ---------------------------------------------
     Core State
     - books(): all books displayed in list/grid
     - uploadProgress(): used if you add progress UI later
  ---------------------------------------------- */
  books = signal<Book[]>([]);
  uploadProgress = signal<number | null>(null);

  /* ---------------------------------------------
     UI State
     - viewMode: "list" or "grid"
     - showAddDrawer: toggles drawer visibility
  ---------------------------------------------- */
  viewMode = signal<'list' | 'grid'>('list');
  showAddDrawer = signal(false);

  /* ---------------------------------------------
     Inline Editing (list view)
  ---------------------------------------------- */
  editing = signal<Book | null>(null);
  editTitle = model<string>('');
  editAuthor = model<string>('');

  /* ---------------------------------------------
     New Book Form (title, author, file)
  ---------------------------------------------- */
  newBook = {
    title: '',
    author: null as string | null,
  };

  selectedFile: File | null = null;
  selectedCover: File | null = null;

  /* ---------------------------------------------
     Lifecycle
  ---------------------------------------------- */
  ngOnInit(): void {
    this.loadBooks();
  }

  /* ---------------------------------------------
     Load books from backend
  ---------------------------------------------- */
  loadBooks(): void {
    this.booksService.list().subscribe({
      next: (data) => this.books.set(data),
      error: (err) => console.error('Error loading books:', err),
    });
  }

  /* ---------------------------------------------
     Add Drawer Toggle (opens/closes the book form)
  ---------------------------------------------- */
  toggleAddDrawer(): void {
    this.showAddDrawer.update((v) => !v);
  }

  /* ---------------------------------------------
     File Picker Handler
  ---------------------------------------------- */
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedCover = input.files?.[0] ?? null;
  }

  /* ---------------------------------------------
     Create Book + (optional) File Upload

     Steps:
       1. Create metadata through POST /api/books
       2. If a file is selected → upload via /api/books/{id}/file
       3. Reset UI + reload book list
  ---------------------------------------------- */
  saveBook(): void {
    if (!this.newBook.title.trim()) return;

    this.booksService
      .create({
        title: this.newBook.title,
        author: this.newBook.author,
      })
      .subscribe({
        next: (createdBook) => {
          // Upload main book file (EPUB/PDF/TXT)
          if (this.selectedFile) {
            this.booksService.uploadFile(createdBook.id, this.selectedFile).subscribe({
              next: (event) => {
                // When finished → upload cover if exists
                if (event.type === 4 /* HttpEventType.Response */) {
                  this.uploadCoverIfNeeded(createdBook.id);
                }
              },
              error: (err) => console.error('File upload error:', err),
            });
          } else {
            // No book file, go straight to cover
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
        if (event.type === 4 /* HttpEventType.Response */) {
          this.finishSave();
        }
      },
      error: (err) => console.error('Cover upload error:', err),
    });
  }

  finishSave() {
    this.resetDrawer();
    this.loadBooks();
  }

  /* ---------------------------------------------
     Reset Drawer (clears form + closes drawer)
  ---------------------------------------------- */
  resetDrawer(): void {
    this.newBook = { title: '', author: null };
    this.selectedFile = null;
    this.showAddDrawer.set(false);
  }

  /* ---------------------------------------------
     Delete Book
  ---------------------------------------------- */
  deleteBook(id: string, event: Event): void {
    event.stopPropagation(); // Prevent card navigation
    if (!confirm('Are you sure you want to delete this book?')) return;

    this.booksService.delete(id).subscribe({
      next: () => this.loadBooks(),
    });
  }

  /* ---------------------------------------------
     Inline Editing (List View)
  ---------------------------------------------- */
  startEdit(book: Book): void {
    this.editing.set(book);
    this.editTitle.set(book.title);
    this.editAuthor.set(book.author ?? '');
  }

  saveEdit(): void {
    const book = this.editing();
    if (!book) return;

    this.booksService
      .update(book.id, {
        title: this.editTitle(),
        author: this.editAuthor(),
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
