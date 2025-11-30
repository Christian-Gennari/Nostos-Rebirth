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
    author: '' as string | null,
    collectionId: null as string | null,
    description: '' as string | null,
    isbn: '' as string | null,
    publisher: '' as string | null,
    publicationDate: '' as string | null,
    pageCount: 0 as number | null,
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
      author: b.author,
      collectionId: b.collectionId,
      description: b.description || '',
      isbn: b.isbn || '',
      publisher: b.publisher || '',
      publicationDate: b.publicationDate
        ? new Date(b.publicationDate).toISOString().split('T')[0]
        : '',
      pageCount: b.pageCount || null,
    };
  }

  save() {
    this.booksService
      .update(this.book().id, {
        title: this.form.title,
        author: this.form.author,
        collectionId: this.form.collectionId,
        isbn: this.form.isbn,
        publisher: this.form.publisher,
        publicationDate: this.form.publicationDate
          ? new Date(this.form.publicationDate).toDateString()
          : null,
        pageCount: this.form.pageCount,
        description: this.form.description,
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
