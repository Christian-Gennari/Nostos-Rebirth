import { TestBed } from '@angular/core/testing';

import { ThemeService, THEME_STORAGE_KEY } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light when no theme is stored', () => {
    const service = TestBed.inject(ThemeService);

    expect(service.theme()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('persists the theme to localStorage and applies the data-theme attribute on setTheme', () => {
    const service = TestBed.inject(ThemeService);

    service.setTheme('dark');

    expect(service.theme()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('updates the signal, attribute, and storage for every theme value', () => {
    const service = TestBed.inject(ThemeService);

    for (const theme of ['dark', 'sepia', 'light'] as const) {
      service.setTheme(theme);
      expect(service.theme()).toBe(theme);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
      expect(document.documentElement.getAttribute('data-theme')).toBe(theme);
    }
  });

  it('hydrates a stored valid theme on construction', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    const service = new ThemeService();

    expect(service.theme()).toBe('sepia');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sepia');
  });

  it('ignores an invalid stored value and falls back to light', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');

    const service = new ThemeService();

    expect(service.theme()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('does not write anything when setTheme receives an invalid value', () => {
    const service = TestBed.inject(ThemeService);

    // Cast through unknown to simulate a runtime-invalid call.
    service.setTheme('neon' as unknown as 'light' | 'dark' | 'sepia');

    expect(service.theme()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
