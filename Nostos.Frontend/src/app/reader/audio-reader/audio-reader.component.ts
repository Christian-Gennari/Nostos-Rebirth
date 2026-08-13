import {
  Component,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  inject,
  input,
  effect,
  signal,
  computed,
  OnDestroy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Howl } from 'howler';
import { Subject, Subscription } from 'rxjs';
import { sampleTime, filter } from 'rxjs/operators';
import { LucideAngularModule, Play, Pause, AudioLines, RotateCcw, RotateCw } from 'lucide-angular';
import { BooksService } from '../../core/services/books.service';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';
import { Book } from '../../core/dtos/book.dtos';

@Component({
  selector: 'app-audio-reader',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './audio-reader.component.html',
  styleUrl: './audio-reader.component.css',
})
export class AudioReader implements OnDestroy, IReader {
  bookId = input.required<string>();
  // The already-loaded book is passed in by the reader shell so this component
  // never issues a second GET /api/books/{id} (issue #7).
  book = input<Book | null>(null);

  private booksService = inject(BooksService);

  Icons = { Play, Pause, AudioLines, RotateCcw, RotateCw };

  // IReader Interface
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '0:00', percentage: 0 });
  currentLocationTarget = computed(() => {
    const time = this.currentTime();
    const toc = this.toc();
    let activeTarget: string | number | null = null;
    let maxStart = -1;
    for (const item of toc) {
      const start = typeof item.target === 'number' ? item.target : parseFloat(item.target);
      if (!isNaN(start) && start <= time && start > maxStart) {
        maxStart = start;
        activeTarget = item.target;
      }
    }
    return activeTarget;
  });

  // Player State
  player: Howl | null = null;
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  currentRate = signal(1);
  isOpen = signal(false);
  // True while Howl is initializing (between `new Howl` and the onload callback),
  // so the UI can show a visible loading state instead of a dead-looking player.
  loading = signal(true);
  loadError = signal<string | null>(null);

  // --- Jump-to-timestamp (issue #6) ---
  isEditingTime = signal(false);
  timeInputValue = signal('');

  @ViewChild('timeInput') set timeInputRef(el: ElementRef<HTMLInputElement> | undefined) {
    if (el) {
      el.nativeElement.focus();
      el.nativeElement.select();
    }
  }

  @ViewChild('timeButton') timeButtonRef?: ElementRef<HTMLButtonElement>;

  private injector = inject(Injector);

  private restoreFocusToTimeButton(): void {
    afterNextRender(() => {
      this.timeButtonRef?.nativeElement.focus();
    }, { injector: this.injector });
  }

  // Playback Speeds
  availableRates = [0.75, 0.9, 1, 1.1, 1.25, 1.5];

  private progressSubject = new Subject<{ timestamp: number; percent: number }>();
  private progressSubscription!: Subscription;
  private progressTimer: any;
  private isInitialized = false;
  private onVisibilityChange = this.handleVisibilityChange.bind(this);
  private onBeforeUnload = this.saveProgressImmediately.bind(this);
  private onPageHide = this.saveProgressImmediately.bind(this);

  constructor() {
    this.progressSubscription = this.progressSubject.pipe(
      sampleTime(2000),
      filter(() => this.isInitialized),
    ).subscribe((data) => {
      this.booksService
        .updateProgress(this.bookId(), data.timestamp.toString(), data.percent)
        .subscribe({
          error: (err) => console.error('Failed to save progress:', err),
        });
    });

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('pagehide', this.onPageHide);

    effect(() => {
      const id = this.bookId();
      if (id) {
        // Init Player
        this.initPlayer(id);
      }
    });

    // Build the table of contents from the book passed in by the reader shell.
    // No second GET /api/books/{id} (issue #7).
    effect(() => {
      const book = this.book();
      if (!book) return;

      if (book.chapters && book.chapters.length > 0) {
        this.toc.set(
          book.chapters.map((c) => ({
            label: c.title,
            target: c.startTime, // Target is the timestamp in seconds
            children: [],
          })),
        );
      }
    });
  }

  // --- IReader Methods ---
  next() {
    this.skip(15);
  }
  previous() {
    this.skip(-15);
  }
  zoomIn() {}
  zoomOut() {}

  goTo(target: string | number) {
    const time = typeof target === 'string' ? parseFloat(target) : target;
    if (!isNaN(time)) this.goToTime(time);
  }

  getCurrentLocation(): string {
    return this.currentTime().toString();
  }

  // --- Audio Logic ---
  initPlayer(id: string) {
    if (this.player) this.player.unload();

    this.loading.set(true);
    this.loadError.set(null);

    const src = `/api/books/${id}/file`;
    this.player = new Howl({
      src: [src],
      html5: true,
      format: ['mp3', 'm4a', 'm4b'],
      onload: () => {
        this.loading.set(false);
        this.duration.set(this.player?.duration() || 0);
        this.restoreProgress();
        this.updateMediaSessionMetadata();
      },
      onloaderror: () => {
        // Loading failed; drop the loading state so the UI can surface the error
        // instead of appearing stuck forever.
        this.loading.set(false);
        this.loadError.set('Unable to load audio.');
      },
      onplay: () => {
        this.isPlaying.set(true);
        this.startProgressTracking();
        this.updateMediaSessionPlaybackState('playing');
      },
      onpause: () => {
        this.isPlaying.set(false);
        this.stopProgressTracking();
        this.saveProgressImmediately();
        this.updateMediaSessionPlaybackState('paused');
      },
      onend: () => {
        this.isPlaying.set(false);
        this.stopProgressTracking();
        this.currentTime.set(this.duration());
        this.updateProgressState();
        this.updateMediaSessionPlaybackState('none');
      },
    });
  }

  restoreProgress() {
    // The book (with its lastLocation) is passed in by the reader shell —
    // no second GET /api/books/{id} (issue #7). If the book has not arrived
    // yet, do nothing; the shell only renders this component once it has.
    const book = this.book();
    if (book?.lastLocation) {
      const timestamp = parseFloat(book.lastLocation);
      if (!isNaN(timestamp)) this.goToTime(timestamp);
    }
    this.updateProgressState();
    this.isInitialized = true;
  }

  togglePlay() {
    this.player?.playing() ? this.player.pause() : this.player?.play();
  }

  seek(event: any) {
    const time = parseFloat(event.target.value);
    this.goToTime(time);
  }

  skip(seconds: number) {
    if (!this.player) return;
    const current = this.player.seek() as number;
    const newTime = Math.max(0, Math.min(current + seconds, this.duration()));
    this.goToTime(newTime);
  }

  goToTime(seconds: number) {
    if (this.player) {
      this.player.seek(seconds);
      this.currentTime.set(seconds);
      this.updateProgressState();
      this.updateMediaSessionPositionState();
    }
  }

  // Speed Logic
  toggleRate() {
    const current = this.currentRate();
    const currentIndex = this.availableRates.indexOf(current);

    // Calculate next index, wrapping around to the start
    const nextIndex = (currentIndex + 1) % this.availableRates.length;

    // Set the new rate
    this.setRate(this.availableRates[nextIndex]);
  }

  setRate(rate: number) {
    this.player?.rate(rate);
    this.currentRate.set(rate);
    this.updateMediaSessionPositionState();
  }

  // Dropdown
  toggleDropdown() {
    this.isOpen.update(v => !v);
  }

  closeDropdown() {
    this.isOpen.set(false);
  }

  selectRate(rate: number) {
    this.setRate(rate);
    this.closeDropdown();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.isOpen()) return;
    const target = event.target as HTMLElement;
    const selectorEl = target.closest('.rate-selector');
    if (!selectorEl) {
      this.closeDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  onKeydownEscape() {
    if (this.isOpen()) {
      this.closeDropdown();
    }
  }

  startProgressTracking() {
    this.stopProgressTracking();
    this.progressTimer = setInterval(() => {
      const seek = (this.player?.seek() as number) || 0;
      this.currentTime.set(seek);
      this.updateProgressState();
    }, 1000);
  }

  stopProgressTracking() {
    if (this.progressTimer) clearInterval(this.progressTimer);
  }

  private updateProgressState() {
    const now = this.currentTime();
    const total = this.duration();
    const percent = total > 0 ? Math.floor((now / total) * 100) : 0;
    const label = `${this.formatTime(now)} / ${this.formatTime(total)}`;
    this.progress.set({ label, percentage: percent });
    this.progressSubject.next({ timestamp: now, percent });
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // --- Jump-to-timestamp (issue #6) ---
  startEditingTime(): void {
    if (this.duration() <= 0) return;
    this.timeInputValue.set(this.formatTime(this.currentTime()));
    this.isEditingTime.set(true);
  }

  commitTimeEdit(value: string): void {
    if (!this.isEditingTime()) return;
    const seconds = parseTimeString(value);
    this.isEditingTime.set(false);
    if (seconds == null) {
      this.restoreFocusToTimeButton();
      return;
    }
    const clamped = Math.max(0, Math.min(seconds, this.duration()));
    this.goToTime(clamped);
    this.restoreFocusToTimeButton();
  }

  cancelTimeEdit(): void {
    if (!this.isEditingTime()) return;
    this.isEditingTime.set(false);
    this.restoreFocusToTimeButton();
  }

  removeHighlight(_identifier: string): void {
    // No-op: Audio reader does not support highlights
  }

  commitHighlight(): void {
    // No-op: Audio reader does not support highlights
  }

  discardHighlight(): void {
    // No-op: Audio reader does not support highlights
  }

  // --- Visibility Change: Save on hidden, resync on visible ---
  private handleVisibilityChange() {
    if (!this.player) return;

    if (document.visibilityState === 'hidden') {
      this.saveProgressImmediately();
      return;
    }

    const actualTime = this.player.seek() as number;
    const actuallyPlaying = this.player.playing();

    this.currentTime.set(actualTime);
    this.isPlaying.set(actuallyPlaying);
    this.updateProgressState();

    if (actuallyPlaying) {
      this.startProgressTracking();
    }

    this.updateMediaSessionPositionState();
  }

  private saveProgressImmediately() {
    if (!this.player || !this.isInitialized) return;
    const seek = this.player.seek() as number;
    if (seek > 0) {
      this.booksService.updateProgress(
        this.bookId(),
        seek.toString(),
        this.duration() > 0 ? Math.floor((seek / this.duration()) * 100) : 0,
      ).subscribe();
    }
  }

  // --- Media Session API: Sync with Android notification controls ---
  private updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator)) return;
    const book = this.book();
    if (!book) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: book.title,
      artist: book.author || book.narrator || undefined,
      album: book.series || undefined,
      artwork: book.coverUrl ? [{ src: book.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
    });

    // Register action handlers so notification controls sync back to our component
    navigator.mediaSession.setActionHandler('play', () => {
      this.player?.play();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      this.player?.pause();
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      this.skip(-(details.seekOffset || 15));
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      this.skip(details.seekOffset || 15);
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) {
        this.goToTime(details.seekTime!);
      }
    });
  }

  private updateMediaSessionPlaybackState(state: MediaSessionPlaybackState) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
    this.updateMediaSessionPositionState();
  }

  private updateMediaSessionPositionState() {
    if (!('mediaSession' in navigator) || !this.player) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration(),
        playbackRate: this.currentRate(),
        position: Math.min(this.currentTime(), this.duration()),
      });
    } catch {
      // setPositionState can throw if values are invalid (e.g., duration=0)
    }
  }

  ngOnDestroy() {
    this.saveProgressImmediately();
    this.stopProgressTracking();
    this.progressSubscription?.unsubscribe();
    this.progressSubject.complete();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('pagehide', this.onPageHide);

    // Clean up Media Session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      for (const action of [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'seekto',
      ] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    }

    this.player?.unload();
  }
}

/**
 * Parse a time string in `[H:]MM:SS` format into total seconds.
 * Accepts 1 or 2 digits per segment, trims surrounding whitespace.
 * Each segment is treated as a raw integer — out-of-range minute/second
 * values are NOT rejected here; the caller clamps the result to a
 * maximum (e.g. `duration()`). Returns null for any malformed input
 * (empty, negative, extra segments, non-digits).
 */
export function parseTimeString(input: string): number | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2})(?::(\d{1,2}))(?::(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const hasHours = match[3] != null;
  const hours = hasHours ? parseInt(match[1], 10) : 0;
  const minutes = hasHours ? parseInt(match[2], 10) : parseInt(match[1], 10);
  const seconds = hasHours ? parseInt(match[3], 10) : parseInt(match[2], 10);
  return hours * 3600 + minutes * 60 + seconds;
}
