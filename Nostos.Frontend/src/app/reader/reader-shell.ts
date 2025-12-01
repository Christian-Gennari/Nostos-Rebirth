import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BooksService, Book } from '../services/books.services';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';

// --- Placeholders (Move these to their own files later) ---
@Component({
  selector: 'app-pdf-reader',
  template: `<div style="padding: 2rem; text-align: center; color: #888;">
    PDF Reader Loading...
  </div>`,
  standalone: true,
})
export class PdfReader {}

@Component({
  selector: 'app-epub-reader',
  template: `<div style="padding: 2rem; text-align: center; color: #888;">
    EPUB Reader Loading...
  </div>`,
  standalone: true,
})
export class EpubReader {}

@Component({
  selector: 'app-audio-reader',
  template: `<div style="padding: 2rem; text-align: center; color: #888;">
    Audio Player Loading...
  </div>`,
  standalone: true,
})
export class AudioReader {}
// ---------------------------------------------------------

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule,
    // Import the specific readers here
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

  book = signal<Book | null>(null);
  loading = signal(true);

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
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  goBack() {
    const id = this.book()?.id;
    if (id) this.router.navigate(['/library', id]);
    else this.router.navigate(['/library']);
  }
}
