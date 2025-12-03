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
  Info, // <--- Imported Info Icon
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
    Save,
    Plus,
    Info, // <--- Added Info to Icons object
  };

  book = signal<any>(null);
  loading = signal(true);
  notesOpen = signal(false);
  tocOpen = signal(false);

  // Controls when the view is stable enough to access ViewChildren
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
    // CRITICAL FIX: Depend on 'ready' signal.
    // This ensures the computation re-runs after the view is initialized and ViewChildren are available.
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

  // 2. Expose Unified State
  toc = computed(() => this.activeReader()?.toc() ?? []);

  // [Updated] Expose Label and Tooltip
  progressState = computed(() => this.activeReader()?.progress());
  progressLabel = computed(() => this.progressState()?.label ?? '');
  progressTooltip = computed(() => this.progressState()?.tooltip ?? '');

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
    this.tocOpen.set(false);
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

          // Allow time for *ngSwitch to render the child component
          setTimeout(() => this.ready.set(true), 100);
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

  // --- NOTES LOGIC ---

  addAudioTimestamp() {
    // Only relevant for audio, injects current timestamp into the quick note input
    if (this.fileType() !== 'audio' || !this.activeReader()) return;

    // Attempt to get formatted time from ReaderProgress or cast to specific reader
    // A simpler approach for now using the progress label if available:
    const label = this.activeReader()?.progress().label;
    if (label) {
      // label is "05:20 / 14:00", we just want "05:20"
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

    // Direct navigation without prompt for smoother UX, or keep prompt if preferred
    reader.goTo(note.cfiRange);
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
