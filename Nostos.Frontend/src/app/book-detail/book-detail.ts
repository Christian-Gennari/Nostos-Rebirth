import { Component, inject, OnInit } from '@angular/core';
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

  book: Book | null = null;
  loading = true;
  error: string | null = null;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'Invalid book ID';
      this.loading = false;
      return;
    }

    this.booksService.get(id).subscribe({
      next: (book: Book) => {
        this.book = book;
        this.loading = false;
      },
      error: (err) => {
        // Add err parameter to see what's happening
        console.error('Error fetching book:', err); // Add logging
        this.error = 'Book not found';
        this.loading = false;
      },
    });
  }
}
