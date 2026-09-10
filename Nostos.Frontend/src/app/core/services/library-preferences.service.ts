import { Injectable, effect, signal } from '@angular/core';
import { BookSort } from '../dtos/book.enums';

export interface LibraryPreferences {
  viewMode: 'grid' | 'list';
  sort: BookSort;
  pageSize: number;
  sidebarExpanded: boolean;
  groupByWork: boolean;
}

export const LIBRARY_PREFERENCES_STORAGE_KEY = 'nostos.library.preferences';
const LEGACY_VIEW_MODE_STORAGE_KEY = 'nostos.viewMode';

const DEFAULT_PREFERENCES: LibraryPreferences = {
  viewMode: 'grid',
  sort: BookSort.LastRead,
  pageSize: 20,
  sidebarExpanded: true,
  groupByWork: true,
};

const VALID_VIEW_MODES: readonly LibraryPreferences['viewMode'][] = ['grid', 'list'];
const VALID_SORTS: readonly BookSort[] = Object.values(BookSort);

@Injectable({ providedIn: 'root' })
export class LibraryPreferencesService {
  readonly viewMode = signal<LibraryPreferences['viewMode']>(DEFAULT_PREFERENCES.viewMode);
  readonly sort = signal<BookSort>(DEFAULT_PREFERENCES.sort);
  readonly pageSize = signal(DEFAULT_PREFERENCES.pageSize);
  readonly sidebarExpanded = signal(DEFAULT_PREFERENCES.sidebarExpanded);
  readonly groupByWork = signal(DEFAULT_PREFERENCES.groupByWork);

  constructor() {
    this.hydrate();

    effect(() => {
      const preferences: LibraryPreferences = {
        viewMode: this.viewMode(),
        sort: this.sort(),
        pageSize: this.pageSize(),
        sidebarExpanded: this.sidebarExpanded(),
        groupByWork: this.groupByWork(),
      };

      this.writePreferences(preferences);
    });
  }

  setViewMode(mode: LibraryPreferences['viewMode']): void {
    if (VALID_VIEW_MODES.includes(mode)) this.viewMode.set(mode);
  }

  setSort(sort: BookSort): void {
    if (VALID_SORTS.includes(sort)) this.sort.set(sort);
  }

  setSidebarExpanded(expanded: boolean): void {
    this.sidebarExpanded.set(expanded);
  }

  setGroupByWork(grouped: boolean): void {
    this.groupByWork.set(grouped);
  }

  private hydrate(): void {
    const stored = this.readStorage(LIBRARY_PREFERENCES_STORAGE_KEY);
    if (stored !== null) {
      const parsed = this.parsePreferences(stored);
      if (parsed) this.apply(parsed);
      return;
    }

    // Before preferences were consolidated, only the view mode was saved.
    // Migrate that one value into an otherwise-default preferences object.
    const legacyViewMode = this.readStorage(LEGACY_VIEW_MODE_STORAGE_KEY);
    if (legacyViewMode === 'grid' || legacyViewMode === 'list') {
      this.viewMode.set(legacyViewMode);
    }
  }

  private parsePreferences(raw: string): LibraryPreferences | null {
    try {
      const value: unknown = JSON.parse(raw);
      if (!this.isRecord(value)) return null;

      const { viewMode, sort, pageSize, sidebarExpanded, groupByWork } = value;
      if (
        !this.isViewMode(viewMode) ||
        !this.isBookSort(sort) ||
        !this.isPageSize(pageSize) ||
        typeof sidebarExpanded !== 'boolean' ||
        typeof groupByWork !== 'boolean'
      ) {
        return null;
      }

      return { viewMode, sort, pageSize, sidebarExpanded, groupByWork };
    } catch {
      return null;
    }
  }

  private apply(preferences: LibraryPreferences): void {
    this.viewMode.set(preferences.viewMode);
    this.sort.set(preferences.sort);
    this.pageSize.set(preferences.pageSize);
    this.sidebarExpanded.set(preferences.sidebarExpanded);
    this.groupByWork.set(preferences.groupByWork);
  }

  private writePreferences(preferences: LibraryPreferences): void {
    try {
      localStorage.setItem(LIBRARY_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Persistence is best effort; private browsing and storage quotas can
      // make localStorage unavailable without affecting the library UI.
    }
  }

  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isViewMode(value: unknown): value is LibraryPreferences['viewMode'] {
    return typeof value === 'string' && VALID_VIEW_MODES.includes(value as LibraryPreferences['viewMode']);
  }

  private isBookSort(value: unknown): value is BookSort {
    return typeof value === 'string' && VALID_SORTS.includes(value as BookSort);
  }

  private isPageSize(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
  }
}
