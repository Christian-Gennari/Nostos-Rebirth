import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import ePub from 'epubjs';

import { NotesService } from '../../core/services/notes.service';
import { BooksService } from '../../core/services/books.service';
import { EpubReader } from './epub-reader.component';
import { EpubAnnotationManager } from './epub-annotation-manager';

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
