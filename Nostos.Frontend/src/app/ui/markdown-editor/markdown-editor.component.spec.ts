import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownEditorComponent } from './markdown-editor.component';

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

  function installTinyMceMock() {
    initCalls = [];
    removedEditors = [];
    editors = [];
    wordCountValue = 42;

    (globalThis as Record<string, unknown>)['tinymce'] = {
      init: (config: InitConfig) => {
        initCalls.push(config);
        let content = '';
        const listeners = new Map<string, (...args: unknown[]) => void>();
        const fire = (event: string) => listeners.get(event)?.();
        const editor: EditorMock = {
          on: (event, cb) => {
            for (const e of event.split(/\s+/)) listeners.set(e, cb);
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

  function fireEditorEvent(event: string) {
    // The mock's on() keys listeners per individual event name; reaching the
    // editor instance through the mock closure is enough for our assertions.
    const editor = editors[editors.length - 1];
    (editor as unknown as { _fire: (e: string) => void })._fire?.(event);
  }

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

  it('ships the expert content stylesheet: warm ink on white paper, theme-independent', () => {
    const style = String(initCalls[0].content_style);
    expect(style).toContain('--paper: #ffffff');
    expect(style).toContain('--ink: #292622');
    expect(style).toContain('font-family: Newsreader, Georgia');
    // The old generic dark-mode-coupled palette must be gone.
    expect(style).not.toContain('--color-text-main');
    expect(style).not.toContain('#1a1a1a');
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
});
