import { Component, inject, model, OnInit, signal } from '@angular/core';
import { BooksService, Book } from '../services/books.services';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
})
export class Library implements OnInit {
  private booksService = inject(BooksService);

  books = signal<Book[]>([]);

  editing = signal<Book | null>(null);
  editTitle = model<string>('');
  editAuthor = model<string>('');

  viewMode = signal<'list' | 'grid'>('list');

  ngOnInit(): void {
    this.loadBooks();
  }

  loadBooks(): void {
    this.booksService.list().subscribe({
      next: (data) => {
        this.books.set(data);
        console.log('Books loaded:', data);
      },
      error: (error) => {
        console.error('Error loading books:', error);
      },
    });
  }

  newBook = {
    title: '',
    author: null as string | null,
  };

  addBook(): void {
    if (!this.newBook.title.trim()) {
      return;
    }

    this.booksService
      .create({
        title: this.newBook.title,
        author: this.newBook.author,
      })
      .subscribe({
        next: () => {
          this.newBook = { title: '', author: null };
          this.loadBooks();
        },
        error: (err) => {
          console.error('Error creating book:', err);
        },
      });
  }

  deleteBook(id: string, event: Event): void {
    event.stopPropagation(); // prevent row navigation

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
