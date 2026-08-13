import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import ePub from 'epubjs';

import { NotesService } from '../../core/services/notes.service';
import { BooksService } from '../../core/services/books.service';
import { EpubReader } from './epub-reader.component';
import { EpubAnnotationManager } from './epub-annotation-manager';
import { ThemeService, THEME_STORAGE_KEY } from '../../core/services/theme.service';

vi.mock('epubjs', () => ({ default: vi.fn() }));

/**
 * Highlight-mode wiring of the EPUB reader (issue #16), "Minimal Section A
 * specs" items 14-16: manager init before display, single propagation of mode
 * changes, and manager cleanup before book/rendition destruction.
 */
describe('EpubReader highlight-mode lifecycle (issue #16)', () => {
  let fixture: ComponentFixture<EpubReader>;
  let log: string[];

  const notesService = {
    list: vi.fn(() => of([])),
    create: vi.fn(() => of({ id: 'n1' } as never)),
  };
  const booksService = {
    getLocations: vi.fn(() => of({ locations: null })),
    saveLocations: vi.fn(() => of(null)),
    updateProgress: vi.fn(() => of(null)),
    get: vi.fn(() => of({ lastLocation: null })),
  };

  const createFakeBook = () => {
    const rendition = {
      hooks: { content: { register: vi.fn(() => log.push('content-hook')) } },
      on: vi.fn(),
      off: vi.fn(),
      annotations: { highlight: vi.fn(), add: vi.fn(), remove: vi.fn() },
      getContents: vi.fn(() => []),
      views: vi.fn(() => []),
      getRange: vi.fn(),
      themes: { register: vi.fn(), select: vi.fn(), fontSize: vi.fn() },
      display: vi.fn(() => {
        log.push('display');
        return Promise.resolve();
      }),
      resize: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      currentLocation: vi.fn(() => ({ start: { cfi: 'epubcfi(/6)' } })),
    };
    const book = {
      renderTo: vi.fn(() => rendition),
      ready: Promise.resolve({ navigation: { toc: [] } }),
      locations: {
        load: vi.fn(),
        generate: vi.fn(() => Promise.resolve()),
        save: vi.fn(),
        length: () => 0,
        percentageFromCfi: () => 0,
        locationFromCfi: () => 0,
      },
      navigation: { toc: [] },
      destroy: vi.fn(() => log.push('book-destroy')),
    };
    return { book, rendition };
  };

  beforeEach(async () => {
    log = [];
    vi.mocked(ePub).mockImplementation(() => createFakeBook().book as never);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    await TestBed.configureTestingModule({
      imports: [EpubReader],
      providers: [
        { provide: NotesService, useValue: notesService },
        { provide: BooksService, useValue: booksService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setupComponent() {
    fixture = TestBed.createComponent(EpubReader);
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.detectChanges();
    // Settle book.ready + rendition.display() + service subscriptions.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('initializes the annotation manager before rendition.display()', async () => {
    const initSpy = vi
      .spyOn(EpubAnnotationManager.prototype, 'init')
      .mockImplementation(() => {
        log.push('manager-init');
      });

    await setupComponent();

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(log.indexOf('content-hook')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('manager-init')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('manager-init')).toBeLessThan(log.indexOf('display'));
    // The content hook is registered before display so the opening section is wired.
    expect(log.indexOf('content-hook')).toBeLessThan(log.indexOf('display'));
  });

  it('propagates highlight mode input changes exactly once', async () => {
    const modeSpy = vi.spyOn(EpubAnnotationManager.prototype, 'setHighlightMode');
    await setupComponent();

    modeSpy.mockClear();
    fixture.componentRef.setInput('highlightMode', true);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(modeSpy).toHaveBeenCalledTimes(1);
    expect(modeSpy).toHaveBeenCalledWith(true);
  });

  it('destroys the annotation manager before the book/rendition', async () => {
    const destroySpy = vi
      .spyOn(EpubAnnotationManager.prototype, 'destroy')
      .mockImplementation(() => {
        log.push('manager-destroy');
      });

    await setupComponent();
    fixture.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(log.indexOf('manager-destroy')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('manager-destroy')).toBeLessThan(log.indexOf('book-destroy'));
  });
});

/**
 * Reader-theme propagation (expert design section 1): the three Nostos themes
 * are registered once per rendition via `rendition.themes`, the current theme
 * is selected at rendition creation (before first display), an Angular effect
 * re-selects on ThemeService changes without recreating the rendition, and
 * newly rendered chapters inherit the selected theme. The fake rendition's
 * `themes` object mimics the verified epub.js 0.3.93 Themes behavior: an
 * inject hook registered on `hooks.content` injects the CURRENT theme's rules
 * and body class into every new contents.
 */
describe('EpubReader theme propagation (nostos-light/dark/sepia)', () => {
  let fixture: ComponentFixture<EpubReader>;
  let log: string[];
  let contentHooks: ((contents: any) => void)[];
  let hookRegistrations: number;
  let renditions: any[];
  let books: any[];

  const notesService = {
    list: vi.fn(() => of([])),
    create: vi.fn(() => of({ id: 'n1' } as never)),
  };
  const booksService = {
    getLocations: vi.fn(() => of({ locations: null })),
    saveLocations: vi.fn(() => of(null)),
    updateProgress: vi.fn(() => of(null)),
    get: vi.fn(() => of({ lastLocation: null })),
  };

  const makeContents = () => {
    const doc = new DOMParser().parseFromString(
      '<html><head></head><body></body></html>',
      'text/html',
    );
    return { document: doc, window, content: doc.body };
  };

  const createFakeBook = () => {
    contentHooks = [];

    const themes = {
      rules: {} as Record<string, Record<string, Record<string, string>>>,
      registered: [] as string[],
      selected: [] as string[],
      current: 'default',
      fontSize: vi.fn(),
      register(name: string, rules: any) {
        themes.rules[name] = rules;
        themes.registered.push(name);
        log.push(`register:${name}`);
      },
      select(name: string) {
        themes.selected.push(name);
        themes.current = name;
        log.push(`select:${name}`);
      },
    };

    const rendition = {
      hooks: {
        content: {
          register: vi.fn((cb: (contents: any) => void) => {
            contentHooks.push(cb);
            hookRegistrations++;
          }),
        },
      },
      themes,
      on: vi.fn(),
      off: vi.fn(),
      annotations: { highlight: vi.fn(), add: vi.fn(), remove: vi.fn() },
      getContents: vi.fn(() => []),
      views: vi.fn(() => []),
      getRange: vi.fn(),
      display: vi.fn(() => {
        log.push('display');
        return Promise.resolve();
      }),
      resize: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      currentLocation: vi.fn(() => ({ start: { cfi: 'epubcfi(/6/4)' } })),
    };

    // Mimic epub.js Themes' constructor hook: every new contents document
    // receives the CURRENT theme's rules (injected stylesheet) and the
    // theme class on the body.
    rendition.hooks.content.register((contents: any) => {
      const active = themes.current;
      if (themes.rules[active]) {
        const style = contents.document.createElement('style');
        style.id = `epubjs-inserted-css-${active}`;
        style.textContent = `${active} ${JSON.stringify(themes.rules[active])}`;
        contents.document.head.appendChild(style);
        contents.document.body.classList.add(active);
      }
    });

    const book = {
      renderTo: vi.fn(() => {
        renditions.push(rendition);
        return rendition;
      }),
      ready: Promise.resolve({ navigation: { toc: [] } }),
      locations: {
        load: vi.fn(),
        generate: vi.fn(() => Promise.resolve()),
        save: vi.fn(),
        length: () => 0,
        percentageFromCfi: () => 0,
        locationFromCfi: () => 0,
      },
      navigation: { toc: [] },
      destroy: vi.fn(() => log.push('book-destroy')),
    };
    books.push(book);
    return { book, rendition, themes };
  };

  beforeEach(async () => {
    log = [];
    renditions = [];
    books = [];
    hookRegistrations = 0;
    localStorage.clear();
    vi.mocked(ePub).mockImplementation(() => createFakeBook().book as never);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    await TestBed.configureTestingModule({
      imports: [EpubReader],
      providers: [
        { provide: NotesService, useValue: notesService },
        { provide: BooksService, useValue: booksService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setupComponent() {
    fixture = TestBed.createComponent(EpubReader);
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.detectChanges();
    // Settle book.ready + rendition.display() + service subscriptions + effects.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function themeService() {
    return TestBed.inject(ThemeService);
  }

  async function switchTheme(theme: 'light' | 'dark' | 'sepia') {
    themeService().setTheme(theme);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('registers nostos-light/dark/sepia once and selects the initial theme before first display', async () => {
    await setupComponent();

    const themes = renditions[0].themes;
    expect(themes.registered).toEqual(['nostos-light', 'nostos-dark', 'nostos-sepia']);
    // The eager selection at rendition creation happens BEFORE display().
    expect(log.indexOf('select:nostos-light')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('select:nostos-light')).toBeLessThan(log.indexOf('display'));
    expect(themes.current).toBe('nostos-light');
  });

  it('selects a persisted theme at rendition creation (no first-section white flash)', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    await setupComponent();

    const themes = renditions[0].themes;
    expect(log.indexOf('select:nostos-dark')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('select:nostos-dark')).toBeLessThan(log.indexOf('display'));
    expect(themes.current).toBe('nostos-dark');
  });

  it('light -> dark -> sepia applies in-session without reopening the book', async () => {
    await setupComponent();
    const rendition = renditions[0];
    const themes = rendition.themes;

    await switchTheme('dark');
    expect(themes.selected[themes.selected.length - 1]).toBe('nostos-dark');

    await switchTheme('sepia');
    expect(themes.selected[themes.selected.length - 1]).toBe('nostos-sepia');

    // The book was never reopened and the rendition was never recreated.
    expect(rendition.display).toHaveBeenCalledTimes(1);
    expect(renditions.length).toBe(1);
  });

  it('theme switching does not recreate the rendition or lose reading position', async () => {
    await setupComponent();
    const book = books[0];
    const rendition = renditions[0];

    await switchTheme('dark');
    await switchTheme('sepia');

    expect(renditions.length).toBe(1);
    expect(book.destroy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.getCurrentLocation()).toBe('epubcfi(/6/4)');
  });

  it('a chapter rendered after the switch inherits the selected theme', async () => {
    await setupComponent();
    await switchTheme('sepia');

    // Simulate a new section: epub.js fires every registered content hook
    // with the new contents document.
    const contents = makeContents();
    contentHooks.forEach((hook) => hook(contents));

    expect(contents.document.body.classList.contains('nostos-sepia')).toBe(true);
    const themeStyle = contents.document.getElementById('epubjs-inserted-css-nostos-sepia');
    expect(themeStyle).not.toBeNull();
    expect(themeStyle!.textContent).toContain('#faf5e8');
    expect(contents.document.body.classList.contains('nostos-dark')).toBe(false);
  });

  it('annotation and pending-highlight styles stay visible after a theme switch', async () => {
    await setupComponent();
    const destroySpy = vi.spyOn(EpubAnnotationManager.prototype, 'destroy');

    await switchTheme('dark');

    expect(destroySpy).not.toHaveBeenCalled();

    const contents = makeContents();
    contentHooks.forEach((hook) => hook(contents));

    // Theme styles AND annotation styles coexist in the same contents head.
    expect(contents.document.getElementById('epubjs-inserted-css-nostos-dark')).not.toBeNull();
    const annotationStyle = Array.from(contents.document.head.querySelectorAll('style')).find(
      (s) => s.textContent?.includes('.epubjs-hl'),
    );
    expect(annotationStyle).toBeDefined();
    expect(annotationStyle!.textContent).toContain('.epubjs-hl-pending');
  });

  it('reopening the reader keeps no stale rendition or duplicate effects', async () => {
    await setupComponent();
    const firstRendition = renditions[0];

    fixture.destroy();

    // Reopen: a fresh component instance builds a fresh rendition.
    fixture = TestBed.createComponent(EpubReader);
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renditions.length).toBe(2);
    const secondRendition = renditions[1];

    // Exactly two content hooks per rendition (themes inject + component).
    expect(hookRegistrations).toBe(4);

    // Each rendition registered the three themes exactly once.
    expect(firstRendition.themes.registered).toEqual([
      'nostos-light',
      'nostos-dark',
      'nostos-sepia',
    ]);
    expect(secondRendition.themes.registered).toEqual([
      'nostos-light',
      'nostos-dark',
      'nostos-sepia',
    ]);

    // The destroyed instance's effect is gone: a toggle reaches only the new
    // rendition, exactly once per switch.
    const firstSelects = firstRendition.themes.selected.length;
    await switchTheme('sepia');

    expect(firstRendition.themes.selected.length).toBe(firstSelects);
    expect(secondRendition.themes.selected[secondRendition.themes.selected.length - 1]).toBe(
      'nostos-sepia',
    );
  });
});
