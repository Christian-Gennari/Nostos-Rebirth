import { Injectable, inject, signal } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { finalize } from 'rxjs';

// DTOs & Services
import { Book } from '../dtos/book.dtos';
import { Note } from '../dtos/note.dtos';
import { Collection } from '../dtos/collection.dtos';
import { ConceptDto } from '../services/concepts.services';
import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { CollectionsService } from '../services/collections.services';
import { ConceptsService } from '../services/concepts.services';
import { ConceptAutocompleteService } from '../misc-components/concept-autocomplete-panel/concept-autocomplete.service';

@Injectable()
export class BookDetailStore {
  // Dependencies
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);
  private collectionsService = inject(CollectionsService);
  private conceptsService = inject(ConceptsService);
  private autocompleteService = inject(ConceptAutocompleteService);

  // --- STATE ---
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly book = signal<Book | null>(null);
  readonly notes = signal<Note[]>([]);
  readonly collections = signal<Collection[]>([]);
  readonly conceptMap = signal<Map<string, ConceptDto>>(new Map());

  // --- ACTIONS ---

  loadAllData(id: string) {
    // Reset state for new book
    if (this.book()?.id !== id) {
      this.book.set(null);
      this.notes.set([]);
      this.error.set(null);
      this.loading.set(true);
    }

    this.loadBook(id);
    this.loadNotes(id);
    this.loadCollections();
    this.loadConcepts();
  }

  loadBook(id: string, options: { forceImageRefresh?: boolean; background?: boolean } = {}) {
    if (!options.background) this.loading.set(true);

    this.booksService
      .get(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (data) => {
          if (options.forceImageRefresh && data.coverUrl) {
            data.coverUrl += `?t=${Date.now()}`;
          }
          this.book.set(data);
        },
        error: (err) => this.error.set('Book not found'),
      });
  }

  loadNotes(id: string) {
    this.notesService.list(id).subscribe({
      next: (data) => this.notes.set(data),
    });
  }

  loadCollections() {
    this.collectionsService.list().subscribe({
      next: (data) => this.collections.set(data),
    });
  }

  loadConcepts() {
    this.conceptsService.list().subscribe({
      next: (concepts) => {
        const map = new Map<string, ConceptDto>();
        concepts.forEach((c) => map.set(c.name.trim().toLowerCase(), c));
        this.conceptMap.set(map);
        this.autocompleteService.setConcepts(concepts);
      },
    });
  }

  // --- OPTIMISTIC UPDATES ---

  toggleFavorite() {
    const b = this.book();
    if (!b) return;

    const newStatus = !b.isFavorite;

    // 1. Optimistic Update
    this.book.update((curr) => (curr ? { ...curr, isFavorite: newStatus } : null));

    // 2. API Call
    this.booksService.update(b.id, { isFavorite: newStatus } as any).subscribe({
      error: () => {
        // Revert on error
        this.book.update((curr) => (curr ? { ...curr, isFavorite: !newStatus } : null));
        this.error.set('Failed to update favorite');
      },
    });
  }

  toggleFinished() {
    const b = this.book();
    if (!b) return;

    const isFinished = !!b.finishedAt;
    const newStatus = !isFinished;
    const newDate = newStatus ? new Date().toISOString() : null;
    const newProgress = newStatus ? 100 : b.progressPercent;

    // 1. Optimistic
    this.book.update((curr) =>
      curr
        ? {
            ...curr,
            finishedAt: newDate,
            progressPercent: newProgress,
          }
        : null
    );

    // 2. API
    this.booksService.update(b.id, { isFinished: newStatus }).subscribe({
      next: (updated) => this.book.set(updated), // Sync full state from server response
      error: () => this.loadBook(b.id, { background: true }), // Revert/Refresh on error
    });
  }

  rate(rating: number) {
    const b = this.book();
    if (!b) return;

    this.book.update((curr) => (curr ? { ...curr, rating } : null));

    this.booksService.update(b.id, { rating } as any).subscribe({
      error: () => this.error.set('Failed to update rating'),
    });
  }

  // --- NOTES ---

  addNote(content: string) {
    const b = this.book();
    if (!b || !content.trim()) return;

    this.notesService.create(b.id, { content }).subscribe({
      next: () => {
        this.loadNotes(b.id);
        this.loadConcepts(); // Refresh concepts as note might have added new ones
      },
    });
  }

  updateNote(id: string, content: string, selectedText?: string) {
    const b = this.book();
    if (!b) return;

    this.notesService.update(id, { content, selectedText }).subscribe({
      next: () => {
        this.loadNotes(b.id);
        this.loadConcepts();
      },
    });
  }

  deleteNote(noteId: string) {
    if (!confirm('Delete this note?')) return;

    const b = this.book();
    if (!b) return;

    this.notesService.delete(noteId).subscribe({
      next: () => {
        this.loadNotes(b.id);
        this.loadConcepts();
      },
    });
  }

  // --- FILES ---

  uploadCover(file: File) {
    const b = this.book();
    if (!b) return;

    this.booksService.uploadCover(b.id, file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.Response) {
          this.loadBook(b.id, { forceImageRefresh: true, background: true });
        }
      },
      error: () => this.error.set('Failed to upload cover'),
    });
  }

  deleteCover() {
    const b = this.book();
    if (!b || !confirm('Remove cover image?')) return;

    this.booksService.deleteCover(b.id).subscribe({
      next: () => this.loadBook(b.id, { background: true }),
    });
  }

  uploadFile(file: File) {
    const b = this.book();
    if (!b) return;

    this.booksService.uploadFile(b.id, file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.Response) {
          this.loadBook(b.id, { background: true });
        }
      },
    });
  }
}
