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
} from 'lucide-angular';
import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { Note } from '../dtos/note.dtos';

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
  @ViewChild(EpubReader) epubReader?: EpubReader;
  @ViewChild(PdfReader) pdfReader?: PdfReader;
  @ViewChild(AudioReader) audioReader?: AudioReader;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);

  // Icons
  ArrowLeftIcon = ArrowLeft;
  NotesIcon = NotebookPen;
  QuoteIcon = MessageSquareQuote;
  NoteIcon = StickyNote;
  EditIcon = Edit2;
  DeleteIcon = Trash2;
  CloseIcon = X;
  CheckIcon = Check;
  ClockIcon = Clock;

  book = signal<any>(null);
  loading = signal(true);
  notesOpen = signal(false);
  ready = signal(false);

  // Data
  dbNotes = signal<Note[]>([]);
  quickNoteContent = signal('');

  // Editing State
  editingNoteId = signal<string | null>(null);
  editContent = signal('');

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

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.booksService.get(id).subscribe({
        next: (b) => {
          this.book.set(b);
          this.loading.set(false);
          this.loadNotes(b.id);
          setTimeout(() => this.ready.set(true), 0);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  loadNotes(bookId: string) {
    this.notesService.list(bookId).subscribe((notes) => {
      // Show newest first
      this.dbNotes.set(notes.reverse());
    });
  }

  handleNoteCreated() {
    const id = this.book()?.id;
    if (id) {
      this.loadNotes(id);
      if (!this.notesOpen()) {
        this.notesOpen.set(true);
      }
    }
  }

  toggleNotes() {
    this.notesOpen.update((v) => !v);
  }

  addAudioTimestamp() {
    if (this.fileType() !== 'audio' || !this.audioReader) return;

    const time = this.audioReader.currentTime();
    const formatted = this.audioReader.formatTime(time);

    this.quickNoteContent.update((current) => {
      const prefix = current.length > 0 ? ' ' : '';
      return current + prefix + `[${formatted}] `;
    });
  }

  saveQuickNote() {
    const content = this.quickNoteContent().trim();
    if (!content) return;
    const bookId = this.book()?.id;
    if (!bookId) return;

    let currentCfi: string | undefined = undefined;

    // 👇 UPDATED: Handle logic for all reader types including PDF
    if (this.fileType() === 'epub') {
      currentCfi = this.epubReader?.getCurrentLocationCfi() || undefined;
    } else if (this.fileType() === 'audio' && this.audioReader) {
      currentCfi = this.audioReader.currentTime().toString();
    } else if (this.fileType() === 'pdf' && this.pdfReader) {
      // Now calls the new method in PdfReader
      currentCfi = this.pdfReader.getCurrentLocation();
    }

    this.notesService
      .create(bookId, {
        content: content,
        cfiRange: currentCfi,
      })
      .subscribe({
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
        // EPUB Logic
        if (this.fileType() === 'epub' && this.epubReader && noteToDelete?.cfiRange) {
          this.epubReader.deleteHighlight(noteToDelete.cfiRange);
        }

        // 👇 NEW: PDF Logic - Remove the highlight visually
        if (this.fileType() === 'pdf' && this.pdfReader) {
          this.pdfReader.removeHighlight(noteId);
        }

        this.dbNotes.update((notes) => notes.filter((n) => n.id !== noteId));
      },
    });
  }

  jumpToNote(note: Note) {
    if (this.editingNoteId() === note.id || !note.cfiRange || note.cfiRange.trim().length === 0) {
      return;
    }
    const type = this.fileType();

    // PDF Logic
    if (type === 'pdf' && this.pdfReader) {
      const hasQuoted =
        typeof note.selectedText === 'string' && note.selectedText.trim().length > 0;

      const preview =
        note.selectedText && note.selectedText.length > 30
          ? note.selectedText.slice(0, 30) + '…'
          : note.selectedText;

      const message = hasQuoted
        ? `Jump to the location of quoted text "${preview}"?`
        : 'Jump to the location this note was created?';

      if (confirm(message)) {
        this.pdfReader.goToLocation(note.cfiRange);
      }
      return;
    }

    // 👇 UPDATED EPUB Logic (Now matches PDF)
    if (type === 'epub' && this.epubReader) {
      const hasQuoted =
        typeof note.selectedText === 'string' && note.selectedText.trim().length > 0;

      const preview =
        note.selectedText && note.selectedText.length > 30
          ? note.selectedText.slice(0, 30) + '…'
          : note.selectedText;

      const message = hasQuoted
        ? `Jump to the location of quoted text "${preview}"?`
        : 'Jump to the location this note was created?';

      if (confirm(message)) {
        this.epubReader.goToLocation(note.cfiRange);
      }
      return;
    }

    // Audio Logic
    if (type === 'audio' && this.audioReader) {
      const timestampMatch = note.content?.match(/\[(\d[\d:]*)\]/);
      const extracted = timestampMatch ? timestampMatch[1] : null;

      const hasTimestamp = extracted !== null;

      const time = parseFloat(note.cfiRange);
      if (!isNaN(time)) {
        const formatted = this.audioReader.formatTime(time);

        const message = hasTimestamp ? `Jump to timestamp ${formatted}?` : 'Jump to this location?';

        if (confirm(message)) {
          this.audioReader.goToTime(time);
        }
      }
      return;
    }
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
