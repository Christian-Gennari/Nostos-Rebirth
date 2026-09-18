import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'sepia';

/** Every theme the app offers, in the order the settings control shows them. */
export const THEMES: readonly Theme[] = ['light', 'dark', 'sepia'];

const STORAGE_KEY = 'nostos.theme';
const DARK = 'dark';
const LIGHT = 'light';

/**
 * App-wide colour theme.
 *
 * Ownership: this service is the ONLY writer of `data-theme` on
 * `<html>`. Everything else reads the resulting CSS custom properties, so a
 * component never needs to know which theme is active.
 *
 * The stylesheet is also the source of truth for what each theme *looks like*;
 * this file only decides which one is on. `styles.css` declares light on
 * `:root` and each other theme on `:root[data-theme='<name>']`, which is what
 * makes the `data-theme="light"` case work without a second light block:
 * removing the attribute falls back to the `:root` defaults.
 *
 * Anti-flash: `index.html` runs a tiny inline script that applies the stored
 * theme before first paint. That script must stay in sync with
 * `readStoredTheme`/`STORAGE_KEY` below.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(readStoredTheme());
  readonly theme = this._theme.asReadonly();

  constructor() {
    this.apply(this._theme());
  }

  setTheme(theme: Theme): void {
    this._theme.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode / storage disabled: the theme still applies for this
      // session, it just will not be remembered. Not worth failing over.
    }
  }

  toggle(): void {
    this.setTheme(this._theme() === DARK ? LIGHT : DARK);
  }

  private apply(theme: Theme): void {
    const root = document.documentElement;
    if (theme === LIGHT) {
      // Removing the attribute (rather than setting 'light') keeps `:root` as
      // the single owner of the light values. Dark and sepia are additive, so
      // the attribute is simply their name.
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }
}

/**
 * Read the persisted choice, defaulting to the OS preference on first visit.
 * Deliberately does NOT persist the OS-derived value: a user who never chose
 * should keep following their system when it changes.
 */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) return stored as Theme;
  } catch {
    // fall through to the OS preference
  }
  return prefersDark() ? DARK : LIGHT;
}

export function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export const THEME_STORAGE_KEY = STORAGE_KEY;
