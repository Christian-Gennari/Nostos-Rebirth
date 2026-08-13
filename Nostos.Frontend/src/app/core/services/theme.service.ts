import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'sepia';

/** localStorage key used to persist the chosen reader theme. */
export const THEME_STORAGE_KEY = 'nostos.theme';

const VALID_THEMES: readonly Theme[] = ['light', 'dark', 'sepia'];

/**
 * Owns the app-wide reader theme.
 *
 * The theme is applied globally via the `data-theme` attribute on
 * `document.documentElement`; styles.css maps each value to a full token
 * override block. The current choice is persisted to localStorage and
 * re-hydrated on construction, so a stored theme survives reloads.
 */
@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  readonly theme = signal<Theme>('light');

  constructor() {
    this.hydrate();
  }

  /**
   * Switches the theme: updates the signal, applies the `data-theme`
   * attribute, and persists the choice. Invalid values are ignored.
   */
  setTheme(theme: Theme): void {
    if (!VALID_THEMES.includes(theme)) return;

    this.theme.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  /**
   * Restores a stored theme on startup. Invalid or missing stored values
   * fall back to the 'light' default (nothing is applied or written).
   */
  private hydrate(): void {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'sepia') {
      this.theme.set(stored);
      document.documentElement.setAttribute('data-theme', stored);
    }
  }
}
