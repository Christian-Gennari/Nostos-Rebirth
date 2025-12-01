import { Component, inject, input, output, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { finalize } from 'rxjs';
import { LucideAngularModule, X, Info, UploadIcon } from 'lucide-angular';
import { BooksService, Book } from '../services/books.services';
import { Collection } from '../dtos/collection.dtos';

@Component({
  selector: 'app-add-book-modal',
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
  book = input<Book | null>(null);

  // Outputs
  closeModal = output<void>();
  bookAdded = output<void>();
  bookUpdated = output<Book>();

  // Icons
  XIcon = X;
  UploadIcon = UploadIcon;
  InfoIcon = Info;

  // Computed State
  isEditMode = computed(() => !!this.book());
  isFetching = signal(false); // NEW: Loading state for ISBN fetch

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

  // Upload State
  selectedFile: File | null = null;
  selectedCover: File | null = null;
  uploadProgress = signal<number | null>(null);
  uploadStartTime: number | null = null;

  constructor() {
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
      publishedDate: b.publishedDate || '',
      pageCount: b.pageCount || null,
      description: b.description || '',
      language: b.language || 'en',
      categories: b.categories || '',
      series: b.series || '',
      volumeNumber: b.volumeNumber || '',
      collectionId: b.collectionId,
    };
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
    this.isFetching.set(false);
  }

  // --- ISBN Fetching Logic (NEW) ---
  fetchMetadata(): void {
    const isbn = this.form.isbn?.trim();
    if (!isbn) return;

    this.isFetching.set(true);

    this.booksService
      .lookup(isbn)
      .pipe(finalize(() => this.isFetching.set(false)))
      .subscribe({
        next: (data) => {
          this.form = {
            ...this.form,
            title: data.title || this.form.title,
            subtitle: data.subtitle || this.form.subtitle,
            author: data.author || this.form.author,
            description: data.description || this.form.description,
            publisher: data.publisher || this.form.publisher,
            publishedDate: data.publishedDate || this.form.publishedDate,
            pageCount: data.pageCount || this.form.pageCount,
            language: this.getFullLanguageName(data.language) || this.form.language,
            categories: data.categories || this.form.categories,
            // Keep existing fields user might have set
            isbn: this.form.isbn,
            collectionId: this.form.collectionId,
            series: this.form.series,
            volumeNumber: this.form.volumeNumber,
          };
        },
        error: () => alert('Book details not found.'),
      });
  }

  // --- File Handling ---
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

    // Normalize language code before saving
    if (this.form.language) {
      // Fix: Add "|| this.form.language" to ensure we never assign null
      this.form.language = this.getFullLanguageName(this.form.language) || this.form.language;
    }

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

  // Helper to convert "en" -> "English"
  private getFullLanguageName(input: string | null): string | null {
    if (!input) return null;
    const clean = input.trim();

    // Only attempt conversion if it looks like a code (2-3 chars, e.g. "en", "eng", "SV")
    // If it's longer (e.g. "French"), assume it's already a full name.
    if (clean.length > 3) return clean;

    try {
      // 'en' locale here means we want the result in English (e.g. 'sv' -> 'Swedish')
      const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      return displayNames.of(clean) || clean;
    } catch (e) {
      return clean; // Fallback to input if code is invalid
    }
  }
}
