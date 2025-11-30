import { Component, inject, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ChevronDown, X } from 'lucide-angular';
import { BooksService, Book } from '../services/books.services';
import { Collection } from '../dtos/collection.dtos';

@Component({
  selector: 'app-edit-book-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './edit-book-modal.html',
  styleUrl: './edit-book-modal.css',
})
export class EditBookModal {
  private booksService = inject(BooksService);

  // Inputs
  isOpen = input.required<boolean>();
  book = input.required<Book>();
  collections = input.required<Collection[]>();

  // Outputs
  closeModal = output<void>();
  bookUpdated = output<Book>();

  // Icons
  ChevronDownIcon = ChevronDown;
  XIcon = X;

  // Form State
  form = {
    title: '',
    subtitle: '' as string | null,
    author: '' as string | null,
    collectionId: null as string | null,
    description: '' as string | null,
    isbn: '' as string | null,
    publisher: '' as string | null,
    publicationDate: '' as string | null,
    pageCount: 0 as number | null,
    language: '' as string | null,
    categories: '' as string | null,
    series: '' as string | null,
    volumeNumber: '' as string | null,
  };

  constructor() {
    // Reset form when modal opens or book changes
    effect(() => {
      if (this.isOpen()) {
        this.resetForm();
      }
    });
  }

  resetForm() {
    const b = this.book();
    this.form = {
      title: b.title,
      subtitle: b.subtitle || '',
      author: b.author,
      collectionId: b.collectionId,
      description: b.description || '',
      isbn: b.isbn || '',
      publisher: b.publisher || '',
      publicationDate: b.publicationDate
        ? new Date(b.publicationDate).toISOString().split('T')[0]
        : '',
      pageCount: b.pageCount || null,
      language: b.language || '',
      categories: b.categories || '',
      series: b.series || '',
      volumeNumber: b.volumeNumber || '',
    };
  }

  save() {
    this.booksService
      .update(this.book().id, {
        title: this.form.title,
        subtitle: this.form.subtitle,
        author: this.form.author,
        collectionId: this.form.collectionId,
        isbn: this.form.isbn,
        publisher: this.form.publisher,
        publishedDate: this.form.publicationDate
          ? new Date(this.form.publicationDate).toDateString()
          : null,
        pageCount: this.form.pageCount,
        description: this.form.description,
        language: this.form.language,
        categories: this.form.categories,
        series: this.form.series,
        volumeNumber: this.form.volumeNumber,
      })
      .subscribe({
        next: (updatedBook) => {
          this.bookUpdated.emit(updatedBook);
          this.closeModal.emit();
        },
        error: (err) => console.error('Failed to update book:', err),
      });
  }
}
