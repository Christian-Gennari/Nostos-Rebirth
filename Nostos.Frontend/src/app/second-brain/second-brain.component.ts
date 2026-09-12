import {
  Component,
  computed,
  ElementRef,
  inject,
  output,
  QueryList,
  signal,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  Search,
  BrainCircuit,
  ArrowLeft,
  ArrowRight,
  Pencil,
  Trash2,
  X,
} from 'lucide-angular';

import { ToastService } from '../core/services/toast.service';
import {
  ConceptsService,
  ConceptDto,
  ConceptDetailDto,
  NoteContextDto,
  ConceptStatsDto,
} from '../core/services/concepts.service';

import { NoteFormatPipe } from '../ui/pipes/note-format.pipe';

type IndexSort = 'usage' | 'az' | 'za';

const INDEX_SORT_STORAGE_KEY = 'nostos.brain.indexSort';

const INDEX_SORTS: readonly IndexSort[] = ['usage', 'az', 'za'];

interface NamePart {
  text: string;
  highlight: boolean;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function searchRank(name: string, query: string): number {
  const normalizedName = normalizeSearchText(name);
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  return 2;
}

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
  RenameIcon = Pencil;
  DeleteIcon = Trash2;
  ClearIcon = X;

  // Phase 5 consumes these outputs to open the rename and confirmation flows.
  readonly renameRequested = output<string>();
  readonly deleteRequested = output<string>();

  // State
  concepts = signal<ConceptDto[]>([]);
  conceptStats = signal<ConceptStatsDto | null>(null);
  loadingConcepts = signal(true);
  searchQuery = signal('');
  indexSort = signal<IndexSort>(this.readStoredSort());
  cursorIndex = signal<number | null>(null);

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

  @ViewChildren('indexRow') private indexRows!: QueryList<ElementRef<HTMLElement>>;

  // Computed Map for the Pipe to look up IDs efficiently
  conceptMap = computed(() => {
    const map = new Map<string, ConceptDto>();
    this.concepts().forEach((c) => {
      map.set(c.name.trim().toLowerCase(), c);
    });
    return map;
  });

  // Computed filter + sort. Sorting is client-side because the index is already
  // fully in memory; the preference persists so the column comes back the way it
  // was left. Search ranking is deliberately separate from the active sort: an
  // exact match always leads, while each match group retains the chosen order.
  filteredConcepts = computed(() => {
    const query = normalizeSearchText(this.searchQuery().trim());
    const rows = query
      ? this.concepts().filter((concept) => normalizeSearchText(concept.name).includes(query))
      : [...this.concepts()];

    return rows.sort((a, b) => {
      if (query) {
        const rankDifference = searchRank(a.name, query) - searchRank(b.name, query);
        if (rankDifference !== 0) return rankDifference;
      }
      return this.compareForSort(a, b);
    });
  });

  showLetterSeparators = computed(
    () => this.indexSort() !== 'usage' && this.filteredConcepts().length > 0
  );

  constructor() {
    this.conceptsService.list().subscribe({
      next: (data) => {
        this.concepts.set(data);
        this.loadingConcepts.set(false);
      },
      error: () => {
        this.loadingConcepts.set(false);
        this.toast.error('Failed to load concepts');
      },
    });

    this.conceptsService.getStats().subscribe({
      next: (stats) => this.conceptStats.set(stats),
      // Stats are editorial decoration. A failed request must not make the
      // index unavailable or produce a toast for an otherwise usable page.
      error: () => undefined,
    });
  }

  private compareForSort(a: ConceptDto, b: ConceptDto): number {
    switch (this.indexSort()) {
      case 'az':
        return a.name.localeCompare(b.name);
      case 'za':
        return b.name.localeCompare(a.name);
      default:
        return b.usageCount - a.usageCount || a.name.localeCompare(b.name);
    }
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
    this.cursorIndex.set(null);
  }

  clearSearch(): void {
    this.setSearchQuery('');
  }

  handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.searchQuery()) event.preventDefault();
      this.clearSearch();
      return;
    }

    if (event.key === 'ArrowDown' && this.filteredConcepts().length > 0) {
      event.preventDefault();
      this.focusCursor(0);
    }
  }

  handleIndexFocus(index: number): void {
    this.cursorIndex.set(index);
  }

  handleIndexKeydown(event: KeyboardEvent, index: number, id: string): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusCursor(Math.min(index + 1, this.filteredConcepts().length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusCursor(Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.selectConcept(id);
    }
  }

  private focusCursor(index: number): void {
    const rows = this.filteredConcepts();
    if (rows.length === 0) return;

    const boundedIndex = Math.max(0, Math.min(index, rows.length - 1));
    this.cursorIndex.set(boundedIndex);

    const row = this.indexRows?.get(boundedIndex)?.nativeElement;
    if (!row) return;
    row.focus();
    row.scrollIntoView?.({ block: 'nearest' });
  }

  letterFor(concept: ConceptDto): string {
    const firstLetter = concept.name.trim().charAt(0);
    return firstLetter ? firstLetter.toLocaleUpperCase() : '#';
  }

  isLetterStart(index: number): boolean {
    if (!this.showLetterSeparators()) return false;
    if (index === 0) return true;
    const rows = this.filteredConcepts();
    return this.letterFor(rows[index]) !== this.letterFor(rows[index - 1]);
  }

  highlightName(name: string): NamePart[] {
    const query = normalizeSearchText(this.searchQuery().trim());
    if (!query) return [{ text: name, highlight: false }];

    const normalizedChars: string[] = [];
    const sourceStarts: number[] = [];
    const sourceEnds: number[] = [];

    for (let index = 0; index < name.length; ) {
      const codePoint = name.codePointAt(index);
      if (codePoint === undefined) break;
      const sourceChar = String.fromCodePoint(codePoint);
      const normalizedChar = normalizeSearchText(sourceChar);
      for (const character of normalizedChar) {
        normalizedChars.push(character);
        sourceStarts.push(index);
        sourceEnds.push(index + sourceChar.length);
      }
      index += sourceChar.length;
    }

    const matchStart = normalizedChars.join('').indexOf(query);
    if (matchStart < 0) return [{ text: name, highlight: false }];

    const matchEnd = matchStart + query.length - 1;
    const sourceStart = sourceStarts[matchStart];
    const sourceEnd = sourceEnds[matchEnd];
    return [
      { text: name.slice(0, sourceStart), highlight: false },
      { text: name.slice(sourceStart, sourceEnd), highlight: true },
      { text: name.slice(sourceEnd), highlight: false },
    ].filter((part) => part.text.length > 0);
  }

  requestRename(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.renameRequested.emit(id);
  }

  requestDelete(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.deleteRequested.emit(id);
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
        if (this.selectedId() !== id) return;
        this.selectedDetail.set(detail);
        this.loadingDetail.set(false);
      },
      error: () => {
        this.pendingRequests.delete(id);
        if (this.selectedId() === id) this.loadingDetail.set(false);
      },
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
      // and set the detail when it lands, so we do not start a duplicate
      // request or dim content twice.
      this.loadingDetail.set(true);
      return;
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
