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
} from 'lucide-angular';

import { BooksService } from '../services/books.services';
import { NotesService } from '../services/notes.services'; // <--- NEW
import { Note } from '../dtos/note.dtos'; // <--- NEW

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
  // Access the child component to get location data
  @ViewChild(EpubReader) epubReader?: EpubReader;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);

  // Icons
  ArrowLeftIcon = ArrowLeft;
  NotesIcon = NotebookPen;
  QuoteIcon = MessageSquareQuote; // For highlights
  NoteIcon = StickyNote; // For quick notes

  book = signal<any>(null);
  loading = signal(true);

  // Notes State
  notesOpen = signal(false);
  ready = signal(false);

  // Real Data
  dbNotes = signal<Note[]>([]);
  quickNoteContent = signal('');

  // Add <'pdf' | 'epub' | 'audio' | null> to the computed function
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
          this.loadNotes(b.id); // Fetch notes from DB
          setTimeout(() => this.ready.set(true), 0);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  loadNotes(bookId: string) {
    this.notesService.list(bookId).subscribe((notes) => {
      // Sort by creation time (or CFI if you want to be fancy later)
      this.dbNotes.set(notes.reverse());
    });
  }

  toggleNotes() {
    this.notesOpen.update((v) => !v);
  }

  // --- ACTIONS ---

  saveQuickNote() {
    const content = this.quickNoteContent().trim();
    if (!content) return;

    const bookId = this.book()?.id;
    if (!bookId) return;

    // 1. Get current location from the Reader Component
    // We assume EpubReader has a method getCurrentLocation()
    const currentCfi = this.epubReader?.getCurrentLocationCfi() || null;

    this.notesService
      .create(bookId, {
        content: content,
        cfiRange: currentCfi || undefined,
        selectedText: undefined, // It's a quick note, no text selected
      })
      .subscribe({
        next: (newNote) => {
          this.quickNoteContent.set('');
          this.dbNotes.update((list) => [newNote, ...list]);
        },
      });
  }

  jumpToNote(note: Note) {
    if (note.cfiRange && this.epubReader) {
      this.epubReader.goToLocation(note.cfiRange);
    }
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]); // Go to detail view
    else this.router.navigate(['/library']);
  }
}
