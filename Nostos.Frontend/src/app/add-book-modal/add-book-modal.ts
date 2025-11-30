import { Component, inject, input, output, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { LucideAngularModule, X, Upload, Info } from 'lucide-angular';
import { BooksService, Book } from '../services/books.services';
import { Collection } from '../dtos/collection.dtos';

@Component({
  selector: 'app-add-book-modal', // You can rename this selector later if you want
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './add-book-modal.html',
  styleUrl: './add-book-modal.css',
})
export class AddBookModal {
  private booksService = inject(BooksService);

  // Inputs
  isOpen = input.required<boolean>();
  collections = input.required<Collection[]>();
  book = input<Book | null>(null); // <--- NEW: If present, we are in Edit Mode

  // Outputs
  closeModal = output<void>();
  bookAdded = output<void>(); // For "Add" success
  bookUpdated = output<Book>(); // For "Edit" success

  // Icons
  XIcon = X;
  UploadIcon = Upload;
  InfoIcon = Info;

  // Computed State
  isEditMode = computed(() => !!this.book());

  // Form State
  form = {
    title: '',
    subtitle: '' as string | null,
    author: '' as string | null,
    isbn: '' as string | null,
    publisher: '' as string | null,
    publishedDate: '' as string | null,
    pageCount: null as number | null,
    description: '' as string | null,
    language: 'en',
    categories: '' as string | null,
    series: '' as string | null,
    volumeNumber: '' as string | null,
    collectionId: null as string | null,
  };

  // Upload State (Only for Add Mode)
  selectedFile: File | null = null;
  selectedCover: File | null = null;
  uploadProgress = signal<number | null>(null);
  uploadStartTime: number | null = null;

  constructor() {
    // Reset or Fill form whenever the modal opens
    effect(() => {
      if (this.isOpen()) {
        const currentBook = this.book();
        if (currentBook) {
          this.fillForm(currentBook);
        } else {
          this.resetForm();
        }
      }
    });
  }

  fillForm(b: Book) {
    this.form = {
      title: b.title,
      subtitle: b.subtitle || '',
      author: b.author,
      isbn: b.isbn || '',
      publisher: b.publisher || '',
      publishedDate: b.publishedDate || '', // Use raw string
      pageCount: b.pageCount || null,
      description: b.description || '',
      language: b.language || 'en',
      categories: b.categories || '',
      series: b.series || '',
      volumeNumber: b.volumeNumber || '',
      collectionId: b.collectionId,
    };
    // Clear uploads just in case
    this.selectedFile = null;
    this.selectedCover = null;
  }

  resetForm(): void {
    this.form = {
      title: '',
      subtitle: null,
      author: null,
      isbn: null,
      publisher: null,
      publishedDate: null,
      pageCount: null,
      description: null,
      language: 'en',
      categories: null,
      series: null,
      volumeNumber: null,
      collectionId: null,
    };
    this.selectedFile = null;
    this.selectedCover = null;
    this.uploadProgress.set(null);
  }

  // --- File Handling (Add Mode Only) ---
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedCover = input.files?.[0] ?? null;
  }

  // --- Main Action ---
  submit(): void {
    if (!this.form.title.trim()) return;

    if (this.isEditMode()) {
      this.saveEdit();
    } else {
      this.createBook();
    }
  }

  saveEdit() {
    const bookId = this.book()!.id;
    this.booksService
      .update(bookId, {
        ...this.form,
        // Ensure we send nulls for empty strings if preferred, or keep as is
        publishedDate: this.form.publishedDate || null,
      })
      .subscribe({
        next: (updated) => {
          this.bookUpdated.emit(updated);
          this.closeModal.emit();
        },
        error: (err) => console.error('Update failed', err),
      });
  }

  createBook() {
    this.booksService
      .create({
        ...this.form,
        publishedDate: this.form.publishedDate || null,
      })
      .subscribe({
        next: (createdBook) => {
          if (this.selectedFile) {
            this.handleFileUpload(createdBook);
          } else {
            this.uploadCoverIfNeeded(createdBook.id);
          }
        },
        error: (err) => console.error('Creation failed', err),
      });
  }

  // --- Upload Helpers (Identical to before) ---
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
            this.uploadCoverIfNeeded(createdBook.id);
          }, remaining);
        }
      },
      error: () => this.uploadProgress.set(null),
    });
  }

  uploadCoverIfNeeded(bookId: string) {
    if (!this.selectedCover) {
      this.finishAdd();
      return;
    }
    this.booksService.uploadCover(bookId, this.selectedCover).subscribe({
      next: (event) => {
        if (event.type === 4) this.finishAdd();
      },
      error: () => this.finishAdd(),
    });
  }

  finishAdd() {
    this.resetForm();
    this.closeModal.emit();
    this.bookAdded.emit();
  }
}
