import { Component, inject, OnInit, signal, model } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';

// Services & DTOs
import { BooksService, Book } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { CollectionsService } from '../services/collections.services';
import { ConceptDto, ConceptsService } from '../services/concepts.services';
import { ConceptAutocompleteService } from '../misc-components/concept-autocomplete-panel/concept-autocomplete.service';
import { Collection } from '../dtos/collection.dtos';
import { Note } from '../dtos/note.dtos';

// UI Components
import { AddBookModal } from '../add-book-modal/add-book-modal';
import { ConceptInputComponent } from '../ui/concept-input.component/concept-input.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';

// Icons
import {
  LucideAngularModule,
  ArrowLeft,
  User,
  Calendar,
  Trash2,
  Edit2,
  CircleAlert,
  BookOpen,
  CheckIcon,
  ChevronDown,
  ChevronUp,
  Hash,
  Layers,
  Building,
  BookDown,
  Image,
  Headphones,
  Clock,
  Heart,
  CheckCircle,
  Mic,
  MapPin, // <--- NEW
  MessageSquareQuote, // <--- NEW
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    AddBookModal,
    ConceptInputComponent,
    NoteCardComponent,
    StarRatingComponent,
  ],
  templateUrl: './book-detail.html',
  styleUrls: ['./book-detail.css'],
})
export class BookDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);
  private collectionsService = inject(CollectionsService);
  private conceptsService = inject(ConceptsService);
  private autocompleteService = inject(ConceptAutocompleteService);

  // Icons
  ArrowLeftIcon = ArrowLeft;
  UserIcon = User;
  CalendarIcon = Calendar;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  AlertCircleIcon = CircleAlert;
  BookOpenIcon = BookOpen;
  CheckIcon = CheckIcon;
  ChevronDownIcon = ChevronDown;
  ChevronUpIcon = ChevronUp;
  HashIcon = Hash;
  LayersIcon = Layers;
  BuildingIcon = Building;
  BookDownIcon = BookDown;
  ImageIcon = Image;
  HeadphonesIcon = Headphones;
  ClockIcon = Clock;
  HeartIcon = Heart;
  CheckCircleIcon = CheckCircle;
  MicIcon = Mic;
  MapPinIcon = MapPin; // <--- NEW
  QuoteIcon = MessageSquareQuote; // <--- NEW

  // State
  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);
  collections = signal<Collection[]>([]);

  // UI State
  isDescriptionExpanded = signal(false);
  showMetadataModal = signal(false);

  // Notes State
  notes = signal<Note[]>([]);
  conceptMap = signal<Map<string, ConceptDto>>(new Map());

  // New Note Input (Still managed here)
  newNote = model<string>('');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Invalid book ID');
      this.loading.set(false);
      return;
    }

    this.loadBook(id);
    this.loadNotes(id);
    this.loadCollections();
    this.loadConcepts();
  }

  loadBook(id: string, forceRefresh = false): void {
    this.booksService.get(id).subscribe({
      next: (book) => {
        if (forceRefresh && book.coverUrl) {
          book.coverUrl += `?t=${Date.now()}`;
        }
        this.book.set(book);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Book not found');
        this.loading.set(false);
      },
    });
  }

  loadNotes(bookId: string): void {
    this.notesService.list(bookId).subscribe({
      next: (notes) => this.notes.set(notes),
    });
  }

  loadCollections(): void {
    this.collectionsService.list().subscribe({
      next: (data) => this.collections.set(data),
    });
  }

  loadConcepts(): void {
    this.conceptsService.list().subscribe({
      next: (concepts) => {
        const map = new Map<string, ConceptDto>();
        concepts.forEach((c) => map.set(c.name.trim().toLowerCase(), c));
        this.conceptMap.set(map);
        this.autocompleteService.setConcepts(concepts);
      },
    });
  }

  // --- Actions ---

  goToConcept(conceptId: string): void {
    this.router.navigate(['/second-brain'], { queryParams: { conceptId } });
  }

  toggleDescription() {
    this.isDescriptionExpanded.update((v) => !v);
  }

  openMetadataModal(): void {
    const b = this.book();
    if (!b) return;
    this.showMetadataModal.set(true);
  }

  closeMetadataModal(): void {
    this.showMetadataModal.set(false);
  }

  // --- Ratings & Favorites Actions ---

  toggleFavorite() {
    const book = this.book();
    if (!book) return;

    const newStatus = !book.isFavorite;

    // Optimistic UI update
    this.book.update((b) => (b ? { ...b, isFavorite: newStatus } : null));

    // Call API
    this.booksService.update(book.id, { isFavorite: newStatus } as any).subscribe({
      error: () => {
        this.book.update((b) => (b ? { ...b, isFavorite: !newStatus } : null));
        this.error.set('Failed to update favorite status');
      },
    });
  }

  toggleFinished() {
    const book = this.book();
    if (!book) return;

    const isCurrentlyFinished = !!book.finishedAt;
    const newIsFinished = !isCurrentlyFinished;
    const newDate = newIsFinished ? new Date().toISOString() : null;
    const newProgress = newIsFinished ? 100 : book.progressPercent;

    // 1. Optimistic UI update
    this.book.update((b) =>
      b
        ? {
            ...b,
            finishedAt: newDate,
            progressPercent: newProgress,
          }
        : null
    );

    // 2. Send API Request
    const updatePayload: any = {
      isFinished: newIsFinished,
    };

    this.booksService.update(book.id, updatePayload).subscribe({
      next: (updatedBook) => {
        this.book.set(updatedBook);
      },
      error: () => {
        this.loadBook(book.id);
      },
    });
  }

  onRate(newRating: number) {
    const book = this.book();
    if (!book) return;

    this.book.update((b) => (b ? { ...b, rating: newRating } : null));

    this.booksService.update(book.id, { rating: newRating } as any).subscribe({
      error: () => this.error.set('Failed to update rating'),
    });
  }

  // --- Note Logic ---

  addNote(): void {
    const book = this.book();
    if (!book) return;

    const content = this.newNote().trim();
    if (!content) return;

    this.notesService.create(book.id, { content }).subscribe({
      next: () => {
        this.newNote.set('');
        this.loadNotes(book.id);
        this.loadConcepts();
      },
    });
  }

  onUpdateNote(event: { id: string; content: string }): void {
    const book = this.book();
    if (!book) return;

    this.notesService.update(event.id, { content: event.content }).subscribe({
      next: () => {
        this.loadNotes(book.id);
        this.loadConcepts();
      },
    });
  }

  onDeleteNote(id: string): void {
    if (!confirm('Delete this note?')) return;

    this.notesService.delete(id).subscribe({
      next: () => {
        const book = this.book();
        if (book) {
          this.loadNotes(book.id);
          this.loadConcepts();
        }
      },
    });
  }

  onConceptClick(conceptId: string): void {
    this.goToConcept(conceptId);
  }

  // --- Book Files / Metadata ---

  downloadFile() {
    const id = this.book()?.id;
    if (!id) return;
    window.open(`/api/books/${id}/file`, '_blank');
  }

  openReader() {
    const id = this.book()?.id;
    if (!id) return;
    this.router.navigate(['/read', id]);
  }

  triggerCoverPicker() {
    const input = document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement;
    if (input) input.click();
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const book = this.book();
    if (!book) return;

    this.booksService.uploadCover(book.id, file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.Response) {
          this.loadBook(book.id, true);
        }
      },
      error: () => this.error.set('Failed to upload cover'),
    });
  }

  deleteCover() {
    const id = this.book()?.id;
    if (!id) return;
    if (!confirm('Remove cover image?')) return;

    this.booksService.deleteCover(id).subscribe({
      next: () => this.loadBook(id),
      error: (err) => console.error('Delete cover error:', err),
    });
  }

  triggerFilePicker() {
    const input = document.querySelector(
      'input[type=file][accept=".epub,.pdf,.txt,.mobi,.mp3,.m4a,.m4b"]'
    ) as HTMLInputElement;
    if (input) input.click();
  }

  onFileUploadSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const book = this.book();
    if (!book) return;

    this.booksService.uploadFile(book.id, file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.Response) {
          this.loadBook(book.id);
        }
      },
      error: (err) => console.error('File upload error:', err),
    });
  }

  onBookUpdated(updatedBook: Book): void {
    this.book.set(updatedBook);
  }

  getCollectionName(id: string | null | undefined): string {
    if (!id) return '—';
    const col = this.collections().find((c) => c.id === id);
    return col ? col.name : '—';
  }

  isAudioBook(book: Book | null): boolean {
    return book?.type === 'audiobook';
  }
}
