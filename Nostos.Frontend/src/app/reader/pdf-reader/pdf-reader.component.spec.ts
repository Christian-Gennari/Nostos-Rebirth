import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component, input, output } from '@angular/core';
import { of } from 'rxjs';

// @ts-expect-error — no @types/node in this repo; vitest resolves node:fs at
// runtime. Used only for static source guards (template/css/ts files).
import { readFileSync } from 'node:fs';

import { PdfReader } from './pdf-reader.component';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { PdfAnnotationManager } from './pdf-annotation-manager';
import { NotesService } from '../../core/services/notes.service';
import { BooksService } from '../../core/services/books.service';

/**
 * Minimal stand-in for the heavy ngx-extended-pdf-viewer component (same
 * pattern as reader-shell.component.spec.ts stubs). It reflects the inputs
 * the template binds so specs can assert what the reader passes down.
 */
@Component({
  selector: 'ngx-extended-pdf-viewer',
  standalone: true,
  template: '',
})
class PdfViewerStub {
  src = input<string>();
  height = input<string>();
  sidebarVisible = input<boolean>(false);
  page = input<number>(1);
  backgroundColor = input<string>();
  pdfBackgroundColor = input<string>();
  scrollMode = input<number>(0);
  showBorders = input<boolean>(true);
  zoom = input<string | number>('page-fit');
  showToolbar = input<boolean>(true);
  textLayer = input<boolean>(false);
  handTool = input<boolean>(false);
  showHighlightEditor = input<boolean>(true);
  showHandToolButton = input<boolean>(true);
  showSidebarButton = input<boolean>(true);
  showFindButton = input<boolean>(true);
  showPagingButtons = input<boolean>(true);
  showZoomButtons = input<boolean>(true);
  showPresentationModeButton = input<boolean>(true);
  showOpenFileButton = input<boolean>(true);
  showPrintButton = input<boolean>(true);
  showDownloadButton = input<boolean>(true);
  showSecondaryToolbarButton = input<boolean>(true);
  showRotateButton = input<boolean>(true);
  showSpreadButton = input<boolean>(true);
  showPropertiesButton = input<boolean>(true);
  showTextEditor = input<boolean>(true);
  showDrawEditor = input<boolean>(true);
  showStampEditor = input<boolean>(true);

  pageChange = output<number>();
  sidebarVisibleChange = output<boolean>();
  pagesLoaded = output<any>();
  pageRender = output<any>();
  pageRendered = output<any>();
  pdfLoaded = output<any>();
  textLayerRendered = output<any>();
  textSelection = output<any>();
}

const readSource = (file: string) =>
  readFileSync(new URL(file, import.meta.url), 'utf-8');

describe('PdfReader fixed light surround and toolbar clearance', () => {
  let fixture: ComponentFixture<PdfReader>;

  const notesService = { list: vi.fn(() => of([])) };
  const booksService = { updateProgress: vi.fn(() => of(null)) };

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [PdfReader],
      providers: [
        { provide: NotesService, useValue: notesService },
        { provide: BooksService, useValue: booksService },
        {
          provide: PdfAnnotationManager,
          useValue: {
            paint: vi.fn(),
            captureHighlight: vi.fn(),
            captureNoteLocation: vi.fn(() => null),
          },
        },
      ],
    })
      .overrideComponent(PdfReader, {
        remove: { imports: [NgxExtendedPdfViewerModule] },
        add: { imports: [PdfViewerStub] },
      })
      .compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function setupComponent() {
    fixture = TestBed.createComponent(PdfReader);
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.detectChanges();
    return fixture;
  }

  function viewerStub() {
    const debugEl = fixture.debugElement.query(By.directive(PdfViewerStub));
    expect(debugEl).not.toBeNull();
    return debugEl!.componentInstance as PdfViewerStub;
  }

  it('binds the fixed #fefeff light surround and keeps the pdfjs background unset', () => {
    const html = readSource('./pdf-reader.component.html');
    // The surround is a fixed rendering invariant; the pdfjs
    // `pdfBackgroundColor` option stays unset so page pixels are untouched.
    expect(html).toContain("[backgroundColor]=\"'#fefeff'\"");
    expect(html).not.toContain('[pdfBackgroundColor]');
  });

  it('renders the viewer with the fixed light surround without reloading the document', () => {
    setupComponent();

    expect(viewerStub().backgroundColor()).toBe('#fefeff');
    expect(viewerStub().src()).toBe('/api/books/book-1/file');

    // A second change-detection pass leaves the document untouched.
    fixture.detectChanges();
    expect(viewerStub().src()).toBe('/api/books/book-1/file');
  });

  it('declares the base light page edge and no theme-variant classes', () => {
    const html = readSource('./pdf-reader.component.html');
    const css = readSource('./pdf-reader.component.css');

    // The theme input and its class bindings are gone.
    expect(html).not.toContain('theme-dark');
    expect(html).not.toContain('theme-sepia');
    // The retained base light page edge stays token-driven.
    expect(css).toContain('--pdf-page-outline');
    expect(css).toContain('outline: var(--pdf-page-outline)');
    expect(css).toContain('box-shadow: var(--pdf-page-shadow)');
    expect(css).not.toContain('theme-dark');
    expect(css).not.toContain('theme-sepia');
  });

  it('hidden-toolbar state uses no negative margin (offset reset at #viewerContainer)', () => {
    const css = readSource('./pdf-reader.component.css');

    expect(css).not.toContain('-34px');
    expect(css).not.toMatch(/margin(?:-top)?\s*:\s*-/);

    // The hidden internal toolbar offset is reset at the scrollport instead.
    expect(css).toContain('#mainContainer.toolbar-hidden');
    expect(css).toContain('margin-top: 0 !important');
    expect(css).toContain('#mainContainer.toolbar-hidden #viewerContainer');
    expect(css).toContain('top: 0 !important');
  });

  it('keeps the PDF scrollport above the shell toolbar with bottom scroll padding', () => {
    const css = readSource('./pdf-reader.component.css');

    // The scrollport must not end flush with the shell toolbar: bottom
    // padding sized to the toolbar height guarantees the final page clears it.
    const viewerContainerRule = css.slice(css.indexOf('#viewerContainer'));
    expect(viewerContainerRule).toContain('padding-bottom');
    expect(viewerContainerRule).toContain('var(--toolbar-height');
  });

  it('adds safe-area inset so mobile final-page content clears toolbar + safe area', () => {
    const css = readSource('./pdf-reader.component.css');

    expect(css).toContain('env(safe-area-inset-bottom, 0px)');
    const viewerContainerRule = css.slice(css.indexOf('#viewerContainer'));
    expect(viewerContainerRule).toContain(
      'calc(var(--toolbar-height, 60px) + env(safe-area-inset-bottom, 0px))',
    );
  });
});

