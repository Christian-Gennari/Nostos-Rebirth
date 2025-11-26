import { Component, inject, OnInit, signal } from '@angular/core';
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
}
