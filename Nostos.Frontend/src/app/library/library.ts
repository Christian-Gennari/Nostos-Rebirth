import { Component, inject } from '@angular/core';
import { BooksService, Book } from '../services/books.services';

@Component({
  selector: 'app-library',
  standalone: true,
  templateUrl: './library.html',
  styleUrls: ['./library.css'],
})
export class LibraryComponent {
  private booksService = inject(BooksService);

  books: Book[] = [];

  constructor() {
    this.booksService.list().subscribe((data) => {
      this.books = data;
    });
  }
}
