import { Component, input, effect, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Howl } from 'howler';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { LucideAngularModule, Play, Pause, Rewind, FastForward, AudioLines } from 'lucide-angular';
import { BooksService } from '../../services/books.services';

@Component({
  selector: 'app-audio-reader',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './audio-reader.html',
  styleUrl: './audio-reader.css',
})
export class AudioReader implements OnDestroy {
  bookId = input.required<string>();

  // Services
  private booksService = inject(BooksService);

  // Icons
  PlayIcon = Play;
  PauseIcon = Pause;
  RewindIcon = Rewind;
  FastForwardIcon = FastForward;
  AudioIcon = AudioLines;

  // State
  player: Howl | null = null;
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  currentRate = signal(1);

  // Progress Syncing
  private progressSubject = new Subject<{ timestamp: number; percent: number }>();
  private progressTimer: any;

  constructor() {
    // Sync progress to backend (debounced)
    this.progressSubject.pipe(debounceTime(2000)).subscribe((data) => {
      this.booksService
        .updateProgress(this.bookId(), data.timestamp.toString(), data.percent)
        .subscribe();
    });

    effect(() => {
      const id = this.bookId();
      if (id) {
        this.initPlayer(id);
      }
    });
  }

  initPlayer(id: string) {
    if (this.player) {
      this.player.unload();
    }

    const src = `/api/books/${id}/file`;

    this.player = new Howl({
      src: [src],
      html5: true, // Crucial for streaming large files without full download
      format: ['mp3', 'm4a', 'm4b'],
      onload: () => {
        this.duration.set(this.player?.duration() || 0);
        this.restoreProgress(id);
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
      },
    });
  }

  restoreProgress(id: string) {
    this.booksService.get(id).subscribe((book) => {
      if (book.lastLocation) {
        const timestamp = parseFloat(book.lastLocation);
        if (!isNaN(timestamp)) {
          this.player?.seek(timestamp);
          this.currentTime.set(timestamp);
        }
      }
    });
  }

  togglePlay() {
    if (this.player?.playing()) {
      this.player.pause();
    } else {
      this.player?.play();
    }
  }

  seek(event: any) {
    const time = parseFloat(event.target.value);
    this.player?.seek(time);
    this.currentTime.set(time);
  }

  skip(seconds: number) {
    const newTime = (this.player?.seek() as number) + seconds;
    this.player?.seek(newTime);
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

      const percent = Math.floor((seek / this.duration()) * 100);
      this.progressSubject.next({ timestamp: seek, percent });
    }, 1000);
  }

  stopProgressTracking() {
    if (this.progressTimer) clearInterval(this.progressTimer);
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  ngOnDestroy() {
    this.stopProgressTracking();
    this.player?.unload();
  }

  goToTime(seconds: number) {
    if (this.player) {
      this.player.seek(seconds);
      this.currentTime.set(seconds);
    }
  }
}
