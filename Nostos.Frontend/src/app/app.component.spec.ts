import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app.component';
import { ThemeService, THEME_STORAGE_KEY } from './core/services/theme.service';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the app shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
    expect(compiled.querySelector('app-toast-container')).not.toBeNull();
  });

  it('hydrates a stored global theme onto documentElement at boot', () => {
    // Simulate a returning user: 'nostos.theme' is stored before the app
    // boots. Constructing the root component must construct ThemeService,
    // whose constructor applies the stored theme at boot on EVERY route.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    TestBed.createComponent(App);

    const themeService = TestBed.inject(ThemeService);
    expect(themeService.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('does not apply a theme when nothing is stored', () => {
    TestBed.createComponent(App);

    const themeService = TestBed.inject(ThemeService);
    expect(themeService.theme()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
