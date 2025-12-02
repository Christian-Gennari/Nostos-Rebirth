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
} from 'lucide-angular';
import { AddBookModal } from '../add-book-modal/add-book-modal';
import { HttpEventType } from '@angular/common/http';
import { ConceptAutocompleteService } from '../misc-components/concept-autocomplete-panel/concept-autocomplete.service';
import { ConceptAutocompleteDirective } from '../directives/concept-autocomplete.directive';
import { ConceptAutocompletePanel } from '../misc-components/concept-autocomplete-panel/concept-autocomplete-panel';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    AddBookModal,
    ConceptAutocompleteDirective,
    ConceptAutocompletePanel,
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

  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);

  collections = signal<Collection[]>([]);

  isDescriptionExpanded = signal(false);
  showMetadataModal = signal(false);

  metaForm = {
    title: '',
    subtitle: '' as string | null,
    author: '' as string | null,
    collectionId: null as string | null,
    description: '' as string | null,
    isbn: '' as string | null,
    publisher: '' as string | null,
    publishedDate: '' as string | null,
    pageCount: 0 as number | null,
    language: '' as string | null,
    categories: '' as string | null,
    series: '' as string | null,
    volumeNumber: '' as string | null,
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

        // This line integrates with autocomplete service
        this.autocompleteService.setConcepts(concepts);
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

  toggleDescription() {
    this.isDescriptionExpanded.update((v) => !v);
  }

  openMetadataModal(): void {
    const b = this.book();
    if (!b) return;

    this.metaForm = {
      title: b.title,
      subtitle: b.subtitle || '',
      author: b.author,
      collectionId: b.collectionId,
      description: b.description || '',
      isbn: b.isbn || '',
      publisher: b.publisher || '',
      publishedDate: b.publishedDate ? new Date(b.publishedDate).toISOString().split('T')[0] : '',
      pageCount: b.pageCount || null,
      language: b.language || 'en',
      categories: b.categories || '',
      series: b.series || '',
      volumeNumber: b.volumeNumber || '',
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
        subtitle: this.metaForm.subtitle,
        author: this.metaForm.author,
        collectionId: this.metaForm.collectionId,
        isbn: this.metaForm.isbn,
        publisher: this.metaForm.publisher,
        publishedDate: this.metaForm.publishedDate
          ? new Date(this.metaForm.publishedDate).toISOString()
          : null,
        pageCount: this.metaForm.pageCount,
        description: this.metaForm.description,
        language: this.metaForm.language,
        categories: this.metaForm.categories,
        series: this.metaForm.series,
        volumeNumber: this.metaForm.volumeNumber,
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
        this.loadConcepts(); // ADDED
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
          this.loadConcepts(); // ADDED
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
        if (book) {
          this.loadNotes(book.id);
          this.loadConcepts(); // ADDED
        }
      },
    });
  }

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
      next: (event) => {
        if (event.type === HttpEventType.Response) {
          this.loadBook(book.id);
        }
      },
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

  getCollectionName(id: string | null | undefined): string {
    if (!id) return '—';
    const col = this.collections().find((c) => c.id === id);
    return col ? col.name : '—';
  }

  insertConceptIntoNote(concept: ConceptDto) {
    const text = this.newNote();
    const beforeCursor = text.substring(0, this.getCursorPos('new'));
    const afterCursor = text.substring(this.getCursorPos('new'));

    const newText = beforeCursor.replace(/\[\[[^\[]*$/, '[[' + concept.name + ']] ') + afterCursor;

    this.newNote.set(newText);
  }

  insertConceptIntoEdit(concept: ConceptDto) {
    const text = this.editNoteContent();
    const beforeCursor = text.substring(0, this.getCursorPos('edit'));
    const afterCursor = text.substring(this.getCursorPos('edit'));

    const newText = beforeCursor.replace(/\[\[[^\[]*$/, '[[' + concept.name + ']] ') + afterCursor;

    this.editNoteContent.set(newText);
  }

  // Helper to read cursor positions from textareas
  getCursorPos(which: 'new' | 'edit'): number {
    const selector = which === 'new' ? '#new-note-textarea' : '#edit-note-textarea';

    const el = document.querySelector(selector) as HTMLTextAreaElement;
    return el ? el.selectionStart : 0;
  }
}
