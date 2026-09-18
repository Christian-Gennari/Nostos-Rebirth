import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, BookOpen, CheckCircle, CircleDashed, Heart, Library, Star } from 'lucide-angular';

import { BooksService } from '../core/services/books.service';
import { BookFilter, BookSort } from '../core/dtos/book.enums';
import { Book, LibraryStatusCountsDto } from '../core/dtos/book.dtos';

/**
 * Reading stats: a quiet overview of where the library stands.
 *
 * Deliberately derived from existing endpoints (status counts + filtered
 * lists) — no backend change. Time-based metrics (hours read, streaks) stay
 * out until reading sessions are tracked server-side; inventing them from
 * progress snapshots would be fiction, not stats.
 */
@Component({
  selector: 'app-reading-stats',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './reading-stats.component.html',
  styleUrl: './reading-stats.component.css',
})
export class ReadingStats implements OnInit {
  private booksService = inject(BooksService);

  BookOpenIcon = BookOpen;
  CheckIcon = CheckCircle;
  NotStartedIcon = CircleDashed;
  HeartIcon = Heart;
  LibraryIcon = Library;
  StarIcon = Star;

  counts = signal<LibraryStatusCountsDto | null>(null);
  currentlyReading = signal<Book[]>([]);
  topRated = signal<Book[]>([]);
  loading = signal(true);

  finishedShare = computed(() => {
    const c = this.counts();
    if (!c || c.all === 0) return 0;
    return Math.round((c.finished / c.all) * 100);
  });

  ngOnInit(): void {
    this.booksService.getStatusCounts().subscribe({
      next: (c) => this.counts.set(c),
      error: () => this.counts.set(null),
    });
    this.booksService
      .list({ filter: BookFilter.Reading, sort: BookSort.LastRead, page: 1, pageSize: 5 })
      .subscribe({
        next: (res) => this.currentlyReading.set(res.items ?? []),
        error: () => this.currentlyReading.set([]),
      });
    this.booksService
      .list({ sort: BookSort.Rating, page: 1, pageSize: 5 })
      .subscribe({
        next: (res) => {
          this.topRated.set((res.items ?? []).filter((b) => (b.rating ?? 0) > 0));
          this.loading.set(false);
        },
        error: () => {
          this.topRated.set([]);
          this.loading.set(false);
        },
      });
  }
}
