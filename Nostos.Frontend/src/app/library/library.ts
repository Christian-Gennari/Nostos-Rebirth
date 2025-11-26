import { Component, inject, model, OnInit, signal } from '@angular/core';
import { BooksService, Book } from '../services/books.services';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';
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
  private booksService = inject(BooksService);

  // Icons
  ListIcon = LayoutList;
  GridIcon = LayoutGrid;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  CheckIcon = Check;
  XIcon = X;
  BookIcon = BookIcon;

  books = signal<Book[]>([]);

  // UI State
  viewMode = signal<'list' | 'grid'>('list');
  showAddDrawer = signal(false);

  // Editing State
  editing = signal<Book | null>(null);
  editTitle = model<string>('');
  editAuthor = model<string>('');

  // New Book Model
  newBook = {
    title: '',
    author: null as string | null,
  };

  ngOnInit(): void {
    this.loadBooks();
  }

  loadBooks(): void {
    this.booksService.list().subscribe({
      next: (data) => this.books.set(data),
      error: (error) => console.error('Error loading books:', error),
    });
  }

  toggleAddDrawer() {
    this.showAddDrawer.update((v) => !v);
  }

  addBook(): void {
    if (!this.newBook.title.trim()) return;

    this.booksService
      .create({
        title: this.newBook.title,
        author: this.newBook.author,
      })
      .subscribe({
        next: () => {
          this.newBook = { title: '', author: null };
          this.showAddDrawer.set(false);
          this.loadBooks();
        },
        error: (err) => console.error('Error creating book:', err),
      });
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
