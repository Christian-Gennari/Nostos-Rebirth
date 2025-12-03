import { Component, inject, input, output, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { finalize } from 'rxjs';
import { LucideAngularModule, X, Info, UploadIcon } from 'lucide-angular';
import { BooksService, Book } from '../services/books.services';
import { Collection } from '../dtos/collection.dtos';
import { BookType } from '../dtos/book.dtos'; // ✅ Import the new Type

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
  isFetching = signal(false);

  // Form State
  form = {
    // ✅ Polymorphic Discriminator
    type: 'physical' as BookType,

    title: '',
    subtitle: '' as string | null,
    author: '' as string | null,
    description: '' as string | null,

    // ✅ Specific IDs
    isbn: '' as string | null,
    asin: '' as string | null, // NEW: For Audiobooks

    // ✅ Metadata
    publisher: '' as string | null,
    publishedDate: '' as string | null,
    edition: '' as string | null, // NEW: For references

    // ✅ Length (Conditional)
    pageCount: null as number | null,
    duration: '' as string | null, // NEW: For Audiobooks

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
      type: b.type || 'physical', // Default to physical for legacy records
      title: b.title,
      subtitle: b.subtitle || '',
      author: b.author,
      description: b.description || '',

      isbn: b.isbn || '',
      asin: b.asin || '', // ✅ Map new field

      publisher: b.publisher || '',
      publishedDate: b.publishedDate || '',
      edition: b.edition || '', // ✅ Map new field

      pageCount: b.pageCount || null,
      duration: b.duration || '', // ✅ Map new field

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
      type: 'physical', // Reset to default
      title: '',
      subtitle: null,
      author: null,
      description: null,

      isbn: null,
      asin: null, // ✅ Reset

      publisher: null,
      publishedDate: null,
      edition: null, // ✅ Reset

      pageCount: null,
      duration: null, // ✅ Reset

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

  // --- ISBN Fetching Logic ---
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
            // ✅ Preserve new fields
            type: this.form.type,
            asin: this.form.asin,
            duration: this.form.duration,
            edition: this.form.edition,
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

    if (clean.length > 3) return clean;

    try {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      return displayNames.of(clean) || clean;
    } catch (e) {
      return clean;
    }
  }
}
