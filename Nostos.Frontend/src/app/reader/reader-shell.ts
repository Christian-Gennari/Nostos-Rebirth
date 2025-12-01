import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BooksService, Book } from '../services/books.services';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ArrowLeft, NotebookPen } from 'lucide-angular';

// Import the real component
import { PdfReader } from '../reader/pdf-reader/pdf-reader';

// Keep these placeholders for now until Phase 3/4
@Component({
  selector: 'app-epub-reader',
  template: `<div class="p-8 text-center text-gray-500">EPUB Reader Loading...</div>`,
  standalone: true,
})
export class EpubReader {}

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
    FormsModule, // <--- added for textarea binding
    LucideAngularModule,
    PdfReader,
    EpubReader,
    AudioReader,
  ],
  templateUrl: './reader-shell.html',
  styleUrl: './reader-shell.css',
})
export class ReaderShell implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private booksService = inject(BooksService);

  ArrowLeftIcon = ArrowLeft;
  NotesIcon = NotebookPen; // <--- new icon

  book = signal<Book | null>(null);
  loading = signal(true);

  // --- New signals for Notes panel ---
  notesOpen = signal(false);
  notes = signal<string>('');

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
    if (!id) return;

    this.booksService.get(id).subscribe({
      next: (b) => {
        this.book.set(b);

        // Load saved notes for this book (localStorage for now)
        const saved = localStorage.getItem('notes-' + b.id);
        if (saved) this.notes.set(saved);

        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
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
