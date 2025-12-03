import { Component, input, effect, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Howl } from 'howler';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { LucideAngularModule, Play, Pause, AudioLines } from 'lucide-angular';
import { BooksService } from '../../services/books.services';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';
import { Book } from '../../dtos/book.dtos';

@Component({
  selector: 'app-audio-reader',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './audio-reader.html',
  styleUrl: './audio-reader.css',
})
export class AudioReader implements OnDestroy, IReader {
  bookId = input.required<string>();

  private booksService = inject(BooksService);

  Icons = { Play, Pause, AudioLines };

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
  availableRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  private progressSubject = new Subject<{ timestamp: number; percent: number }>();
  private progressTimer: any;

  constructor() {
    this.progressSubject.pipe(debounceTime(2000)).subscribe((data) => {
      this.booksService
        .updateProgress(this.bookId(), data.timestamp.toString(), data.percent)
        .subscribe();
    });

    effect(() => {
      const id = this.bookId();
      if (id) {
        // 1. Fetch Book Metadata (Cover, Title, etc.)
        this.booksService.get(id).subscribe((b) => this.book.set(b));

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
      },
      onplay: () => {
        this.isPlaying.set(true);
        this.startProgressTracking();
      },
      onpause: () => {
        this.isPlaying.set(false);
        this.stopProgressTracking();
      },
      onend: () => {
        this.isPlaying.set(false);
        this.stopProgressTracking();
        this.currentTime.set(this.duration());
        this.updateProgressState();
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

  ngOnDestroy() {
    this.stopProgressTracking();
    this.player?.unload();
  }
}