/**
 * The contents rail was empty for EVERY PDF: the library's `PdfLoadedEvent` is
 * `{ pagesCount }` and nothing else, so the old handler's `if (pdfDoc)` guard
 * never held and the outline was never fetched. A 512-page book with 129
 * embedded bookmarks rendered "No Table of Contents available." (issue #226 §1).
 * These specs pin the document reference to the event that carries it.
 */
describe('PdfReader contents rail from the embedded outline', () => {
  let fixture: ComponentFixture<PdfReader>;

  const pageRef = (num: number) => ({ num, gen: 0 });
  const dest = (num: number) => [pageRef(num), { name: 'Fit' }];

  const outline = [
    { title: 'Introduction', dest: dest(10), items: [] },
    {
      title: 'Part One',
      dest: 'part-one',
      items: [{ title: 'Chapter 1', dest: dest(20), items: [] }],
    },
  ];

  const makePdfDoc = (over: Record<string, unknown> = {}) => ({
    getOutline: vi.fn(async () => outline),
    getDestination: vi.fn(async () => dest(20)),
    getPageIndex: vi.fn(async (ref: { num: number }) => ref.num - 1),
    ...over,
  });

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PdfReader],
      providers: [
        { provide: NotesService, useValue: { list: vi.fn(() => of([])) } },
        { provide: BooksService, useValue: { updateProgress: vi.fn(() => of(null)) } },
        {
          provide: PdfAnnotationManager,
          useValue: { paint: vi.fn(), captureHighlight: vi.fn(), captureNoteLocation: vi.fn(() => null) },
        },
      ],
    })
      .overrideComponent(PdfReader, {
        remove: { imports: [NgxExtendedPdfViewerModule] },
        add: { imports: [PdfViewerStub] },
      })
      .compileComponents();
  });

  function setupComponent() {
    fixture = TestBed.createComponent(PdfReader);
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.detectChanges();
    return fixture;
  }

  /** The outline load is fired from the event handler, so let its microtasks run. */
  const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('maps the outline carried by pagesLoaded into the contents rail', async () => {
    setupComponent();
    const pdfDoc = makePdfDoc();

    await fixture.componentInstance.onPagesLoaded({
      pagesCount: 512,
      source: { pdfDocument: pdfDoc },
    } as never);
    await flushAsync();

    const toc = fixture.componentInstance.toc();
    expect(toc).toHaveLength(2);
    expect(toc[0]).toMatchObject({ label: 'Introduction', target: 10 });
    // A named destination resolves through getDestination -> getPageIndex.
    expect(toc[1].label).toBe('Part One');
    expect(toc[1].target).toBe(20);
    expect(toc[1].children?.[0]).toMatchObject({ label: 'Chapter 1', target: 20 });
  });

  it('leaves the rail empty for a PDF with no outline, without erroring', async () => {
    setupComponent();
    const pdfDoc = makePdfDoc({ getOutline: vi.fn(async () => null) });

    await fixture.componentInstance.onPagesLoaded({
      pagesCount: 12,
      source: { pdfDocument: pdfDoc },
    } as never);
    await flushAsync();

    expect(fixture.componentInstance.toc()).toEqual([]);
  });

  it('survives a failing getOutline instead of throwing out of the event handler', async () => {
    setupComponent();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pdfDoc = makePdfDoc({
      getOutline: vi.fn(async () => {
        throw new Error('outline unreadable');
      }),
    });

    await fixture.componentInstance.onPagesLoaded({
      pagesCount: 40,
      source: { pdfDocument: pdfDoc },
    } as never);
    await flushAsync();

    expect(fixture.componentInstance.toc()).toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  it('pins the root cause: the library event that carries a document is pagesLoaded', () => {
    // Read the installed library's own interface. If `pdfLoaded` ever grows a
    // document, this fails and the `pagesLoaded.source` path can be revisited
    // deliberately rather than by accident.
    const dts = readFileSync(
      // Path relative to the frontend root (the test runner's cwd): resolving it
      // against import.meta.url crosses out of the source tree, where vitest
      // hands back a non-file URL.
      'node_modules/ngx-extended-pdf-viewer/lib/events/pdf-loaded-event.d.ts',
      'utf-8',
    );
    expect(dts).toContain('pagesCount');
    expect(dts).not.toContain('pdfDocument');
  });
});
