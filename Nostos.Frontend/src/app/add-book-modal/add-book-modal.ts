// src/app/add-book-modal/add-book-modal.component.ts

import { Component, inject, input, output, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { LucideAngularModule, X, Upload } from 'lucide-angular';
import { BooksService, Book } from '../services/books.services';
import { Collection } from '../dtos/collection.dtos';

// Define the shape of the new book data for the form
interface NewBookForm {
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  publicationDate: string | null;
  pageCount: number | null;
  description: string | null;
  collectionId: string | null;
}

@Component({
  selector: 'app-add-book-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './add-book-modal.html',
  styleUrl: './add-book-modal.css',
})
export class AddBookModal {
  private booksService = inject(BooksService);

  // Inputs from parent (Library component)
  isOpen = input.required<boolean>();
  collections = input.required<Collection[]>();

  // Outputs to parent
  closeModal = output<void>(); // Used to tell the parent to close the modal
  bookAdded = output<void>(); // Used to tell the parent to refresh the book list

  XIcon = X;
  UploadIcon = Upload;

  // New book state with extended fields
  newBook: NewBookForm = {
    title: '',
    author: null,
    isbn: null,
    publisher: null,
    publicationDate: null,
    pageCount: null,
    description: null,
    collectionId: null,
  };

  selectedFile: File | null = null;
  selectedCover: File | null = null;
  uploadProgress = signal<number | null>(null);
  uploadStartTime: number | null = null;

  // --- File Handling ---

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedCover = input.files?.[0] ?? null;
  }

  // --- Form Actions ---

  resetForm(): void {
    this.newBook = {
      title: '',
      author: null,
      isbn: null,
      publisher: null,
      publicationDate: null,
      pageCount: null,
      description: null,
      collectionId: null,
    };
    this.selectedFile = null;
    this.selectedCover = null;
    this.uploadProgress.set(null);
    this.uploadStartTime = null;
  }

  submitBook(): void {
    if (!this.newBook.title.trim()) return;

    // Convert pageCount to number if it's a string, ensuring it's not null/empty string
    const pageCountValue = this.newBook.pageCount ? Number(this.newBook.pageCount) : null;

    this.booksService
      .create({
        title: this.newBook.title,
        author: this.newBook.author,
        isbn: this.newBook.isbn,
        publisher: this.newBook.publisher,
        publicationDate: this.newBook.publicationDate,
        pageCount: pageCountValue,
        description: this.newBook.description,
        collectionId: this.newBook.collectionId,
      })
      .subscribe({
        next: (createdBook) => {
          if (this.selectedFile) {
            this.handleFileUpload(createdBook);
          } else {
            this.uploadCoverIfNeeded(createdBook.id);
          }
        },
        error: (err) => console.error('Error creating book:', err),
      });
  }

  // --- Upload Logic (Moved from Library component) ---

  handleFileUpload(createdBook: Book): void {
    this.uploadStartTime = performance.now();
    this.booksService.uploadFile(createdBook.id, this.selectedFile!).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const percent = Math.round((event.loaded / (event.total ?? 1)) * 100);
          this.uploadProgress.set(percent);
        }

        if (event.type === HttpEventType.Response) {
          const MIN_VISIBLE = 1200;
          const elapsed = performance.now() - (this.uploadStartTime ?? 0);
          const remaining = Math.max(0, MIN_VISIBLE - elapsed);

          setTimeout(() => {
            this.uploadProgress.set(null);
            this.uploadStartTime = null;
            this.uploadCoverIfNeeded(createdBook.id);
          }, remaining);
        }
      },
      error: (err) => {
        console.error('File upload error:', err);
        this.uploadProgress.set(null);
      },
    });
  }

  uploadCoverIfNeeded(bookId: string) {
    if (!this.selectedCover) {
      this.finishSave();
      return;
    }

    this.booksService.uploadCover(bookId, this.selectedCover).subscribe({
      next: (event) => {
        // HttpEventType.Response is 4
        if (event.type === 4) {
          this.finishSave();
        }
      },
      error: (err) => {
        console.error('Cover upload error:', err);
        this.finishSave(); // Still finish save even if cover upload fails
      },
    });
  }

  finishSave() {
    this.resetForm();
    this.closeModal.emit();
    this.bookAdded.emit();
  }
}
