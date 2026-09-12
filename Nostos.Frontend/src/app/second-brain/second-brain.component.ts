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
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  Search,
  BrainCircuit,
  ArrowLeft,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  GitMerge,
} from 'lucide-angular';

import { ToastService } from '../core/services/toast.service';
import { NotesService } from '../core/services/notes.service';
import { Note } from '../core/dtos/note.dtos';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import {
  ConceptsService,
  ConceptDto,
  ConceptDetailDto,
  NoteContextDto,
  ConceptStatsDto,
} from '../core/services/concepts.service';

type IndexSort = 'usage' | 'az' | 'za';
type NoteSort = 'newest' | 'oldest' | 'source';

const ALL_SOURCES = 'all';

interface SourceOption {
  value: string;
  label: string;
  count: number;
}

interface RelatedConceptDto {
  id: string;
  name: string;
  sharedNotes: number;
}

type RenameSurface = 'index' | 'header';

interface MergeRequest {
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  noteCount: number;
}

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
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    NoteCardComponent,
    ConfirmModal,
  ],
  templateUrl: './second-brain.component.html',
  styleUrls: ['./second-brain.component.css'],
})
export class SecondBrain {
  private conceptsService = inject(ConceptsService);
  private http = inject(HttpClient);
  private notesService = inject(NotesService);
  private toast = inject(ToastService);

  // Icons
  SearchIcon = Search;
  BrainIcon = BrainCircuit;
  ArrowLeftIcon = ArrowLeft;
  RenameIcon = Pencil;
  DeleteIcon = Trash2;
  ClearIcon = X;
  ExpandIcon = ChevronDown;
  CollapseIcon = ChevronUp;
  MergeIcon = GitMerge;

  // Phase 5 consumes these outputs to open the rename and confirmation flows.
  readonly renameRequested = output<string>();
  readonly deleteRequested = output<string>();

  // Concept management state. Rename stays in the surface that initiated it;
  // the confirmation state is separate from note deletion because the latter
  // has a different consequence and tone.
  renameId = signal<string | null>(null);
  renameSurface = signal<RenameSurface>('index');
  renameValue = signal('');
  renameError = signal<string | null>(null);
  renaming = signal(false);

  mergePickerOpen = signal(false);
  mergeSearchQuery = signal('');
  mergeTargetId = signal<string | null>(null);
  mergeConfirmation = signal<MergeRequest | null>(null);
  mergingConcept = signal(false);

  conceptDeleteTarget = signal<ConceptDto | null>(null);
  deletingConcept = signal(false);

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

  noteSearchQuery = signal('');
  sourceFilter = signal(ALL_SOURCES);
  noteSort = signal<NoteSort>('newest');

  relatedConcepts = signal<RelatedConceptDto[]>([]);
  relatedLoading = signal(false);
  relatedExpanded = signal(false);

