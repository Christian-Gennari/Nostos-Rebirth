import { TestBed } from '@angular/core/testing';
import { ThemeService, THEME_STORAGE_KEY, readStoredTheme } from './theme.service';

/**
 * The theme service is the only writer of `data-theme` on <html>. These tests
 * pin the contracts that a future refactor could silently break:
 *   1. light removes the attribute rather than setting `data-theme="light"`
 *      (so `:root` stays the single owner of the light values), while every
 *      other theme sets the attribute to its own name;
 *   2. the choice persists, and a fresh read honours it.
 */
describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light when nothing is stored and the OS reports no preference', () => {
    const service = TestBed.inject(ThemeService);
    expect(service.theme()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('applies and persists dark', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('removes the attribute for light rather than setting data-theme="light"', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    service.setTheme('light');

    expect(service.theme()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('toggles between the two themes', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('light');
    service.toggle();
    expect(service.theme()).toBe('dark');
    service.toggle();
    expect(service.theme()).toBe('light');
  });

  it('reads a stored dark choice on boot', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('applies and persists sepia, the third theme', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('sepia');

    expect(service.theme()).toBe('sepia');
    // The attribute carries the theme's own name, which is what the
    // `:root[data-theme='sepia']` block matches on.
    expect(document.documentElement.getAttribute('data-theme')).toBe('sepia');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('sepia');
  });

  it('reads a stored sepia choice on boot', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredTheme()).toBe('sepia');
  });

  it('leaves sepia for light by removing the attribute, not by shadowing it', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('sepia');
    service.setTheme('light');

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores an unknown stored value instead of trusting it', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    // Falls back to the OS preference, which is not dark under the test runner.
    expect(readStoredTheme()).toBe('light');
  });
});
