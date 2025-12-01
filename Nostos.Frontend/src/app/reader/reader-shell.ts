// Nostos.Frontend/src/app/reader/reader-shell.ts
import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BooksService, Book } from '../services/books.services';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ArrowLeft, NotebookPen } from 'lucide-angular';

// Import the real components
import { PdfReader } from './pdf-reader/pdf-reader'; // Check path (might be ../pdf-reader/...)
import { EpubReader } from './epub-reader/epub-reader'; // <--- REAL COMPONENT

// Keep ONLY the Audio placeholder for now
@Component({
  selector: 'app-audio-reader',
  template: `<div class="p-8 text-center text-gray-500">Audio Player Loading...</div>`,
  standalone: true,
})
export class AudioReader {}

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    PdfReader,
    EpubReader, // <--- Using the real imported class
    AudioReader, // <--- Using the placeholder class below
  ],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.css',
})
export class ReaderShell implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);

  ArrowLeftIcon = ArrowLeft;
  NotesIcon = NotebookPen;

  book = signal<Book | null>(null);
  loading = signal(true);

  // --- New signals for Notes panel ---
  notesOpen = signal(false);
  notes = signal<string>('');
  ready = signal(false);

  fileType = computed(() => {
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

          const saved = localStorage.getItem('notes-' + b.id);
          if (saved) this.notes.set(saved);

          this.loading.set(false);

          // activate transitions AFTER initialization
          setTimeout(() => this.ready.set(true), 0);
        },
        error: () => this.loading.set(false),
      });
    }
  }

  toggleNotes() {
    this.notesOpen.update((v) => !v);
  }

  saveNotes() {
    const id = this.book()?.id;
    if (id) localStorage.setItem('notes-' + id, this.notes());
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
