import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ViewChild,
  EffectRef,
  effect,
} from '@angular/core';
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
} from 'lucide-angular';
import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { Note } from '../dtos/note.dtos';
import { IReader, TocItem } from './reader.interface';

// --- IMPORTS ---
import { PdfReader } from './pdf-reader/pdf-reader';
import { EpubReader } from './epub-reader/epub-reader';
import { AudioReader } from './audio-reader/audio-reader';

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, PdfReader, EpubReader, AudioReader],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.css',
})
export class ReaderShell implements OnInit {
  // Note: These will eventually implement IReader
  @ViewChild(EpubReader) epubReader?: IReader;
  @ViewChild(PdfReader) pdfReader?: IReader;
  @ViewChild(AudioReader) audioReader?: IReader;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);

  // Icons
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
  };

  book = signal<any>(null);
  loading = signal(true);
  notesOpen = signal(false);
  tocOpen = signal(false); // New State for TOC Drawer
  ready = signal(false);

  // Data
  dbNotes = signal<Note[]>([]);
  quickNoteContent = signal('');

  // Editing State
  editingNoteId = signal<string | null>(null);
  editContent = signal('');

  // --- UNIFIED READER LOGIC ---

  // Computed File Type
  fileType = computed<'pdf' | 'epub' | 'audio' | null>(() => {
    const fileName = this.book()?.fileName?.toLowerCase();
    if (!fileName) return null;
    if (fileName.endsWith('.pdf')) return 'pdf';
    if (fileName.endsWith('.epub')) return 'epub';
    if (fileName.endsWith('.m4b') || fileName.endsWith('.m4a') || fileName.endsWith('.mp3'))
      return 'audio';
    return null;
  });

  // 1. Determine Active Reader Implementation
  activeReader = computed<IReader | null>(() => {
    // We rely on the ViewChild being available after view init
    // The specific components (EpubReader etc) must implement IReader
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

  // 2. Expose Unified State
  toc = computed(() => this.activeReader()?.toc() ?? []);
  progressLabel = computed(() => this.activeReader()?.progress()?.label ?? '');

  // 3. Expose Unified Actions
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
    this.tocOpen.set(false); // Close drawer on selection
  }

  // --- INITIALIZATION ---

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.booksService.get(id).subscribe({
        next: (b) => {
          this.book.set(b);
          this.loading.set(false);
          this.loadNotes(b.id);
          // Small delay to ensure ViewChildren are attached
          setTimeout(() => this.ready.set(true), 0);
        },
        error: () => this.loading.set(false),
      });
    }
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

  // --- NOTES LOGIC (Refactored) ---

  addAudioTimestamp() {
    if (this.fileType() !== 'audio' || !this.activeReader()) return;

    // We cast to any or specific type if we need specific methods not in interface,
    // but better to add 'getCurrentTimeLabel' to interface if needed universally.
    // For now, let's assume we can get it from the label or specific reader.
    const reader = this.audioReader as any;
    if (reader && reader.formatTime) {
      const time = reader.currentTime();
      const formatted = reader.formatTime(time);
      this.quickNoteContent.update((current) => {
        const prefix = current.length > 0 ? ' ' : '';
        return current + prefix + `[${formatted}] `;
      });
    }
  }

  saveQuickNote() {
    const content = this.quickNoteContent().trim();
    if (!content) return;
    const bookId = this.book()?.id;
    if (!bookId) return;

    // Unified Location Retrieval
    const currentCfi = this.activeReader()?.getCurrentLocation() || undefined;

    this.notesService.create(bookId, { content, cfiRange: currentCfi }).subscribe({
      next: () => {
        this.quickNoteContent.set('');
        this.loadNotes(bookId);
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
        // Specific cleanup can be moved to IReader.removeHighlight(id) eventually
        // For now, we still check types for specific cleanup methods
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

    // We can keep the prompt logic here or move it to a helper
    // Simplified prompt for brevity in this refactor
    const message = `Jump to location?`;
    if (confirm(message)) {
      reader.goTo(note.cfiRange);
    }
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
