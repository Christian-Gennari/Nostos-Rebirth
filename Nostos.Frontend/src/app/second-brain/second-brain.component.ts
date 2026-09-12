import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Search, BrainCircuit, ArrowLeft, ArrowRight } from 'lucide-angular';

import { ToastService } from '../core/services/toast.service';
import {
  ConceptsService,
  ConceptDto,
  ConceptDetailDto,
  NoteContextDto,
} from '../core/services/concepts.service';

import { NoteFormatPipe } from '../ui/pipes/note-format.pipe';

type IndexSort = 'usage' | 'az' | 'za';

const INDEX_SORT_STORAGE_KEY = 'nostos.brain.indexSort';

const INDEX_SORTS: readonly IndexSort[] = ['usage', 'az', 'za'];

@Component({
  standalone: true,
  selector: 'app-brain',
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, NoteFormatPipe],
  templateUrl: './second-brain.component.html',
  styleUrls: ['./second-brain.component.css'],
})
export class SecondBrain {
  private conceptsService = inject(ConceptsService);
  private toast = inject(ToastService);

  // Icons
  SearchIcon = Search;
  BrainIcon = BrainCircuit;
  ArrowRightIcon = ArrowRight;
  ArrowLeftIcon = ArrowLeft;

  // State
  concepts = signal<ConceptDto[]>([]);
  searchQuery = signal('');
  indexSort = signal<IndexSort>(this.readStoredSort());

  selectedId = signal<string | null>(null);
  selectedDetail = signal<ConceptDetailDto | null>(null);
  loadingDetail = signal(false);

  /**
   * Details already fetched, keyed by concept id.
   *
   * The wait-field that used to cover this pane is gone: the pane's background
   * is identical for every concept, so a full-cover loading surface only ever
   * read as a flash between two states that look the same. Instead the pane
   * keeps whatever it is already showing and swaps the content in place — which
   * means a concept we have seen before must not be re-fetched (that round trip
   * is the only thing that could still make the pane blink). Hover/focus
   * pre-warms this cache so even a first visit is usually instant.
   */
  private detailCache = new Map<string, ConceptDetailDto>();
  private pendingRequests = new Set<string>();

  // Computed Map for the Pipe to look up IDs efficiently
  conceptMap = computed(() => {
    const map = new Map<string, ConceptDto>();
    this.concepts().forEach((c) => {
      map.set(c.name.trim().toLowerCase(), c);
    });
    return map;
  });

  // Computed Filter + sort. Sorting is client-side because the index is already
  // fully in memory; the preference persists so the column comes back the way it
  // was left.
  filteredConcepts = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const rows = q
      ? this.concepts().filter((c) => c.name.toLowerCase().includes(q))
      : [...this.concepts()];

    switch (this.indexSort()) {
      case 'az':
        return rows.sort((a, b) => a.name.localeCompare(b.name));
      case 'za':
        return rows.sort((a, b) => b.name.localeCompare(a.name));
      default:
        return rows.sort(
          (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name)
        );
    }
  });

  constructor() {
    this.conceptsService.list().subscribe({
      next: (data) => this.concepts.set(data),
      error: () => this.toast.error('Failed to load concepts'),
    });
  }

  setSort(sort: string): void {
    if (!INDEX_SORTS.includes(sort as IndexSort)) return;
    this.indexSort.set(sort as IndexSort);
    try {
      localStorage.setItem(INDEX_SORT_STORAGE_KEY, sort);
    } catch {
      /* private mode / storage disabled — a non-persisted sort is acceptable */
    }
  }

  private readStoredSort(): IndexSort {
    try {
      const stored = localStorage.getItem(INDEX_SORT_STORAGE_KEY);
      return INDEX_SORTS.includes(stored as IndexSort) ? (stored as IndexSort) : 'usage';
    } catch {
      return 'usage';
    }
  }

  /**
   * Warm the detail cache without changing the selection. Called on hover/focus
   * of an index row so the click itself is a cache hit and swaps with no wait.
   */
  prefetch(id: string): void {
    if (this.detailCache.has(id) || this.pendingRequests.has(id)) return;
    this.prefetchRequest(id);
  }

  private prefetchRequest(id: string): void {
    this.pendingRequests.add(id);
    this.conceptsService.get(id).subscribe({
      next: (detail) => {
        this.detailCache.set(id, detail);
        this.pendingRequests.delete(id);
      },
      error: () => this.pendingRequests.delete(id),
    });
  }

  selectConcept(id: string): void {
    this.selectedId.set(id);

    const cached = this.detailCache.get(id);
    if (cached) {
      // Instant, animation-free swap: same background, no loading surface, no
      // blur — the pane simply shows the concept that was asked for.
      this.selectedDetail.set(cached);
      this.loadingDetail.set(false);
      return;
    }

    if (this.pendingRequests.has(id)) {
      // A prefetch is already in flight for exactly this concept; let it land
      // and set loadingDetail then, so we do not dim content twice.
      this.loadingDetail.set(true);
      this.pendingRequests.delete(id);
    } else {
      this.loadingDetail.set(true);
    }

    this.conceptsService.get(id).subscribe({
      next: (detail) => {
        this.detailCache.set(id, detail);
        // Ignore a response for a concept the user has already moved on from.
        if (this.selectedId() !== id) return;
        this.selectedDetail.set(detail);
        this.loadingDetail.set(false);
      },
      error: () => {
        if (this.selectedId() !== id) return;
        this.toast.error('Failed to load concept details');
        this.loadingDetail.set(false);
      },
    });
  }

  // Clears selection to return to Index on mobile
  clearSelection(): void {
    this.selectedId.set(null);
    this.loadingDetail.set(false);
  }

  shouldCardSpanTwoColumns(note: NoteContextDto): boolean {
    const combinedLength = (note.content?.length || 0) + (note.selectedText?.length || 0);
    return combinedLength > 300;
  }

  // Handler for clicking concepts inside the text
  handleContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // The pipe adds the 'concept-tag' class and 'data-concept-id' attribute
    if (target.classList.contains('concept-tag')) {
      const conceptId = target.getAttribute('data-concept-id');
      if (conceptId) {
        event.preventDefault();
        event.stopPropagation();
        this.selectConcept(conceptId);
      }
    }
  }
}
