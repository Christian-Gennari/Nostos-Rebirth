import { Component, inject, OnInit, signal, computed, ViewChild, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  ArrowLeft,
  NotebookPen,
  Highlighter,
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
  Search,
  Type as TypeIcon,
} from 'lucide-angular';

// Services
import { BooksService } from '../core/services/books.service';
import { NotesService } from '../core/services/notes.service';
import { ConceptsService, ConceptDto } from '../core/services/concepts.service';
import { ConceptAutocompleteService } from '../ui/concept-autocomplete-panel/concept-autocomplete.service';

// DTOs & Interfaces
import { Note } from '../core/dtos/note.dtos';
import { IReader, TocItem } from './reader.interface';
import { isTypingTarget, pageActionForKey } from './reader-keyboard';

// Components
import { IconButtonComponent } from '../ui/icon-button/icon-button.component';
import { PdfReader } from './pdf-reader/pdf-reader.component';
import { EpubReader } from './epub-reader/epub-reader.component';
import { AudioReader } from './audio-reader/audio-reader.component';
import { ConceptInputComponent } from '../ui/concept-input.component/concept-input.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    PdfReader,
    EpubReader,
    AudioReader,
    ConceptInputComponent,
    NoteCardComponent,
    IconButtonComponent,
    ConfirmModal,
  ],
  templateUrl: './reader-shell.component.html',
  styleUrl: './reader-shell.component.css',
})
export class ReaderShell implements OnInit {
  // Template-ref query (not type query): the epub child is stubbed in specs,
  // and a type query would resolve to null against the stub.
  @ViewChild('epubReader') epubReader?: EpubReader;
  @ViewChild(PdfReader) pdfReader?: IReader;
  @ViewChild(AudioReader) audioReader?: IReader;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);
  private conceptsService = inject(ConceptsService);
  private autocompleteService = inject(ConceptAutocompleteService);

  // Icons
  Icons = {
    ArrowLeft,
    Highlighter,
    NotebookPen,
    StickyNote,
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
  Search,
  Type: TypeIcon,
  };

  /** Typography panel (EPUB only) toggled by the Aa control. */
  typoOpen = signal(false);

  toggleTypo(): void {
    this.typoOpen.update((v) => !v);
  }

  /**
   * Opens the reader's own search UI. Only rendered for formats that have one
   * (PDF today), and the capability is optional on IReader, so this cannot hand
   * a reader a control it does not implement. Ctrl/Cmd+F reaches the same place;
   * this exists so search is reachable by touch at all (issue #226 §2).
   */
  openSearch(): void {
    this.pdfReader?.openSearch?.();
  }

  book = signal<any>(null);
  loading = signal(true);
  notesOpen = signal(false);
  tocOpen = signal(false);
  ready = signal(false);
  highlightMode = signal(false);
  pendingSelectionText = signal<string | null>(null);
  highlightSaving = signal(false);

  dbNotes = signal<Note[]>([]);
  quickNoteContent = signal('');

  /** Note id awaiting delete confirmation (asked through ConfirmModal). */
  pendingNoteDelete = signal<string | null>(null);

  // Concept map for the note cards
  conceptMap = signal<Map<string, ConceptDto>>(new Map());

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

  isActive(item: TocItem): boolean {
    const activeTarget = this.activeReader()?.currentLocationTarget?.();
    return activeTarget != null && item.target === activeTarget;
  }

  // --- INITIALIZATION ---

  ngOnInit() {
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

  loadConcepts() {
    this.conceptsService.list().subscribe({
      next: (concepts) => {
        // Populate service for autocomplete
        this.autocompleteService.setConcepts(concepts);

        // Populate map for NoteCard display
        const map = new Map<string, ConceptDto>();
        concepts.forEach((c) => map.set(c.name.trim().toLowerCase(), c));
        this.conceptMap.set(map);
      },
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
    // The bar closes only on confirmed persistence.
    this.pendingSelectionText.set(null);
    this.highlightSaving.set(false);
  }

  toggleNotes() {
    this.notesOpen.update((v) => !v);
    if (this.notesOpen()) this.tocOpen.set(false);
  }

  toggleHighlightMode() {
    const newMode = !this.highlightMode();
    if (!newMode && this.pendingSelectionText()) {
      this.activeReader()?.discardHighlight();
      this.pendingSelectionText.set(null);
    }
    this.highlightMode.set(newMode);
  }

  commitHighlight() {
    if (this.highlightSaving()) return;
    this.highlightSaving.set(true);
    this.activeReader()?.commitHighlight();
  }

  handleCommitFailed() {
    // Keep the bar open with the pending capture; the failed save must not
    // lose a difficult mobile selection.
    this.highlightSaving.set(false);
  }

  discardHighlight() {
    this.activeReader()?.discardHighlight();
    this.pendingSelectionText.set(null);
    this.highlightSaving.set(false);
  }

  handleSelectionCaptured(text: string) {
    this.pendingSelectionText.set(text);
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
        this.loadConcepts();
      },
    });
  }

  // --- HANDLERS FOR NOTE CARD ---

  onUpdateNote(event: { id: string; content: string; selectedText?: string }) {
    this.notesService
      .update(event.id, {
        content: event.content,
        selectedText: event.selectedText,
      })
      .subscribe({
        next: (updated) => {
          // Update local state so we see the change immediately without reload
          this.dbNotes.update((notes) => notes.map((n) => (n.id === updated.id ? updated : n)));
        },
      });
  }
  onDeleteNote(noteId: string) {
    this.pendingNoteDelete.set(noteId);
  }

  cancelNoteDelete() {
    this.pendingNoteDelete.set(null);
  }

  confirmNoteDelete() {
    const noteId = this.pendingNoteDelete();
    if (!noteId) return;
    this.pendingNoteDelete.set(null);

    const noteToDelete = this.dbNotes().find((n) => n.id === noteId);

    this.notesService.delete(noteId).subscribe({
      next: () => {
        if (this.fileType() === 'epub' && noteToDelete?.cfiRange)
          this.activeReader()?.removeHighlight(noteToDelete.cfiRange);
        if (this.fileType() === 'pdf') this.activeReader()?.removeHighlight(noteId);

        this.dbNotes.update((notes) => notes.filter((n) => n.id !== noteId));
      },
    });
  }

  onJumpToNote(note: Note) {
    if (note.cfiRange && this.activeReader()) {
      this.activeReader()?.goTo(note.cfiRange);
    }
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }

  onPageInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const page = parseInt(input.value, 10);

    // check if it's a valid number and we have a reader
    if (!isNaN(page) && this.activeReader()) {
      this.activeReader()?.goTo(page);
      input.blur(); // Optional: remove focus after jumping
    }
  }

  /**
   * Page keys for the whole reader. The iframe keeps focus inside the book, so
   * the EPUB reader also listens inside its contents document and calls its own
   * next()/previous() — this handler is the path for everything else (toolbar
   * focused, PDF canvas focused, click-anywhere-then-key). Modifier chords and
   * text-entry targets are left alone.
   */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    if (event.key === 'Escape') {
      // Overlays close in the order they stack: the typography panel rides on
      // top of the drawers, so it goes first. Typing targets are already out.
      if (this.typoOpen()) {
        this.typoOpen.set(false);
        event.preventDefault();
        return;
      }
      if (this.tocOpen()) {
        this.tocOpen.set(false);
        event.preventDefault();
        return;
      }
      if (this.notesOpen()) {
        this.notesOpen.set(false);
        event.preventDefault();
        return;
      }
      return;
    }

    const action = pageActionForKey(event);
    if (!action) return;

    if (action === 'next') this.nextPage();
    else this.prevPage();
    event.preventDefault();
  }
}
