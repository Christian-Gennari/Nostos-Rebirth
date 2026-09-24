import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownEditorComponent, caretScrollDelta } from './markdown-editor.component';

/**
 * TinyMCE is a heavy global; these specs stub it and assert the FINAL chrome
 * contract (expert design §1/§6): constant 'oxide' skin, exact toolbar and
 * plugin set, no menubar/statusbar, wordcount-plugin emissions, and a single
 * editor instance per component lifecycle (no reinitialization).
 */

interface EditorMock {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  getContent: () => string;
  setContent: (html: string) => void;
  getBody: () => { style: Record<string, string> };
  plugins: { wordcount: { body: { getWordCount: () => number } } };
}

interface InitConfig {
  skin?: string;
  setup?: (editor: EditorMock) => void;
  plugins?: unknown;
  menubar?: unknown;
  statusbar?: unknown;
  branding?: unknown;
  promotion?: unknown;
  resize?: unknown;
  toolbar?: unknown;
  toolbar_mode?: unknown;
  toolbar_sticky?: unknown;
  quickbars_selection_toolbar?: unknown;
  quickbars_insert_toolbar?: unknown;
  contextmenu?: unknown;
  browser_spellcheck?: unknown;
  height?: unknown;
  suffix?: unknown;
  content_style?: unknown;
}

