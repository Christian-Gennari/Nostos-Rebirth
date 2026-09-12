import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output, Input } from '@angular/core';
import { of } from 'rxjs';

import { WritingStudio } from './writing-studio.component';
import { WritingsService } from '../core/services/writings.service';
import { ToastService } from '../core/services/toast.service';
import { ConceptsService } from '../core/services/concepts.service';
import { BooksService } from '../core/services/books.service';
import { NotesService } from '../core/services/notes.service';
import { FlatTreeComponent } from '../ui/flat-tree/flat-tree.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { MarkdownEditorComponent } from '../ui/markdown-editor/markdown-editor.component';
import { WritingContentDto } from '../core/dtos/writing.dtos';

// Heavy editor / UI children are stubbed out: MarkdownEditor boots TinyMCE
// (not available under vitest), and the tree/note cards pull in drag-drop and
// unrelated pipes. Same pattern as reader-shell.component.spec.ts.
@Component({ selector: 'app-markdown-editor', standalone: true, template: '' })
class MarkdownEditorStub {
  readonly initialContent = input<string>('');
  readonly contentChange = output<string>();
  readonly wordCountChange = output<number>();
}

@Component({ selector: 'app-flat-tree', standalone: true, template: '' })
class FlatTreeStub {
  readonly items = input.required<unknown[]>();
  readonly activeId = input<string | null>(null);
  readonly editingId = input<string | null>(null);
  readonly nodeSelected = output<unknown>();
  readonly nodeMoved = output<unknown>();
  readonly nodeRenamed = output<unknown>();
  readonly nodeDeleted = output<string>();
  readonly nodeRenameSaved = output<unknown>();
  readonly nodeRenameCancelled = output<void>();
}

@Component({ selector: 'app-note-card', standalone: true, template: '' })
class NoteCardStub {
  @Input() note: unknown;
  @Input() conceptMap: Map<string, unknown> = new Map();
  @Input() showActions = true;
  @Input() showSource = false;
  @Input() showDate = true;
}

