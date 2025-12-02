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
  Clock, // 1. Added Clock icon
} from 'lucide-angular';
import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { Note } from '../dtos/note.dtos';

// --- IMPORTS ---
import { PdfReader } from './pdf-reader/pdf-reader';
import { EpubReader } from './epub-reader/epub-reader';
// 👇 Import the REAL AudioReader from the separate file
import { AudioReader } from './audio-reader/audio-reader';

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  // 👇 Ensure AudioReader is included here
  imports: [CommonModule, FormsModule, LucideAngularModule, PdfReader, EpubReader, AudioReader],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.css',
})
export class ReaderShell implements OnInit {
  @ViewChild(EpubReader) epubReader?: EpubReader;
  @ViewChild(PdfReader) pdfReader?: PdfReader;
  @ViewChild(AudioReader) audioReader?: AudioReader; // 2. Access Audio Reader instance

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
  ClockIcon = Clock; // 3. Expose Clock icon

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

  // 4. Helper to append timestamp string to the text area
  addAudioTimestamp() {
    if (this.fileType() !== 'audio' || !this.audioReader) return;

    const time = this.audioReader.currentTime();
    const formatted = this.audioReader.formatTime(time);

    // Append [12:30] to the current note content with a space if needed
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

    // Capture location based on reader type
    if (this.fileType() === 'epub') {
      currentCfi = this.epubReader?.getCurrentLocationCfi() || undefined;
    } else if (this.fileType() === 'audio' && this.audioReader) {
      // 5. Save timestamp (raw seconds) as the "location" for audio notes
      currentCfi = this.audioReader.currentTime().toString();
    }
    // For PDF, quick notes are just book-level for now

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

    this.notesService.delete(noteId).subscribe({
      next: () => {
        this.dbNotes.update((notes) => notes.filter((n) => n.id !== noteId));
      },
    });
  }

  jumpToNote(note: Note) {
    if (this.editingNoteId() === note.id || !note.cfiRange) return;

    const type = this.fileType();

    if (type === 'pdf' && this.pdfReader) {
      this.pdfReader.goToLocation(note.cfiRange);
    } else if (type === 'epub' && this.epubReader) {
      this.epubReader.goToLocation(note.cfiRange);
    } else if (type === 'audio' && this.audioReader) {
      // 6. Handle Audio jumps
      const time = parseFloat(note.cfiRange);
      if (!isNaN(time)) {
        // NOTE: Requires you to have added `goToTime(seconds: number)` to AudioReader
        this.audioReader.goToTime(time);
      }
    }
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
