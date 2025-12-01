// Nostos.Frontend/src/app/reader/epub-reader/epub-reader.ts
import {
  Component,
  input,
  OnInit,
  OnDestroy,
  signal,
  effect,
  inject,
  Injector,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import ePub, { Book, Rendition } from 'epubjs';
import { EpubAnnotationManager } from './epub-annotation-manager';
import { NotesService } from '../../services/notes.services'; // Import NotesService

@Component({
  selector: 'app-epub-reader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-reader.html',
  styleUrl: './epub-reader.css',
})
export class EpubReader implements OnInit, OnDestroy {
  bookId = input.required<string>();

  private http = inject(HttpClient);
  private notesService = inject(NotesService); // Inject Service
  private injector = inject(Injector); // Inject Injector for the helper class

  private book: Book | null = null;
  private rendition: Rendition | null = null;

  // Instance of our new helper class
  private annotationManager: EpubAnnotationManager | null = null;

  loading = signal(true);

  constructor() {
    effect(() => {
      if (this.bookId()) {
        this.loadBook(this.bookId());
      }
    });
  }

  ngOnInit(): void {}

  loadBook(id: string) {
    if (this.book) {
      this.book.destroy();
      this.book = null;
      this.rendition = null;
      this.annotationManager = null;
    }

    this.loading.set(true);
    const url = `/api/books/${id}/file`;

    this.http.get(url, { responseType: 'arraybuffer' }).subscribe({
      next: (arrayBuffer) => {
        this.book = ePub(arrayBuffer);

        this.rendition = this.book.renderTo('epub-viewer', {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          manager: 'default',
        });

        // Initialize the Annotation Manager with dependencies
        // We pass the ID and Injector so the manager can save notes
        this.annotationManager = new EpubAnnotationManager(this.rendition, id, this.injector);

        this.rendition.hooks.content.register((contents: any) => {
          // 1. Inject Fonts
          const fontUrl =
            'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Lora:wght@400;500;600&display=swap';
          const link = contents.document.createElement('link');
          link.setAttribute('rel', 'stylesheet');
          link.setAttribute('href', fontUrl);
          contents.document.head.appendChild(link);

          // 2. Inject Highlight Styles (via Manager)
          this.annotationManager?.injectHighlightStyles(contents);
        });

        this.rendition.display().then(() => {
          this.loading.set(false);
          this.applyTheme();

          // 3. Start Listening for Selections (Mobile & PC)
          this.annotationManager?.init();

          // 4. Restore existing highlights from the backend
          this.notesService.list(id).subscribe({
            next: (notes) => {
              this.annotationManager?.restoreHighlights(notes);
            },
            error: (err) => console.error('Failed to load existing notes:', err),
          });
        });

        this.rendition.on('relocated', (location: any) => {
          console.log('Location:', location);
        });
      },
      error: (err) => {
        console.error('Failed to load EPUB file:', err);
        this.loading.set(false);
      },
    });
  }

  prevPage() {
    this.rendition?.prev();
  }

  nextPage() {
    this.rendition?.next();
  }

  private applyTheme() {
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--bg-body').trim();
    const text = style.getPropertyValue('--color-text-main').trim();

    this.rendition?.themes.register('default', {
      body: {
        'font-family': "'Lora', serif",
        color: text,
        background: bg,
        'line-height': '1.6',
        'font-size': '1.1rem',
      },
      p: {
        'font-family': "'Lora', serif",
        'line-height': '1.6',
        'margin-bottom': '1em',
      },
      'h1, h2, h3, h4': {
        'font-family': "'Lora', serif",
        color: text,
        'font-weight': '600',
      },
    });

    this.rendition?.themes.select('default');
  }

  ngOnDestroy(): void {
    if (this.book) {
      this.book.destroy();
    }
  }
}