  deleteTarget = signal<NoteContextDto | null>(null);
  deletingNote = signal(false);

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
  private detailRequestVersion = 0;
  private relatedCache = new Map<string, RelatedConceptDto[]>();
  private pendingRelatedRequests = new Set<string>();
  private relatedRequestVersion = 0;

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
    return this.filterAndSortConcepts(this.searchQuery(), null);
  });

  mergeCandidates = computed(() =>
    this.filterAndSortConcepts(this.mergeSearchQuery(), this.selectedId())
  );

  mergeTarget = computed(() => {
    const targetId = this.mergeTargetId();
    return targetId ? this.concepts().find((concept) => concept.id === targetId) ?? null : null;
  });

  conceptDeleteHeading = computed(() => {
    const target = this.conceptDeleteTarget();
    return target ? `Delete “${target.name}”?` : 'Delete concept?';
  });

  conceptDeleteDescription = computed(() => {
    const target = this.conceptDeleteTarget();
    return target
      ? `Deleting this concept removes its note links, but does not edit note text. The [[${target.name}]] reference stays in notes, and saving a note again will re-create the concept.`
      : '';
  });

  mergeHeading = computed(() => {
    const request = this.mergeConfirmation();
    return request ? `Merge “${request.sourceName}” into “${request.targetName}”?` : 'Merge concepts?';
  });

  mergeDescription = computed(() => {
    const request = this.mergeConfirmation();
    if (!request) return '';
    const noteLabel = request.noteCount === 1 ? 'note' : 'notes';
    return `This will move ${request.noteCount} ${noteLabel} into “${request.targetName}” and the source concept “${request.sourceName}” will disappear.`;
  });

  showLetterSeparators = computed(
    () => this.indexSort() !== 'usage' && this.filteredConcepts().length > 0
  );

  sourceOptions = computed<SourceOption[]>(() => {
    const counts = new Map<string, number>();
    for (const note of this.selectedDetail()?.notes ?? []) {
      const source = this.sourceName(note);
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  filteredNotes = computed(() => {
    const detail = this.selectedDetail();
    if (!detail) return [];

    const query = normalizeSearchText(this.noteSearchQuery().trim());
    const source = this.sourceFilter();
    const notes = detail.notes.filter((note) => {
      const matchesSource = source === ALL_SOURCES || this.sourceName(note) === source;
      if (!matchesSource) return false;
      if (!query) return true;

      return normalizeSearchText(
        [note.content, note.selectedText, note.bookTitle].filter(Boolean).join(' ')
      ).includes(query);
    });

    return notes.sort((a, b) => this.compareNotes(a, b));
  });

  noteFiltersActive = computed(
    () => this.sourceFilter() !== ALL_SOURCES || this.noteSearchQuery().trim().length > 0
  );

  visibleRelatedConcepts = computed(() =>
    this.relatedExpanded() ? this.relatedConcepts() : this.relatedConcepts().slice(0, 8)
  );

  hiddenRelatedCount = computed(() => Math.max(0, this.relatedConcepts().length - 8));

  deleteHeading = computed(() => {
    const target = this.deleteTarget();
    return target ? `Delete this note from “${target.bookTitle}”?` : 'Delete note?';
  });

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

  private filterAndSortConcepts(queryText: string, excludedId: string | null): ConceptDto[] {
    const query = normalizeSearchText(queryText.trim());
    const rows = this.concepts().filter(
      (concept) => concept.id !== excludedId && (!query || normalizeSearchText(concept.name).includes(query))
    );

    return rows.sort((a, b) => {
      if (query) {
        const rankDifference = searchRank(a.name, query) - searchRank(b.name, query);
        if (rankDifference !== 0) return rankDifference;
      }
      return this.compareForSort(a, b);
    });
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
    this.cursorIndex.set(null);
  }

  setNoteSearchQuery(query: string): void {
    this.noteSearchQuery.set(query);
  }

  clearNoteSearch(): void {
    this.setNoteSearchQuery('');
  }

  setSourceFilter(source: string): void {
    this.sourceFilter.set(source || ALL_SOURCES);
  }

  setNoteSort(sort: string): void {
    if (sort !== 'newest' && sort !== 'oldest' && sort !== 'source') return;
    this.noteSort.set(sort);
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

  startRename(id: string, surface: RenameSurface = 'index'): void {
    if (this.renaming()) return;
    const concept = this.concepts().find((candidate) => candidate.id === id);
    const detail = this.selectedDetail();
    const name = concept?.name ?? (detail?.id === id ? detail.name : null);
    if (!name) return;

    this.renameId.set(id);
    this.renameSurface.set(surface);
    this.renameValue.set(name);
    this.renameError.set(null);
  }

  cancelRename(): void {
    if (this.renaming()) return;
    this.renameId.set(null);
    this.renameValue.set('');
    this.renameError.set(null);
  }

  selectRenameInput(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  commitRename(id: string): void {
    if (this.renaming() || this.renameId() !== id) return;

    const name = this.renameValue().trim();
    if (!name) {
      this.renameError.set('A concept name is required.');
      return;
    }

    const original = this.concepts().find((concept) => concept.id === id);
    if (!original) {
      this.cancelRename();
      return;
    }

    this.renaming.set(true);
    this.conceptsService.rename(id, name).subscribe({
      next: (survivor) => {
        this.renaming.set(false);
        this.renameId.set(null);
        this.renameValue.set('');
        this.renameError.set(null);
        this.applyRenameResult(id, survivor);
      },
      error: () => {
        this.renaming.set(false);
        this.cancelRename();
        this.toast.error('Could not rename concept — changes were not saved');
      },
    });
  }

  private applyRenameResult(requestedId: string, survivor: ConceptDto): void {
    const selectedBefore = this.selectedId();
    const detailBefore = this.selectedDetail();
    const merged = survivor.id !== requestedId;

    this.invalidateRelatedData(!merged);
    if (!merged) {
      // Preserve an already-fetched detail for its in-place name update, but
      // prevent an older prefetch response from restoring the old name.
      this.detailRequestVersion += 1;
    }

    if (!merged) {
      this.concepts.update((items) =>
        items.map((concept) => (concept.id === requestedId ? survivor : concept))
      );

      const cached = this.detailCache.get(requestedId);
      if (cached) this.commitDetail(requestedId, { ...cached, name: survivor.name });
      if (detailBefore?.id === requestedId) {
        this.selectedDetail.set({ ...detailBefore, name: survivor.name });
      }
      this.toast.success(`Renamed to ${survivor.name}`);
    } else {
      this.concepts.update((items) =>
        items
          .filter((concept) => concept.id !== requestedId)
          .map((concept) => (concept.id === survivor.id ? survivor : concept))
      );
      this.invalidateDetailEntries(requestedId, survivor.id);

      if (selectedBefore === requestedId) {
        // Keep the existing pane painted while the surviving detail is
        // re-fetched. This is deliberately not a loading overlay or landing
        // state: the pane background does not change during the merge.
        if (detailBefore) {
          this.selectedDetail.set({
            ...detailBefore,
            id: survivor.id,
            name: survivor.name,
          });
        }
        this.selectConcept(survivor.id);
      }
      this.toast.success(`Merged into ${survivor.name}`);
    }

    this.refreshIndexAndStats();
  }

  openMergePicker(): void {
    const sourceId = this.selectedId();
    if (!sourceId || this.mergingConcept()) return;
    this.mergeSearchQuery.set('');
    this.mergeTargetId.set(null);
    this.mergePickerOpen.set(true);
  }

  closeMergePicker(): void {
    if (this.mergingConcept()) return;
    this.mergePickerOpen.set(false);
    this.mergeSearchQuery.set('');
    this.mergeTargetId.set(null);
  }

  chooseMergeTarget(id: string): void {
    if (id === this.selectedId()) return;
    this.mergeTargetId.set(id);
  }

  openMergeConfirmation(): void {
    const sourceId = this.selectedId();
    const target = this.mergeTarget();
    const source = sourceId ? this.concepts().find((concept) => concept.id === sourceId) : null;
    if (!source || !target || source.id === target.id) return;

    this.mergeConfirmation.set({
      sourceId: source.id,
      targetId: target.id,
      sourceName: this.selectedDetail()?.name ?? source.name,
      targetName: target.name,
      noteCount: this.selectedDetail()?.notes.length ?? source.usageCount,
    });
    this.mergePickerOpen.set(false);
  }

  cancelMergeConfirmation(): void {
    if (!this.mergingConcept()) this.mergeConfirmation.set(null);
  }

  confirmMerge(): void {
    const request = this.mergeConfirmation();
    if (!request || this.mergingConcept()) return;

    this.mergingConcept.set(true);
    this.conceptsService.merge(request.sourceId, request.targetId).subscribe({
      next: (survivor) => {
        this.mergingConcept.set(false);
        this.mergeConfirmation.set(null);
        const previousDetail = this.selectedDetail();

        this.concepts.update((items) =>
          items
            .filter((concept) => concept.id !== request.sourceId)
            .map((concept) => (concept.id === survivor.id ? survivor : concept))
        );
        this.invalidateDetailEntries(request.sourceId, request.targetId);
        this.invalidateRelatedData(false);

        if (this.selectedId() === request.sourceId) {
          if (previousDetail) {
            this.selectedDetail.set({
              ...previousDetail,
              id: survivor.id,
              name: survivor.name,
            });
          }
          this.selectConcept(survivor.id);
        }

        this.toast.success(`Merged ${request.sourceName} into ${survivor.name}`);
        this.refreshIndexAndStats();
      },
      error: () => {
        this.mergingConcept.set(false);
        this.mergeConfirmation.set(null);
        this.toast.error('Could not merge concepts — changes were not saved');
      },
    });
  }

  openDeleteConcept(id: string): void {
    if (this.deletingConcept()) return;
    const concept = this.concepts().find((candidate) => candidate.id === id);
    if (concept) this.conceptDeleteTarget.set(concept);
  }

  cancelDeleteConcept(): void {
    if (!this.deletingConcept()) this.conceptDeleteTarget.set(null);
  }

  confirmDeleteConcept(): void {
    const target = this.conceptDeleteTarget();
    if (!target || this.deletingConcept()) return;

    this.deletingConcept.set(true);
    this.conceptsService.delete(target.id).subscribe({
      next: () => {
        this.deletingConcept.set(false);
        this.conceptDeleteTarget.set(null);
        this.concepts.update((items) => items.filter((concept) => concept.id !== target.id));
        this.invalidateDetailEntries(target.id);
        this.invalidateRelatedData(false);
        if (this.selectedId() === target.id) {
          this.clearSelection();
        }
        this.toast.success(`Deleted ${target.name}`);
        this.refreshIndexAndStats();
      },
      error: () => {
        this.deletingConcept.set(false);
        this.conceptDeleteTarget.set(null);
        this.toast.error('Could not delete concept — it is still in your index');
      },
    });
  }

  requestRename(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.startRename(id, 'index');
    this.renameRequested.emit(id);
  }

  requestDelete(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openDeleteConcept(id);
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
    const requestVersion = this.detailRequestVersion;
    this.conceptsService.get(id).subscribe({
      next: (detail) => {
        this.pendingRequests.delete(id);
        if (requestVersion !== this.detailRequestVersion) return;
        this.detailCache.set(id, detail);
        if (this.selectedId() !== id) return;
        this.selectedDetail.set(detail);
        this.loadingDetail.set(false);
        this.loadRelated(id);
      },
      error: () => {
        this.pendingRequests.delete(id);
        if (requestVersion !== this.detailRequestVersion) return;
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

  private sourceName(note: NoteContextDto): string {
    return note.bookTitle?.trim() || 'Unknown source';
  }

  private compareNotes(a: NoteContextDto, b: NoteContextDto): number {
    if (this.noteSort() === 'source') return this.compareBySource(a, b);

    const aTime = this.noteTime(a);
    const bTime = this.noteTime(b);
    // Some local fixtures predate createdAt. Keep their source ordering stable
    // instead of inventing timestamps that would make the sort misleading.
    if (aTime === null || bTime === null) return this.compareBySource(a, b);

    const difference = aTime - bTime;
    if (difference !== 0) return this.noteSort() === 'newest' ? -difference : difference;
    return a.noteId.localeCompare(b.noteId);
  }

  private compareBySource(a: NoteContextDto, b: NoteContextDto): number {
    return this.sourceName(a).localeCompare(this.sourceName(b)) || a.noteId.localeCompare(b.noteId);
  }

  private noteTime(note: NoteContextDto): number | null {
    if (!note.createdAt) return null;
    const timestamp = Date.parse(note.createdAt);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  selectConcept(id: string): void {
    this.selectedId.set(id);
    this.noteSearchQuery.set('');
    this.sourceFilter.set(ALL_SOURCES);
    this.noteSort.set('newest');
    this.relatedExpanded.set(false);
    this.loadRelated(id);

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

    const requestVersion = this.detailRequestVersion;
    this.conceptsService.get(id).subscribe({
      next: (detail) => {
        if (requestVersion !== this.detailRequestVersion) return;
        this.detailCache.set(id, detail);
        // Ignore a response for a concept the user has already moved on from.
        if (this.selectedId() !== id) return;
        this.selectedDetail.set(detail);
        this.loadingDetail.set(false);
      },
      error: () => {
        if (requestVersion !== this.detailRequestVersion) return;
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
    this.selectedDetail.set(null);
    this.relatedConcepts.set([]);
  }

  /**
   * Cards stay in one grid track. The shared card clamps long bodies and gives
   * them a Show more disclosure, so one long note cannot create an empty half
   * row or make sibling cards in that row adopt a different rhythm.
   */
  shouldCardSpanTwoColumns(_note: NoteContextDto): boolean {
    return false;
  }

  noteForCard(note: NoteContextDto): Note {
    return {
      id: note.noteId,
      bookId: note.bookId,
      content: note.content,
      cfiRange: note.cfiRange,
      selectedText: note.selectedText,
      createdAt: note.createdAt ?? '',
      bookTitle: note.bookTitle,
    };
  }

  private loadRelated(id: string): void {
    const cached = this.relatedCache.get(id);
    if (cached) {
      if (this.selectedId() === id) {
        this.relatedConcepts.set(cached);
        this.relatedLoading.set(false);
      }
      return;
    }
    if (this.pendingRelatedRequests.has(id)) {
      if (this.selectedId() === id) this.relatedLoading.set(true);
      return;
    }

    this.pendingRelatedRequests.add(id);
    if (this.selectedId() === id) this.relatedLoading.set(true);
    const requestVersion = this.relatedRequestVersion;
    this.http.get<RelatedConceptDto[]>(`/api/concepts/${id}/related`).subscribe({
      next: (related) => {
        this.pendingRelatedRequests.delete(id);
        if (requestVersion !== this.relatedRequestVersion) return;
        this.relatedCache.set(id, related);
        if (this.selectedId() !== id) return;
        this.relatedConcepts.set(related);
        this.relatedLoading.set(false);
      },
      error: () => {
        this.pendingRelatedRequests.delete(id);
        if (requestVersion !== this.relatedRequestVersion) return;
        if (this.selectedId() !== id) return;
        this.relatedConcepts.set([]);
        this.relatedLoading.set(false);
      },
    });
  }

  private invalidateRelatedData(reloadSelected: boolean): void {
    this.relatedRequestVersion += 1;
    this.relatedCache.clear();
    this.pendingRelatedRequests.clear();
    this.relatedConcepts.set([]);
    this.relatedExpanded.set(false);
    this.relatedLoading.set(false);

    const selectedId = this.selectedId();
    if (reloadSelected && selectedId) this.loadRelated(selectedId);
  }

  private invalidateDetailEntries(...ids: string[]): void {
    this.detailRequestVersion += 1;
    for (const id of ids) {
      this.detailCache.delete(id);
      this.pendingRequests.delete(id);
    }
  }

  private refreshIndexAndStats(): void {
    // Mutation responses update the visible row immediately. These background
    // reads reconcile counts and cover server-side deduplication after a merge,
    // without toggling the list's wait field or covering the detail pane.
    this.conceptsService.list().subscribe({
      next: (data) => this.concepts.set(data),
      error: () => this.toast.error('The concept index could not be refreshed'),
    });
    this.conceptsService.getStats().subscribe({
      next: (stats) => this.conceptStats.set(stats),
      error: () => this.toast.error('The concept statistics could not be refreshed'),
    });
  }

  toggleRelated(): void {
    this.relatedExpanded.update((expanded) => !expanded);
  }

  onUpdateNote(event: { id: string; content: string; selectedText?: string }): void {
    const conceptId = this.selectedId();
    const detail = this.selectedDetail();
    const original = detail?.notes.find((note) => note.noteId === event.id);
    if (!conceptId || !detail || !original) return;

    const previousDetail = detail;
    const optimisticDetail: ConceptDetailDto = {
      ...detail,
      notes: detail.notes.map((note) =>
        note.noteId === event.id
          ? { ...note, content: event.content, selectedText: event.selectedText }
          : note
      ),
    };
    this.commitDetail(conceptId, optimisticDetail);

    this.notesService
      .update(event.id, { content: event.content, selectedText: event.selectedText })
      .subscribe({
        next: (updated) => {
          const current = this.detailCache.get(conceptId);
          if (!current) return;
          this.commitDetail(conceptId, {
            ...current,
            notes: current.notes.map((note) =>
              note.noteId === event.id ? this.contextFromNote(updated, note) : note
            ),
          });
          this.toast.success('Note updated');
        },
        error: () => {
          this.commitDetail(conceptId, previousDetail);
          this.toast.error('Failed to update note — changes reverted');
        },
      });
  }

  onDeleteNote(noteId: string): void {
    if (this.deletingNote()) return;
    const note = this.selectedDetail()?.notes.find((candidate) => candidate.noteId === noteId);
    if (note) this.deleteTarget.set(note);
  }

  cancelDeleteNote(): void {
    if (!this.deletingNote()) this.deleteTarget.set(null);
  }

  confirmDeleteNote(): void {
    const target = this.deleteTarget();
    const conceptId = this.selectedId();
    const detail = this.selectedDetail();
    if (!target || !conceptId || !detail || this.deletingNote()) return;

    const previousDetail = detail;
    this.deletingNote.set(true);
    this.commitDetail(conceptId, {
      ...detail,
      notes: detail.notes.filter((note) => note.noteId !== target.noteId),
    });

    this.notesService.delete(target.noteId).subscribe({
      next: () => {
        this.adjustConceptUsage(conceptId, -1);
        this.deletingNote.set(false);
        this.deleteTarget.set(null);
        this.toast.success('Note deleted');
      },
      error: () => {
        this.commitDetail(conceptId, previousDetail);
        this.deletingNote.set(false);
        this.deleteTarget.set(null);
        this.toast.error('Failed to delete note — note restored');
      },
    });
  }

  private commitDetail(conceptId: string, detail: ConceptDetailDto): void {
    this.detailCache.set(conceptId, detail);
    if (this.selectedId() === conceptId) this.selectedDetail.set(detail);
  }

  private contextFromNote(updated: Note, previous: NoteContextDto): NoteContextDto {
    return {
      noteId: updated.id,
      content: updated.content,
      selectedText: updated.selectedText,
      cfiRange: updated.cfiRange ?? previous.cfiRange,
      bookId: updated.bookId ?? previous.bookId,
      bookTitle: updated.bookTitle ?? previous.bookTitle,
      createdAt: updated.createdAt || previous.createdAt,
    };
  }

  private adjustConceptUsage(conceptId: string, delta: number): void {
    this.concepts.update((items) =>
      items.map((concept) =>
        concept.id === conceptId
          ? { ...concept, usageCount: Math.max(0, concept.usageCount + delta) }
          : concept
      )
    );
    this.conceptStats.update((stats) =>
      stats
        ? { ...stats, totalReferences: Math.max(0, stats.totalReferences + delta) }
        : stats
    );
  }

  // Handler for clicking concepts inside the text
  handleContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // The pipe adds the 'concept-tag' class and 'data-concept-id' attribute
    const conceptTag = target.closest('.concept-tag');
    if (conceptTag) {
      // Angular's innerHTML sanitizer may remove the data attribute in some
      // browser/test DOMs. The rendered label is still the canonical concept
      // name, so use it as a safe fallback while retaining the fast id path.
      const conceptId =
        conceptTag.getAttribute('data-concept-id') ??
        this.concepts().find(
          (concept) => concept.name.trim().toLowerCase() === conceptTag.textContent?.trim().toLowerCase()
        )?.id;
      if (conceptId) {
        event.preventDefault();
        event.stopPropagation();
        this.selectConcept(conceptId);
      }
    }
  }
}
