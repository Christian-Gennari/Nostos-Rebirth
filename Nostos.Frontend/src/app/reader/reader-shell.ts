// src/app/reader/reader-shell.ts
import { Component, inject, OnInit, signal, computed, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  ArrowLeft,
  NotebookPen,
  MessageSquareQuote,
  StickyNote,
  Edit2,
  Trash2,
  X,
  Check,
  Clock,
  List,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Save,
  Plus,
  Info,
} from 'lucide-angular';
import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services';
// 👇 Refactor: Imports for concepts
import { ConceptsService } from '../services/concepts.services';
import { ConceptAutocompleteService } from '../misc-components/concept-autocomplete-panel/concept-autocomplete.service';
import { ConceptInputComponent } from '../ui/concept-input.component/concept-input.component';

import { Note } from '../dtos/note.dtos';
import { IReader, TocItem } from './reader.interface';
import { PdfReader } from './pdf-reader/pdf-reader';
import { EpubReader } from './epub-reader/epub-reader';
import { AudioReader } from './audio-reader/audio-reader';

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  // 👇 Refactor: Added ConceptInputComponent
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    PdfReader,
    EpubReader,
    AudioReader,
    ConceptInputComponent,
  ],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.css',
})
export class ReaderShell implements OnInit {
  @ViewChild(EpubReader) epubReader?: IReader;
  @ViewChild(PdfReader) pdfReader?: IReader;
  @ViewChild(AudioReader) audioReader?: IReader;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);
  // 👇 Refactor: Inject services to load concepts
  private conceptsService = inject(ConceptsService);
  private autocompleteService = inject(ConceptAutocompleteService);

  Icons = {
    ArrowLeft,
    NotebookPen,
    MessageSquareQuote,
    StickyNote,
    Edit: Edit2,
    Delete: Trash2,
    Close: X,
    Check,
    Clock,
    List,
    ZoomIn,
    ZoomOut,
    Prev: ChevronLeft,
    Next: ChevronRight,
    Save,
    Plus,
    Info,
  };

  book = signal<any>(null);
  loading = signal(true);
  notesOpen = signal(false);
  tocOpen = signal(false);
  ready = signal(false);

  dbNotes = signal<Note[]>([]);
  quickNoteContent = signal('');

  editingNoteId = signal<string | null>(null);
  editContent = signal('');

  // --- UNIFIED READER LOGIC ---

  fileType = computed<'pdf' | 'epub' | 'audio' | null>(() => {
    const fileName = this.book()?.fileName?.toLowerCase();
    if (!fileName) return null;
    if (fileName.endsWith('.pdf')) return 'pdf';
    if (fileName.endsWith('.epub')) return 'epub';
    if (fileName.endsWith('.m4b') || fileName.endsWith('.m4a') || fileName.endsWith('.mp3'))
      return 'audio';
    return null;
  });

  activeReader = computed<IReader | null>(() => {
    if (!this.ready()) return null;
    switch (this.fileType()) {
      case 'epub':
        return this.epubReader ?? null;
      case 'pdf':
        return this.pdfReader ?? null;
      case 'audio':
        return this.audioReader ?? null;
      default:
        return null;
    }
  });

  toc = computed(() => this.activeReader()?.toc() ?? []);
  progressState = computed(() => this.activeReader()?.progress());
  progressLabel = computed(() => this.progressState()?.label ?? '');
  progressTooltip = computed(() => this.progressState()?.tooltip ?? '');

  nextPage() {
    this.activeReader()?.next();
  }
  prevPage() {
    this.activeReader()?.previous();
  }
  zoomIn() {
    this.activeReader()?.zoomIn();
  }
  zoomOut() {
    this.activeReader()?.zoomOut();
  }

  handleTocClick(item: TocItem) {
    this.activeReader()?.goTo(item.target);
    this.tocOpen.set(false);
  }

  // --- INITIALIZATION ---

  ngOnInit() {
    // 👇 Refactor: Load concepts immediately so they are ready for the inputs
    this.loadConcepts();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.booksService.get(id).subscribe({
        next: (b) => {
          this.book.set(b);
          this.loading.set(false);
          this.loadNotes(b.id);
          setTimeout(() => this.ready.set(true), 100);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  // 👇 Refactor: Helper to populate the autocomplete service
  loadConcepts() {
    this.conceptsService.list().subscribe({
      next: (concepts) => this.autocompleteService.setConcepts(concepts),
    });
  }

  loadNotes(bookId: string) {
    this.notesService.list(bookId).subscribe((notes) => {
      this.dbNotes.set(notes.reverse());
    });
  }

  handleNoteCreated() {
    const id = this.book()?.id;
    if (id) {
      this.loadNotes(id);
      if (!this.notesOpen()) this.notesOpen.set(true);
    }
  }

  toggleNotes() {
    this.notesOpen.update((v) => !v);
    if (this.notesOpen()) this.tocOpen.set(false);
  }

  toggleToc() {
    this.tocOpen.update((v) => !v);
    if (this.tocOpen()) this.notesOpen.set(false);
  }

  // --- NOTES LOGIC ---

  addAudioTimestamp() {
    if (this.fileType() !== 'audio' || !this.activeReader()) return;
    const label = this.activeReader()?.progress().label;
    if (label) {
      const currentTime = label.split(' / ')[0];
      this.quickNoteContent.update((current) => {
        const prefix = current.length > 0 ? ' ' : '';
        return current + prefix + `[${currentTime}] `;
      });
    }
  }

  saveQuickNote() {
    const content = this.quickNoteContent().trim();
    if (!content) return;
    const bookId = this.book()?.id;
    if (!bookId) return;

    const currentCfi = this.activeReader()?.getCurrentLocation() || undefined;

    this.notesService.create(bookId, { content, cfiRange: currentCfi }).subscribe({
      next: () => {
        this.quickNoteContent.set('');
        this.loadNotes(bookId);
        // Refresh concepts in case a new one was created (if you add that feature later)
        this.loadConcepts();
      },
    });
  }

  // --- EDITING LOGIC ---

  startEdit(note: Note, event?: Event) {
    event?.stopPropagation();
    this.editingNoteId.set(note.id);
    this.editContent.set(note.content || '');
  }

  cancelEdit(event?: Event) {
    event?.stopPropagation();
    this.editingNoteId.set(null);
    this.editContent.set('');
  }

  saveEdit(note: Note, event?: Event) {
    event?.stopPropagation();
    const newContent = this.editContent().trim();
    this.notesService.update(note.id, { content: newContent }).subscribe({
      next: (updated) => {
        this.dbNotes.update((notes) => notes.map((n) => (n.id === updated.id ? updated : n)));
        this.editingNoteId.set(null);
      },
    });
  }

  deleteNote(noteId: string, event?: Event) {
    event?.stopPropagation();
    if (!confirm('Delete this note?')) return;

    const noteToDelete = this.dbNotes().find((n) => n.id === noteId);

    this.notesService.delete(noteId).subscribe({
      next: () => {
        if (this.fileType() === 'epub')
          (this.epubReader as any)?.deleteHighlight(noteToDelete?.cfiRange);
        if (this.fileType() === 'pdf') (this.pdfReader as any)?.removeHighlight(noteId);

        this.dbNotes.update((notes) => notes.filter((n) => n.id !== noteId));
      },
    });
  }

  jumpToNote(note: Note) {
    if (this.editingNoteId() === note.id || !note.cfiRange) return;
    const reader = this.activeReader();
    if (!reader) return;
    reader.goTo(note.cfiRange);
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
