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
import { Theme } from '../../core/services/theme.service';

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

describe('PdfReader theme propagation and toolbar clearance', () => {
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

  function setupComponent(theme: Theme = 'light') {
    fixture = TestBed.createComponent(PdfReader);
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.componentRef.setInput('theme', theme);
    fixture.detectChanges();
    return fixture;
  }

  function viewerStub() {
    const debugEl = fixture.debugElement.query(By.directive(PdfViewerStub));
    expect(debugEl).not.toBeNull();
    return debugEl!.componentInstance as PdfViewerStub;
  }

  it('has no hard-coded #fefeff in the template (surround is computed)', () => {
    const html = readSource('./pdf-reader.component.html');
    // The old literal binding is gone and the pdfjs `pdfBackgroundColor`
    // option stays unset (only the `backgroundColor` surround is bound).
    expect(html).not.toContain("'#fefeff'");
    expect(html).not.toContain('[pdfBackgroundColor]');
    expect(html).toContain('[backgroundColor]="pdfBackgroundColor()"');
  });

  it('viewer background responds to the theme input without reloading the document', () => {
    setupComponent();

    expect(viewerStub().backgroundColor()).toBe('#fefeff');
    expect(viewerStub().src()).toBe('/api/books/book-1/file');

    fixture.componentRef.setInput('theme', 'dark');
    fixture.detectChanges();
    expect(viewerStub().backgroundColor()).toBe('#161a21');
    expect(viewerStub().src()).toBe('/api/books/book-1/file');

    fixture.componentRef.setInput('theme', 'sepia');
    fixture.detectChanges();
    expect(viewerStub().backgroundColor()).toBe('#faf5e8');
    expect(viewerStub().src()).toBe('/api/books/book-1/file');

    // Still the same document — the src never changed, so no reload.
    expect(viewerStub().src()).toBe('/api/books/book-1/file');
  });

  it('binds page-edge classes to the theme input (never the global document theme)', () => {
    setupComponent('dark');
    const container = fixture.debugElement.query(By.css('.pdf-container'));
    expect(container.classes['theme-dark']).toBe(true);
    expect(container.classes['theme-sepia']).toBeUndefined();

    fixture.componentRef.setInput('theme', 'sepia');
    fixture.detectChanges();
    expect(container.classes['theme-sepia']).toBe(true);
    expect(container.classes['theme-dark']).toBeUndefined();

    fixture.componentRef.setInput('theme', 'light');
    fixture.detectChanges();
    expect(container.classes['theme-dark']).toBeUndefined();
    expect(container.classes['theme-sepia']).toBeUndefined();
  });

  it('has no ThemeService or global-theme coupling in the implementation', () => {
    const sources = [
      readSource('./pdf-reader.component.html'),
      readSource('./pdf-reader.component.css'),
      readSource('./pdf-reader.component.ts'),
    ].join('\n');

    expect(sources).not.toContain('ThemeService');
    expect(sources).not.toContain('themeService');
    expect(sources).not.toContain('setTheme');
    expect(sources).not.toContain('documentElement');
    expect(sources).not.toContain('nostos.theme');
    expect(sources).not.toContain('invert(');
    expect(sources).not.toContain('hue-rotate(');
    expect(sources).not.toMatch(/filter\s*:/);
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

  it('defines theme-specific page borders/shadows keyed on the input-driven classes', () => {
    const css = readSource('./pdf-reader.component.css');

    // The page keeps its authored pixels; only its edge is themed — scoped by
    // the reader-shell theme input classes, never :host-context on the
    // global document theme.
    expect(css).not.toContain(':host-context([data-theme');
    expect(css).toContain('.pdf-container.theme-dark');
    expect(css).toContain('.pdf-container.theme-sepia');
    expect(css).toContain('--pdf-page-outline');
    expect(css).toContain('outline: var(--pdf-page-outline)');
    expect(css).toContain('box-shadow: var(--pdf-page-shadow)');
  });
});
