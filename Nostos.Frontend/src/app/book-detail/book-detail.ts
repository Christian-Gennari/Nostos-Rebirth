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
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';
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
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [CommonModule, FormsModule, RouterLink, SidebarCollections, LucideAngularModule],
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

  ArrowLeftIcon = ArrowLeft;
  UserIcon = User;
  CalendarIcon = Calendar;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  AlertCircleIcon = AlertCircle;
  BookOpenIcon = BookOpen;
  CheckIcon = CheckIcon;
  ChevronDownIcon = ChevronDown;

  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);
  

  collections = signal<Collection[]>([]);
  showMetadataModal = signal(false);
  metaForm = {
    title: '',
    author: '' as string | null,
    collectionId: null as string | null,
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

  // --- Metadata Modal Logic ---
  openMetadataModal(): void {
    const b = this.book();
    if (!b) return;
    this.metaForm = {
      title: b.title,
      author: b.author,
      collectionId: b.collectionId,
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
        author: this.metaForm.author,
        collectionId: this.metaForm.collectionId,
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

  // --- FILE / COVER LOGIC (fully restored) ---

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

    const formData = new FormData();
    formData.append('file', file);

    this.booksService.uploadCover(book.id, file).subscribe({
      next: (updated) => {
        this.book.set(updated);
      },
      error: () => {
        this.error.set('Failed to upload cover');
      },
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

  // --- Concept Tag Formatter ---
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
}
