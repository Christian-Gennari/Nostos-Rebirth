import { Component, inject, input, output, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { finalize } from 'rxjs';
import { LucideAngularModule, X, Info, UploadIcon, Book, Layers, FileText } from 'lucide-angular';
import { BooksService, Book as BookModel } from '../services/books.services';
import { Collection } from '../dtos/collection.dtos';
import { BookType } from '../dtos/book.dtos';

@Component({
  selector: 'app-add-book-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './add-book-modal.html',
  styleUrl: './add-book-modal.css',
})
export class AddBookModal {
  private booksService = inject(BooksService);

  // Inputs & Outputs
  isOpen = input.required<boolean>();
  collections = input.required<Collection[]>();
  book = input<BookModel | null>(null);
  closeModal = output<void>();
  bookAdded = output<void>();
  bookUpdated = output<BookModel>();

  // Icons
  XIcon = X;
  UploadIcon = UploadIcon;
  InfoIcon = Info;
  // Tab Icons
  GeneralIcon = Book;
  MetadataIcon = Layers;
  FileIcon = FileText;

  // Tabs
  tabs = ['General', 'Metadata', 'File'] as const;
  activeTab = signal<(typeof this.tabs)[number]>('General');

  // Computed State
  isEditMode = computed(() => !!this.book());
  isFetching = signal(false);

  // Form State
  form = {
    type: 'physical' as BookType,
    title: '',
    subtitle: '' as string | null,

    author: '' as string | null,
    editor: '' as string | null, // <--- NEW
    translator: '' as string | null,
    narrator: '' as string | null,

    description: '' as string | null,

    isbn: '' as string | null,
    asin: '' as string | null,

    publisher: '' as string | null,
    placeOfPublication: '' as string | null, // <--- NEW
    publishedDate: '' as string | null,

    edition: '' as string | null,
    pageCount: null as number | null,
    duration: '' as string | null,
    language: 'en',
    categories: '' as string | null,
    series: '' as string | null,
    volumeNumber: '' as string | null,
    collectionId: null as string | null,

    personalReview: '' as string | null, // <--- NEW
  };

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

  setTab(tab: (typeof this.tabs)[number]) {
    this.activeTab.set(tab);
  }

  fillForm(b: BookModel) {
    this.form = {
      type: b.type || 'physical',
      title: b.title,
      subtitle: b.subtitle || '',

      author: b.author,
      editor: b.editor || '', // <--- NEW
      translator: b.translator || '',
      narrator: b.narrator || '',

      description: b.description || '',

      isbn: b.isbn || '',
      asin: b.asin || '',

      publisher: b.publisher || '',
      placeOfPublication: b.placeOfPublication || '', // <--- NEW
      publishedDate: b.publishedDate || '',

      edition: b.edition || '',
      pageCount: b.pageCount || null,
      duration: b.duration || '',
      language: b.language || 'en',
      categories: b.categories || '',
      series: b.series || '',
      volumeNumber: b.volumeNumber || '',
      collectionId: b.collectionId,

      personalReview: b.personalReview || '', // <--- NEW
    };
    this.selectedFile = null;
    this.selectedCover = null;
    this.activeTab.set('General'); // Reset to first tab
  }

  resetForm(): void {
    this.form = {
      type: 'physical',
      title: '',
      subtitle: null,

      author: null,
      editor: null, // <--- NEW
      translator: null,
      narrator: null,

      description: null,

      isbn: null,
      asin: null,

      publisher: null,
      placeOfPublication: null, // <--- NEW
      publishedDate: null,

      edition: null,
      pageCount: null,
      duration: null,
      language: 'en',
      categories: null,
      series: null,
      volumeNumber: null,
      collectionId: null,

      personalReview: null, // <--- NEW
    };
    this.selectedFile = null;
    this.selectedCover = null;
    this.uploadProgress.set(null);
    this.isFetching.set(false);
    this.activeTab.set('General');
  }

  /**
   * Helper to format dates into YYYY or YYYY-MM-DD
   */
  sanitizeDate(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const clean = dateStr.trim();

    // 1. If it's already just a year (e.g. "1999"), keep it.
    if (/^\d{4}$/.test(clean)) return clean;

    // 2. Try parsing as a standard date (handles "Jan 1, 2020", "2020/01/01")
    const timestamp = Date.parse(clean);
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
    }

    // 3. Fallback: Try to just find a 4-digit year in the string
    const yearMatch = clean.match(/\d{4}/);
    return yearMatch ? yearMatch[0] : clean;
  }

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
            // Note: Editor usually isn't returned clearly by basic lookup, but Place is:
            description: data.description || this.form.description,
            publisher: data.publisher || this.form.publisher,
            placeOfPublication: data.placeOfPublication || this.form.placeOfPublication, // <--- Map from API
            // Sanitize the date coming from the API
            publishedDate: this.sanitizeDate(data.publishedDate) || this.form.publishedDate,
            pageCount: data.pageCount || this.form.pageCount,
            language: this.getFullLanguageName(data.language) || this.form.language,
            categories: data.categories || this.form.categories,
          };
          // Switch to general tab to show results
          this.activeTab.set('General');
        },
        error: () => alert('Book details not found.'),
      });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedCover = input.files?.[0] ?? null;
  }

  submit(): void {
    if (!this.form.title.trim()) return;

    // Sanitize Language
    if (this.form.language) {
      this.form.language = this.getFullLanguageName(this.form.language) || this.form.language;
    }

    // Sanitize Date
    const cleanDate = this.sanitizeDate(this.form.publishedDate);

    const payload = { ...this.form, publishedDate: cleanDate || null };

    if (this.isEditMode()) {
      this.booksService.update(this.book()!.id, payload).subscribe({
        next: (updated) => {
          this.bookUpdated.emit(updated);
          this.closeModal.emit();
        },
        error: (err) => console.error('Update failed', err),
      });
    } else {
      this.booksService.create(payload).subscribe({
        next: (createdBook) => {
          if (this.selectedFile) this.handleFileUpload(createdBook);
          else this.uploadCoverIfNeeded(createdBook.id);
        },
        error: (err) => console.error('Creation failed', err),
      });
    }
  }

  handleFileUpload(createdBook: BookModel): void {
    this.uploadStartTime = performance.now();
    this.booksService.uploadFile(createdBook.id, this.selectedFile!).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const percent = Math.round((event.loaded / (event.total ?? 1)) * 100);
          this.uploadProgress.set(percent);
        }
        if (event.type === HttpEventType.Response) {
          const elapsed = performance.now() - (this.uploadStartTime ?? 0);
          setTimeout(() => {
            this.uploadProgress.set(null);
            this.uploadCoverIfNeeded(createdBook.id);
          }, Math.max(0, 1200 - elapsed));
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

  private getFullLanguageName(input: string | null): string | null {
    if (!input) return null;
    const clean = input.trim();
    if (clean.length > 3) return clean;
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(clean) || clean;
    } catch (e) {
      return clean;
    }
  }
}
