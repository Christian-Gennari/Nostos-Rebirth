import { Component, inject, OnInit, signal, model } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { BooksService, Book } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { CollectionsService } from '../services/collections.services';
import { ConceptDto, ConceptsService } from '../services/concepts.services';
import { Collection } from '../dtos/collection.dtos';
import { Note } from '../dtos/note.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  ArrowLeft,
  User,
  Calendar,
  Trash2,
  Edit2,
  AlertCircle,
  BookOpen,
  CheckIcon,
  ChevronDown,
  ChevronUp,
  Hash,
  Layers,
  Building,
} from 'lucide-angular';
import { AddBookModal } from '../add-book-modal/add-book-modal';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, AddBookModal],
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

  // Icons
  ArrowLeftIcon = ArrowLeft;
  UserIcon = User;
  CalendarIcon = Calendar;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  AlertCircleIcon = AlertCircle;
  BookOpenIcon = BookOpen;
  CheckIcon = CheckIcon;
  ChevronDownIcon = ChevronDown;
  ChevronUpIcon = ChevronUp;
  HashIcon = Hash;
  LayersIcon = Layers;
  BuildingIcon = Building;

  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);

  collections = signal<Collection[]>([]);

  // UI State for Metadata expansion
  isMetadataExpanded = signal(false);

  showMetadataModal = signal(false);

  // Expanded Form State
  metaForm = {
    title: '',
    subtitle: '' as string | null, // <--- NEW
    author: '' as string | null,
    collectionId: null as string | null,
    description: '' as string | null,
    isbn: '' as string | null,
    publisher: '' as string | null,
    publishedDate: '' as string | null,
    pageCount: 0 as number | null,
    language: '' as string | null, // <--- NEW
    categories: '' as string | null, // <--- NEW
    series: '' as string | null, // <--- NEW
    volumeNumber: '' as string | null, // <--- NEW
  };

  notes = signal<Note[]>([]);
  newNote = model<string>('');
  editingNote = signal<Note | null>(null);
  editNoteContent = model<string>('');

  coverInput!: HTMLInputElement;
  conceptMap = signal<Map<string, ConceptDto>>(new Map());

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

  loadBook(id: string): void {
    this.booksService.get(id).subscribe({
      next: (book) => {
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
      },
    });
  }

  goToConcept(conceptId: string): void {
    this.router.navigate(['/second-brain'], { queryParams: { conceptId } });
  }

  handleNoteClick(event: Event): void {
    const target = event.target as HTMLElement;
    const conceptTag = target.closest('.concept-tag');

    if (conceptTag) {
      const conceptId = conceptTag.getAttribute('data-concept-id');
      if (conceptId) {
        event.preventDefault();
        event.stopPropagation();
        this.goToConcept(conceptId);
      }
    }
  }

  toggleMetadata() {
    this.isMetadataExpanded.update((v) => !v);
  }

  // --- Metadata Modal Logic ---
  openMetadataModal(): void {
    const b = this.book();
    if (!b) return;

    // Initialize form with ALL existing metadata
    this.metaForm = {
      title: b.title,
      subtitle: b.subtitle || '', // <--- NEW
      author: b.author,
      collectionId: b.collectionId,
      description: b.description || '',
      isbn: b.isbn || '',
      publisher: b.publisher || '',
      publishedDate: b.publishedDate ? new Date(b.publishedDate).toISOString().split('T')[0] : '',
      pageCount: b.pageCount || null,
      language: b.language || 'en', // <--- NEW
      categories: b.categories || '', // <--- NEW
      series: b.series || '', // <--- NEW
      volumeNumber: b.volumeNumber || '', // <--- NEW
    };
    this.showMetadataModal.set(true);
  }

  closeMetadataModal(): void {
    this.showMetadataModal.set(false);
  }

  saveMetadata(): void {
    const b = this.book();
    if (!b) return;

    this.booksService
      .update(b.id, {
        title: this.metaForm.title,
        subtitle: this.metaForm.subtitle, // <--- NEW
        author: this.metaForm.author,
        collectionId: this.metaForm.collectionId,
        isbn: this.metaForm.isbn,
        publisher: this.metaForm.publisher,
        publishedDate: this.metaForm.publishedDate
          ? new Date(this.metaForm.publishedDate).toISOString()
          : null,
        pageCount: this.metaForm.pageCount,
        description: this.metaForm.description,
        language: this.metaForm.language, // <--- NEW
        categories: this.metaForm.categories, // <--- NEW
        series: this.metaForm.series, // <--- NEW
        volumeNumber: this.metaForm.volumeNumber, // <--- NEW
      })
      .subscribe({
        next: (updatedBook) => {
          this.book.set(updatedBook);
          this.closeMetadataModal();
        },
      });
  }

  // --- Notes Logic ---
  addNote(): void {
    const book = this.book();
    if (!book) return;

    const content = this.newNote().trim();
    if (!content) return;

    this.notesService.create(book.id, { content }).subscribe({
      next: () => {
        this.newNote.set('');
        this.loadNotes(book.id);
      },
    });
  }

  startEdit(note: Note): void {
    this.editingNote.set(note);
    this.editNoteContent.set(note.content);
  }

  saveEdit(): void {
    const note = this.editingNote();
    if (!note) return;

    this.notesService
      .update(note.id, {
        content: this.editNoteContent(),
      })
      .subscribe({
        next: () => {
          this.editingNote.set(null);
          this.loadNotes(note.bookId);
        },
      });
  }

  cancelEdit(): void {
    this.editingNote.set(null);
  }

  deleteNote(id: string): void {
    if (!confirm('Delete this note?')) return;

    this.notesService.delete(id).subscribe({
      next: () => {
        const book = this.book();
        if (book) this.loadNotes(book.id);
      },
    });
  }

  // --- FILE / COVER LOGIC ---
  openFile() {
    const id = this.book()?.id;
    if (!id) return;
    window.open(`/api/books/${id}/file`, '_blank');
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
      next: (updated) => this.book.set(updated),
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
      'input[type=file][accept=".epub,.pdf,.txt"]'
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
      next: () => this.loadBook(book.id),
      error: (err) => console.error('File upload error:', err),
    });
  }

  formatNote(content: string): string {
    const conceptMap = this.conceptMap();
    return content.replace(/\[\[(.*?)\]\]/g, (match, conceptName) => {
      const trimmedName = conceptName.trim();
      const concept = conceptMap.get(trimmedName.toLowerCase());
      if (concept) {
        return `<span class="concept-tag clickable" data-concept-id="${concept.id}">${trimmedName}</span>`;
      }
      return trimmedName;
    });
  }

  onBookUpdated(updatedBook: Book): void {
    this.book.set(updatedBook);
  }

  // Add this inside the BookDetail class
  getCollectionName(id: string | null | undefined): string {
    if (!id) return '—';
    const col = this.collections().find((c) => c.id === id);
    return col ? col.name : '—';
  }
}
