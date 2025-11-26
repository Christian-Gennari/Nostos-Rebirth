import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BooksService, Book } from '../services/books.services';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [CommonModule],
  templateUrl: './book-detail.html',
  styleUrls: ['./book-detail.css'],
})
export class BookDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private booksService = inject(BooksService);

  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (!id) {
      this.error.set('Invalid book ID');
      this.loading.set(false);
      return;
    }

    this.booksService.get(id).subscribe({
      next: (book: Book) => {
        this.book.set(book);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error fetching book:', err);
        this.error.set('Book not found');
        this.loading.set(false);
      },
    });
  }
}