describe('WritingStudio zen mode (issue #49) + paper frame (expert design §2/§5)', () => {
  let fixture: ComponentFixture<WritingStudio>;
  let component: WritingStudio;

  const sampleDocument: WritingContentDto = {
    id: 'doc-1',
    name: 'Sample',
    content: 'one two three four',
    updatedAt: '2026-08-13T00:00:00Z',
  };

  /** All component CSS injected by Angular (emulated encapsulation). */
  const componentCss = (): string =>
    Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');

  beforeEach(async () => {
    TestBed.overrideComponent(WritingStudio, {
      remove: { imports: [FlatTreeComponent, NoteCardComponent, MarkdownEditorComponent] },
      add: { imports: [FlatTreeStub, NoteCardStub, MarkdownEditorStub] },
    });

    await TestBed.configureTestingModule({
      imports: [WritingStudio],
      providers: [
        {
          provide: WritingsService,
          useValue: {
            list: vi.fn(() => of([])),
            get: vi.fn(() => of(sampleDocument)),
            create: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            delete: vi.fn(() => of({})),
            move: vi.fn(() => of({})),
          },
        },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: ConceptsService, useValue: { list: vi.fn(() => of([])), get: vi.fn() } },
        { provide: BooksService, useValue: { list: vi.fn(() => of({ items: [] })) } },
        { provide: NotesService, useValue: { list: vi.fn(() => of([])) } },
      ],
    }).compileComponents();

    // Clean slate in case a previous test left the body class behind.
    document.body.classList.remove('nostos-zen');
    document.documentElement.removeAttribute('data-theme');

    fixture = TestBed.createComponent(WritingStudio);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.classList.remove('nostos-zen');
  });

  const zenToggle = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('.zen-toggle') as HTMLButtonElement | null;

  const zenExit = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('.zen-exit') as HTMLButtonElement | null;

  const statusPill = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.editor-status-pill') as HTMLElement | null;

  const openDocument = () => {
    component.activeItem.set(sampleDocument);
    component.editorTitle.set(sampleDocument.name);
    component.editorText.set(sampleDocument.content);
    fixture.detectChanges();
  };

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // --- Placement: no status pill or zen control without an active document ---
  it('shows no zen control and no status pill without an active document', () => {
    expect(zenToggle()).toBeNull();
    expect(zenExit()).toBeNull();
    expect(statusPill()).toBeNull();
  });

  it('shows the zen toggle in the document-action cluster with an active document', () => {
    openDocument();

    const button = zenToggle();
    expect(button).toBeTruthy();

    const header = fixture.nativeElement.querySelector('.editor-header') as HTMLElement;
    const actions = fixture.nativeElement.querySelector('.doc-actions') as HTMLElement;
    expect(header).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(header.contains(button)).toBe(true);
    expect(actions.contains(button)).toBe(true);
  });

  // --- Placement: the status pill floats on the stage, not in the header ---
  it('renders save state and word count in the floating status pill with an active document', () => {
    openDocument();
    component.editorText.set('one two three four');

    const pill = statusPill();
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain('4 words');
    expect(pill!.querySelector('.pill-saved')?.textContent?.trim()).toBe('Saved');
  });

  it('uses the singular word form in the status pill for a single word', () => {
    openDocument();
    component.editorText.set('one');
    fixture.detectChanges();

    expect(statusPill()?.textContent).toContain('1 word');
  });

  it('prefers the editor wordcount-plugin count in the status pill when emitted', () => {
    openDocument();
    component.editorWordCount.set(123);
    fixture.detectChanges();

    expect(statusPill()?.textContent).toContain('123 words');
  });

  it('has no status badge inside the document-action header', () => {
    openDocument();
    const header = fixture.nativeElement.querySelector('.editor-header') as HTMLElement;
    expect(header.querySelector('.pill-saved')).toBeNull();
  });

  // --- Enter/exit manages body.nostos-zen ---
  it('entering zen sets component state and adds the body class', () => {
    component.enterZen();

    expect(component.isZen()).toBe(true);
    expect(document.body.classList.contains('nostos-zen')).toBe(true);
  });

  it('toggling the zen button enters zen and the fixed Exit-zen control exits it', () => {
    openDocument();

    const button = zenToggle()!;
    button.click();
    fixture.detectChanges();
    expect(component.isZen()).toBe(true);
    expect(document.body.classList.contains('nostos-zen')).toBe(true);

    const exit = zenExit();
    expect(exit).toBeTruthy();
    exit!.click();
    fixture.detectChanges();
    expect(component.isZen()).toBe(false);
    expect(document.body.classList.contains('nostos-zen')).toBe(false);
  });

  it('renders the fixed Exit-zen control only while zen is active', () => {
    openDocument();
    expect(zenExit()).toBeNull();

    component.enterZen();
    fixture.detectChanges();
    expect(zenExit()).toBeTruthy();

    component.exitZen();
    fixture.detectChanges();
    expect(zenExit()).toBeNull();
  });

  it('Esc exits zen and removes the body class', () => {
    component.enterZen();
    expect(document.body.classList.contains('nostos-zen')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.isZen()).toBe(false);
    expect(document.body.classList.contains('nostos-zen')).toBe(false);
  });

  it('Esc outside zen is ignored', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.isZen()).toBe(false);
    expect(document.body.classList.contains('nostos-zen')).toBe(false);
  });

  it('entering zen twice is idempotent', () => {
    component.enterZen();
    component.enterZen();
    expect(component.isZen()).toBe(true);
    expect(document.body.classList.contains('nostos-zen')).toBe(true);

    component.exitZen();
    expect(document.body.classList.contains('nostos-zen')).toBe(false);
  });

  // --- Exit restores focus ---
  it('restores focus to the element that opened zen after exit', () => {
    openDocument();

    const button = zenToggle()!;
    button.focus();
    button.click();
    expect(document.body.classList.contains('nostos-zen')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.isZen()).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('restores focus to the zen toggle when the original element is gone', () => {
    openDocument();

    const button = zenToggle()!;
    const dummy = document.createElement('button');
    document.body.appendChild(dummy);
    dummy.focus();

    component.enterZen();
    dummy.remove();
    component.exitZen();

    expect(document.activeElement).toBe(button);
  });

  // --- Destruction always removes the body class ---
  it('does not leak zen state or listeners after destroy', () => {
    component.enterZen();
    expect(document.body.classList.contains('nostos-zen')).toBe(true);

    const removeSpy = vi.spyOn(window, 'removeEventListener');
    fixture.destroy();

    expect(removeSpy).toHaveBeenCalledWith('keydown', (component as any).onKeyDown);
    expect(document.body.classList.contains('nostos-zen')).toBe(false);
  });

  // --- Computed zen grid has one track ---
  it('collapses the studio grid to a single 1fr track in zen', () => {
    const layout = fixture.nativeElement.querySelector('.studio-layout') as HTMLElement;

    component.enterZen();
    fixture.detectChanges();

    const cols = getComputedStyle(layout).gridTemplateColumns;
    expect(cols).toBe('1fr');
  });

  // --- Sidebars, dock, menus, formatting toolbar hidden in zen ---
  it('hides the document header/action strip in zen and fades the status pill', () => {
    openDocument();
    const header = fixture.nativeElement.querySelector('.editor-header') as HTMLElement;
    const pill = statusPill()!;

    component.enterZen();
    fixture.detectChanges();

    expect(getComputedStyle(header).display).toBe('none');
    // The pill belongs to the stage; zen makes it invisible (expert §5).
    expect(getComputedStyle(pill).opacity).toBe('0');
  });

  it('hides both sidebars in zen', () => {
    const left = fixture.nativeElement.querySelector('.sidebar-left') as HTMLElement;
    const right = fixture.nativeElement.querySelector('.sidebar-right') as HTMLElement;

    component.enterZen();
    fixture.detectChanges();

    expect(getComputedStyle(left).display).toBe('none');
    expect(getComputedStyle(right).display).toBe('none');
  });

  it('caps the writing surface at 860px and centers it in zen', () => {
    openDocument();
    const editor = fixture.nativeElement.querySelector('app-markdown-editor') as HTMLElement;
    const wrapper = fixture.nativeElement.querySelector('.editor-wrapper') as HTMLElement;

    component.enterZen();
    fixture.detectChanges();

    expect(getComputedStyle(editor).maxWidth).toBe('860px');
    expect(getComputedStyle(wrapper).alignItems).toBe('center');
  });

  // --- Exactly one scroll container remains ---
  it('keeps the editor wrapper overflow-visible in zen so the paper shadow is never clipped; pane and layout stay hidden', () => {
    openDocument();
    const wrapper = fixture.nativeElement.querySelector('.editor-wrapper') as HTMLElement;
    const pane = fixture.nativeElement.querySelector('.editor-pane') as HTMLElement;
    const layout = fixture.nativeElement.querySelector('.studio-layout') as HTMLElement;

    component.enterZen();
    fixture.detectChanges();

    expect(getComputedStyle(wrapper).overflow).toBe('visible');
    expect(getComputedStyle(pane).overflow === 'hidden' || getComputedStyle(pane).overflowY === 'hidden').toBe(true);
    expect(getComputedStyle(layout).overflow === 'hidden' || getComputedStyle(layout).overflowY === 'hidden').toBe(true);
  });

  // --- Scroll position survives enter/exit ---
  it('does not recreate the editor surface across enter/exit (same scroll owner)', () => {
    openDocument();
    const editor = fixture.nativeElement.querySelector('app-markdown-editor') as HTMLElement;

    component.enterZen();
    fixture.detectChanges();
    component.exitZen();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-markdown-editor')).toBe(editor);
    expect(component.editorText()).toBe(sampleDocument.content);
  });

  it('computes the word count from the editor content', () => {
    component.editorText.set('one two three four');
    expect(component.wordCount()).toBe(4);

    component.editorText.set('  spaced   out \n\n words ');
    expect(component.wordCount()).toBe(3);

    component.editorText.set('');
    expect(component.wordCount()).toBe(0);
  });

  // --- Paper frame (expert design §2): CSS-level contract ---
  it('declares the fixed paper frame: 740px sheet, 10px radius, tokenised shadow on the editor host', () => {
    const css = componentCss();

    expect(css).toContain('width: min(100%, 740px)');
    expect(css).toContain('border-radius: 10px');
    // The sheet's white ground is deliberate in BOTH themes: it is the paper,
    // and its content CSS is a fixed light document.
    expect(css).toContain('background: #ffffff');
    // The frame's shadow must stay on the HOST so it never moves while the
    // iframe scrolls. It comes from the shadow tokens (not the warm-ink
    // literals it used before), so the frame follows the theme while the sheet
    // does not: on the dark ground a warm shadow read as a dirty halo.
    expect(css).toContain('box-shadow: var(--shadow-glass), var(--shadow-glass-lg)');
    expect(css).toContain('border: 1px solid var(--border-color)');
    // Guard against the old hardcoded warm-ink values coming back.
    expect(css).not.toContain('rgba(30, 26, 21');
    expect(css).not.toContain('rgba(80, 70, 140');
  });

  it('lets .tox-tinymce fill and clip to the paper frame without its own shadow', () => {
    const css = componentCss();

    expect(css).toContain('border-radius: inherit !important');
    expect(css).toContain('overflow: hidden !important');
    expect(css).toContain('box-shadow: none !important');
    expect(css).toContain('height: 100% !important');
  });

  it('gives the stage safe padding: dock clearance reserves room for the floating dock', () => {
    const css = componentCss();

    expect(css).toContain('--studio-dock-clearance: 122px');
    expect(css).toContain('overflow: visible');
  });

  it('declares the zen sheet wider (860px) WITHOUT removing the paper shadow', () => {
    const css = componentCss();

    expect(css).toContain('max-width: 860px');
    // Zen must keep the physical paper: no shadow/radius reset in the zen block.
    const zenBlock = css.slice(css.indexOf('max-width: 860px'));
    const zenRule = zenBlock.slice(0, zenBlock.indexOf('}'));
    expect(zenRule).not.toContain('box-shadow');
    expect(zenRule).not.toContain('border-radius');
  });

  it('declares mobile edge-to-edge (<=700px): gutters zeroed, radius and shadow removed', () => {
    const css = componentCss();

    const mobileBlock = css.slice(css.indexOf('@media (max-width: 700px)'));
    expect(mobileBlock).toContain('--studio-inline-gutter: 0px');
    expect(mobileBlock).toContain('--studio-top-gutter: 0px');
    expect(mobileBlock).toContain('width: 100%');
    expect(mobileBlock).toContain('border-radius: 0');
    expect(mobileBlock).toContain('box-shadow: none');
    // The tinyMCE surface must follow the edge-to-edge frame.
    expect(mobileBlock).toContain('border-radius: 0 !important');
  });
});
