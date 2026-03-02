import { Component, input, effect, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Howl } from 'howler';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
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

  private booksService = inject(BooksService);

  Icons = { Play, Pause, AudioLines, RotateCcw, RotateCw };

  // Data
  book = signal<Book | null>(null);

  // IReader Interface
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '0:00', percentage: 0 });

  // Player State
  player: Howl | null = null;
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  currentRate = signal(1);

  // Playback Speeds
  availableRates = [0.75, 0.9, 1, 1.25, 1.5];

  private progressSubject = new Subject<{ timestamp: number; percent: number }>();
  private progressTimer: any;
  private onVisibilityChange = this.handleVisibilityChange.bind(this);

  constructor() {
    this.progressSubject.pipe(debounceTime(2000)).subscribe((data) => {
      this.booksService
        .updateProgress(this.bookId(), data.timestamp.toString(), data.percent)
        .subscribe();
    });

    // Sync state when tab becomes visible again (setInterval is throttled in background tabs)
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    effect(() => {
      const id = this.bookId();
      if (id) {
        // 1. Fetch Book Metadata (Cover, Title, etc.)
        this.booksService.get(id).subscribe((b) => {
          this.book.set(b);

          // Map chapters to table of contents
          if (b.chapters && b.chapters.length > 0) {
            this.toc.set(
              b.chapters.map((c) => ({
                label: c.title,
                target: c.startTime, // Target is the timestamp in seconds
                children: [],
              })),
            );
          }
        });

        // 2. Init Player
        this.initPlayer(id);
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

    const src = `/api/books/${id}/file`;
    this.player = new Howl({
      src: [src],
      html5: true,
      format: ['mp3', 'm4a', 'm4b'],
      onload: () => {
        this.duration.set(this.player?.duration() || 0);
        this.restoreProgress(id);
        this.updateProgressState();
        this.updateMediaSessionMetadata();
      },
      onplay: () => {
        this.isPlaying.set(true);
        this.startProgressTracking();
        this.updateMediaSessionPlaybackState('playing');
      },
      onpause: () => {
        this.isPlaying.set(false);
        this.stopProgressTracking();
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

  restoreProgress(id: string) {
    this.booksService.get(id).subscribe((book) => {
      if (book.lastLocation) {
        const timestamp = parseFloat(book.lastLocation);
        if (!isNaN(timestamp)) this.goToTime(timestamp);
      }
    });
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

  removeHighlight(_identifier: string): void {
    // No-op: Audio reader does not support highlights
  }

  // --- Visibility Change: Resync after background tab throttling ---
  private handleVisibilityChange() {
    if (document.visibilityState === 'visible' && this.player) {
      const actualTime = this.player.seek() as number;
      const actuallyPlaying = this.player.playing();

      // Sync current time from the actual audio element position
      this.currentTime.set(actualTime);
      this.isPlaying.set(actuallyPlaying);
      this.updateProgressState();

      // Restart the interval timer if still playing (it was likely killed/throttled)
      if (actuallyPlaying) {
        this.startProgressTracking();
      }

      // Keep Media Session position in sync
      this.updateMediaSessionPositionState();
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
    this.stopProgressTracking();
    this.progressSubject.complete();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

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