describe('MarkdownEditorComponent', () => {
  let fixture: ComponentFixture<MarkdownEditorComponent>;
  let initCalls: InitConfig[];
  let removedEditors: unknown[];
  let editors: EditorMock[];
  let emitted: string[];
  let wordCountEmissions: number[];
  let wordCountValue: number;
  let registeredEditorEvents: string[];

  function installTinyMceMock() {
    initCalls = [];
    removedEditors = [];
    editors = [];
    wordCountValue = 42;
    registeredEditorEvents = [];

    (globalThis as Record<string, unknown>)['tinymce'] = {
      init: (config: InitConfig) => {
        initCalls.push(config);
        let content = '';
        const listeners = new Map<string, (...args: unknown[]) => void>();
        const fire = (event: string) => listeners.get(event)?.();
        const editor: EditorMock = {
          on: (event, cb) => {
            for (const e of event.split(/\s+/)) {
              registeredEditorEvents.push(e);
              listeners.set(e, cb);
            }
          },
          getContent: () => content,
          setContent: (html) => {
            content = html;
            fire('SetContent');
          },
          getBody: () => ({ style: {} }),
          plugins: { wordcount: { body: { getWordCount: () => wordCountValue } } },
        };
        editors.push(editor);
        config.setup?.(editor);
        // Real TinyMCE fires 'init' asynchronously after setup.
        queueMicrotask(() => fire('init'));
        return Promise.resolve(editor);
      },
      remove: (editor: unknown) => removedEditors.push(editor),
    };
  }

  /** All component CSS injected by Angular (emulated encapsulation). */
  const componentCss = (): string =>
    Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');

  beforeEach(async () => {
    localStorage.clear();
    installTinyMceMock();

    await TestBed.configureTestingModule({
      imports: [MarkdownEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownEditorComponent);
    fixture.componentRef.setInput('initialContent', '# Title');
    emitted = [];
    wordCountEmissions = [];
    fixture.componentInstance.contentChange.subscribe((md) => emitted.push(md));
    fixture.componentInstance.wordCountChange.subscribe((n) => wordCountEmissions.push(n));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('initializes once with the constant oxide skin', () => {
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].skin).toBe('oxide');
  });

  it('applies the iframe theme at PreInit and themes transient loading surfaces', () => {
    expect(registeredEditorEvents).toContain('PreInit');

    const css = componentCss();
    expect(css).toContain(':host > textarea');
    expect(css).toContain('background: var(--editor-ui-bg, var(--bg-surface))');
    expect(css).toContain('.tox .tox-throbber');
  });

  it('uses the final chrome config: plugins, toolbar, quickbars, no menubar/statusbar', () => {
    const cfg = initCalls[0];

    expect(cfg.plugins).toBe('lists link image table wordcount searchreplace quickbars');
    expect(cfg.menubar).toBe(false);
    expect(cfg.statusbar).toBe(false);
    expect(cfg.branding).toBe(false);
    expect(cfg.promotion).toBe(false);
    expect(cfg.resize).toBe(false);
    expect(cfg.toolbar).toBe(
      'undo redo | blocks | bold italic underline | bullist numlist | link image | removeformat'
    );
    expect(cfg.toolbar_mode).toBe('sliding');
    expect(cfg.toolbar_sticky).toBe(false);
    expect(cfg.quickbars_selection_toolbar).toBe('bold italic | h2 h3 blockquote | link');
    expect(cfg.quickbars_insert_toolbar).toBe(false);
    expect(cfg.contextmenu).toBe(false);
    expect(cfg.browser_spellcheck).toBe(true);
    expect(cfg.height).toBe('100%');
    expect(cfg.suffix).toBe('.min');
    // Autoresize and the removed chrome plugins must be gone.
    expect(String(cfg.plugins)).not.toContain('autoresize');
    expect(String(cfg.plugins)).not.toContain('code');
    expect(String(cfg.plugins)).not.toContain('help');
    expect(String(cfg.plugins)).not.toContain('visualblocks');
    expect(String(cfg.plugins)).not.toContain('directionality');
  });

  it('ships the expert content stylesheet: cool ink on white paper, theme-independent', () => {
    const style = String(initCalls[0].content_style);
    expect(style).toContain('--paper: #ffffff');
    expect(style).toContain('--ink: #121316');
    expect(style).toContain("data-theme='dark'");
    expect(style).toContain('font-family: Newsreader, Georgia');
    // The old generic dark-mode-coupled palette must be gone.
    expect(style).not.toContain('--color-text-main');
    expect(style).not.toContain('#1a1a1a');
  });

  it('keeps blockquotes flat and editorial instead of fading into the page', () => {
    const style = String(initCalls[0].content_style);
    const start = style.indexOf('blockquote {');
    expect(start).toBeGreaterThanOrEqual(0);
    const quoteBlock = style.slice(start, style.indexOf('}', start));

    expect(quoteBlock).toContain('background: transparent');
    expect(quoteBlock).toContain('border-left: 2px solid var(--quote-rule)');
    expect(quoteBlock).not.toContain('linear-gradient');
  });

  it('rides the prose roles on tokens, so the sheet cannot drift from the theme', () => {
    // Regression: `strong`, `th` and the link underline each carried a LITERAL
    // light value, so the dark sheet painted bold text near-black (1.13:1
    // against the paper), a near-white table-header band with muted ink on it
    // (1.61:1), and a cool-slate underline. Roles belong in both theme blocks.
    const style = String(initCalls[0].content_style);

    const darkStart = style.indexOf(":root[data-theme='dark']");
    const lightBlock = style.slice(style.indexOf(':root {'), darkStart);
    const darkBlock = style.slice(darkStart);

    const roles: Array<[RegExp, string]> = [
      [/strong\s*\{[^}]*color:\s*var\(--ink-strong\)/, '--ink-strong'],
      [/th\s*\{[^}]*background:\s*var\(--table-head-bg\)/, '--table-head-bg'],
      [/a\s*\{[^}]*text-decoration-color:\s*var\(--link-rule\)/, '--link-rule'],
    ];

    for (const [usage, token] of roles) {
      expect(style).toMatch(usage);
      expect(lightBlock).toContain(`${token}:`);
      expect(darkBlock).toContain(`${token}:`);
    }
  });

  it('emits the wordcount-plugin count on init and on content events', async () => {
    // Init (+ any SetContent from document switching) must have emitted.
    expect(wordCountEmissions.length).toBeGreaterThanOrEqual(1);
    expect(wordCountEmissions[wordCountEmissions.length - 1]).toBe(wordCountValue);

    wordCountValue = 7;
    const before = wordCountEmissions.length;
    editors[editors.length - 1].setContent('<p>changed</p>');
    await fixture.whenStable();
    expect(wordCountEmissions.length).toBe(before + 1);
    expect(wordCountEmissions[wordCountEmissions.length - 1]).toBe(7);
  });

  it('tears the editor down exactly once on component destroy', () => {
    fixture.destroy();
    expect(removedEditors).toHaveLength(1);
    expect(removedEditors[0]).toBe(editors[0]);
  });

  it('kills Oxide focus rings, including the ::before pseudo-element ring', () => {
    // Regression: Oxide paints the blue focus rectangle on
    // .tox .tox-edit-area::before (2px solid #006ce7, opacity raised by
    // .tox.tox-edit-focus). Resetting border/outline on .tox-edit-area and the
    // iframe left the pseudo-element untouched, so the blue border stayed
    // visible whenever the editor had focus.
    const css = componentCss();

    expect(css).toContain('.tox .tox-edit-area::before');
    const ring = css.slice(css.indexOf('.tox .tox-edit-area::before'));
    expect(ring).toContain('opacity: 0 !important');
    // The reset must target the pseudo-element, not merely the element.
    expect(css).toContain('.tox .tox-edit-area__iframe');
  });
});

describe('caretScrollDelta (typewriter geometry)', () => {
  it('returns null inside the deadband', () => {
    expect(caretScrollDelta(450, 1000)).toBeNull(); // exactly centered
    expect(caretScrollDelta(500, 1000)).toBeNull(); // 50px drift
    expect(caretScrollDelta(400, 1000)).toBeNull();
  });

  it('scrolls far carets to 45% of the viewport', () => {
    expect(caretScrollDelta(900, 1000)).toBe(450);
    expect(caretScrollDelta(100, 1000)).toBe(-350);
  });

  it('returns null for invalid viewports', () => {
    expect(caretScrollDelta(100, 0)).toBeNull();
    expect(caretScrollDelta(NaN, 1000)).toBeNull();
  });
});

describe('MarkdownEditorComponent typewriter follow', () => {
  let fixture: ComponentFixture<MarkdownEditorComponent>;
  let editors: any[];

  beforeEach(async () => {
    localStorage.clear();
    (globalThis as Record<string, unknown>)['tinymce'] = {
      init: (config: { setup?: (editor: EditorMock) => void }) => {
        const editor: EditorMock = {
          on: () => {},
          getContent: () => '',
          setContent: () => {},
          getBody: () => ({ style: {} }),
          plugins: { wordcount: { body: { getWordCount: () => 0 } } },
        };
        editors.push(editor);
        config.setup?.(editor);
        return Promise.resolve(editor);
      },
      remove: () => {},
    };
    editors = [];

    await TestBed.configureTestingModule({
      imports: [MarkdownEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownEditorComponent);
    fixture.componentRef.setInput('initialContent', 'hello');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function withCaret(rectTop: number, viewportHeight: number) {
    const scrolled: number[] = [];
    const editor = editors[editors.length - 1] as Record<string, unknown>;
    editor['selection'] = { getRng: () => ({ getBoundingClientRect: () => ({ top: rectTop, height: 20 }) }) };
    editor['getWin'] = () => ({ innerHeight: viewportHeight, scrollBy: (_x: number, y: number) => scrolled.push(y) });
    return { editor, scrolled };
  }

  it('does nothing while typewriter mode is off', () => {
    const { editor, scrolled } = withCaret(900, 1000);
    fixture.componentInstance.followCaret(editor);
    expect(scrolled).toEqual([]);
  });

  it('scrolls the caret line toward the viewport center when on', () => {
    fixture.componentRef.setInput('typewriter', true);
    const { editor, scrolled } = withCaret(900, 1000);
    fixture.componentInstance.followCaret(editor);
    expect(scrolled).toEqual([450]);
  });

  it('never throws on editors without a selection API', () => {
    fixture.componentRef.setInput('typewriter', true);
    expect(() => fixture.componentInstance.followCaret(editors[editors.length - 1])).not.toThrow();
  });
});
