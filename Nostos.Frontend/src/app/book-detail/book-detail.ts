import { Component, inject, OnInit, signal, model } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router'; // ADD Router
import { BooksService, Book } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { CollectionsService } from '../services/collections.services';
import { ConceptDto, ConceptsService } from '../services/concepts.services'; // ADD ConceptsService and ConceptDto
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
  private router = inject(Router); // INJECT ROUTER
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);
  private collectionsService = inject(CollectionsService);
  private conceptsService = inject(ConceptsService); // INJECT ConceptsService

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

  // State
  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);

  // Collections State
  collections = signal<Collection[]>([]);
  showMetadataModal = signal(false);
  metaForm = {
    title: '',
    author: '' as string | null,
    collectionId: null as string | null,
  };

  // Notes State
  notes = signal<Note[]>([]);
  newNote = model<string>('');
  editingNote = signal<Note | null>(null);
  editNoteContent = model<string>('');

  coverInput!: HTMLInputElement;

  // NEW: Concept map for quick lookup (Concept Name -> Concept ID)
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
    this.loadConcepts(); // NEW: Load concepts on init
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

  // NEW: Load all concepts and create a map (Case-insensitive lookup)
  loadConcepts(): void {
    this.conceptsService.list().subscribe({
      next: (concepts) => {
        const map = new Map<string, ConceptDto>();
        // Use lowercase for case-insensitive matching
        concepts.forEach((c) => map.set(c.name.trim().toLowerCase(), c));
        this.conceptMap.set(map);
      },
    });
  }

  // NEW: Navigation function to Second Brain
  goToConcept(conceptId: string): void {
    this.router.navigate(['/second-brain'], { queryParams: { conceptId: conceptId } });
  }

  // NEW: Event delegation handler for notes
  handleNoteClick(event: Event): void {
    const target = event.target as HTMLElement;

    // Use closest() to check if the click originated inside a highlighted concept tag
    const conceptTag = target.closest('.concept-tag');

    if (conceptTag) {
      const conceptId = conceptTag.getAttribute('data-concept-id');

      if (conceptId) {
        event.preventDefault(); // Stop any default behavior
        event.stopPropagation(); // Prevent the click from affecting other note actions
        this.goToConcept(conceptId);
      }
    }
  }

  // --- Metadata Modal Logic ---
  openMetadataModal(): void {
    const b = this.book();
    if (!b) return;

    // Initialize form with current values
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

  // --- File/Cover Logic (omitted for brevity) ---
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
    if (!file || !this.book()?.id) return;

    this.booksService.uploadCover(this.book()!.id, file).subscribe({
      next: (event) => {
        if (event.type === 4) {
          this.loadBook(this.book()!.id);
        }
      },
      error: (err) => console.error('Cover upload error:', err),
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
    if (!file || !this.book()?.id) return;

    this.booksService.uploadFile(this.book()!.id, file).subscribe({
      next: () => {
        this.loadBook(this.book()!.id);
      },
      error: (err) => console.error('File upload error:', err),
    });
  }

  // MODIFIED: Inject Concept ID into the HTML output
  formatNote(content: string): string {
    const conceptMap = this.conceptMap();

    // Regex finds [[...]]
    return content.replace(/\[\[(.*?)\]\]/g, (match, conceptName) => {
      const trimmedName = conceptName.trim();
      const concept = conceptMap.get(trimmedName.toLowerCase());

      if (concept) {
        // Embed the ID as a data attribute and add 'clickable' class
        return `<span class="concept-tag clickable" data-concept-id="${concept.id}">${trimmedName}</span>`;
      }
      // If concept not found, just return the name without highlighting
      return trimmedName;
    });
  }
}
