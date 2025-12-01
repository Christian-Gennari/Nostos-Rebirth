// Nostos.Frontend/src/app/reader/reader-shell.ts
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
} from 'lucide-angular';
import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { Note } from '../dtos/note.dtos';
import { PdfReader } from './pdf-reader/pdf-reader';
import { EpubReader } from './epub-reader/epub-reader';

@Component({
  selector: 'app-audio-reader',
  template: `<div class="p-8 text-center text-gray-500">Audio Player Loading...</div>`,
  standalone: true,
})
export class AudioReader {}

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, PdfReader, EpubReader, AudioReader],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.css',
})
export class ReaderShell implements OnInit {
  @ViewChild(EpubReader) epubReader?: EpubReader;

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

  // --- NEW: Handle Event from EpubReader ---
  handleNoteCreated() {
    const id = this.book()?.id;
    if (id) {
      this.loadNotes(id);
      // Automatically open the sidebar if it's closed
      if (!this.notesOpen()) {
        this.notesOpen.set(true);
      }
    }
  }

  toggleNotes() {
    this.notesOpen.update((v) => !v);
  }

  saveQuickNote() {
    const content = this.quickNoteContent().trim();
    if (!content) return;
    const bookId = this.book()?.id;
    if (!bookId) return;

    const currentCfi = this.epubReader?.getCurrentLocationCfi() || null;

    this.notesService
      .create(bookId, {
        content: content,
        cfiRange: currentCfi || undefined,
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
    event?.stopPropagation(); // Prevent jumpToNote logic
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
        // Update local list to reflect changes immediately
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
    // Only jump if we are NOT editing
    if (this.editingNoteId() !== note.id && note.cfiRange && this.epubReader) {
      this.epubReader.goToLocation(note.cfiRange);
    }
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
