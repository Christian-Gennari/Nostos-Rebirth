import { Component, inject, OnInit, signal } from '@angular/core';
import { BooksService, Book } from '../services/books.services';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule],
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
}
