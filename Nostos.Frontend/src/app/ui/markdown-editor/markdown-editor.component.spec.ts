import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownEditorComponent } from './markdown-editor.component';
import { ThemeService } from '../../core/services/theme.service';

/**
 * TinyMCE is a heavy global; these specs stub it and assert only the
 * theme-driven skin selection behavior (oxide / oxide-dark) plus the
 * content-preserving re-init on theme change.
 */

interface EditorMock {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  getContent: () => string;
  setContent: (html: string) => void;
  getBody: () => { style: Record<string, string> };
}

interface InitConfig {
  skin?: string;
  setup?: (editor: EditorMock) => void;
  [key: string]: unknown;
}

describe('MarkdownEditorComponent', () => {
  let fixture: ComponentFixture<MarkdownEditorComponent>;
  let themeService: ThemeService;
  let initCalls: InitConfig[];
  let removedEditors: unknown[];
  let editors: EditorMock[];
  let emitted: string[];

  function installTinyMceMock() {
    initCalls = [];
    removedEditors = [];
    editors = [];

    (globalThis as Record<string, unknown>)['tinymce'] = {
      init: (config: InitConfig) => {
        initCalls.push(config);
        let content = '';
        const listeners = new Map<string, (...args: unknown[]) => void>();
        const editor: EditorMock = {
          on: (event, cb) => listeners.set(event, cb),
          getContent: () => content,
          setContent: (html) => {
            content = html;
          },
          getBody: () => ({ style: {} }),
        };
        editors.push(editor);
        config.setup?.(editor);
        // Real TinyMCE fires 'init' asynchronously after setup.
        queueMicrotask(() => listeners.get('init')?.());
        return Promise.resolve(editor);
      },
      remove: (editor: unknown) => removedEditors.push(editor),
    };
  }

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    installTinyMceMock();

    await TestBed.configureTestingModule({
      imports: [MarkdownEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownEditorComponent);
    fixture.componentRef.setInput('initialContent', '# Title');
    emitted = [];
    fixture.componentInstance.contentChange.subscribe((md) => emitted.push(md));
    themeService = TestBed.inject(ThemeService);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('initializes with the oxide skin while the global theme is light', () => {
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].skin).toBe('oxide');
  });

  it('re-initializes with the oxide-dark skin when the theme becomes dark, preserving content', async () => {
    themeService.setTheme('dark');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(initCalls).toHaveLength(2);
    expect(initCalls[1].skin).toBe('oxide-dark');
    // Old instance torn down, new instance booted in its place.
    expect(removedEditors).toHaveLength(1);
    // Content captured during teardown was emitted...
    expect(emitted).toContain('# Title');
    // ...and restored into the freshly initialized editor.
    expect(editors[1].getContent()).toBe('<h1>Title</h1>\n');
  });

  it('uses the oxide-dark skin when the global theme is sepia', async () => {
    themeService.setTheme('sepia');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(initCalls).toHaveLength(2);
    expect(initCalls[1].skin).toBe('oxide-dark');
  });

  it('switches back to the oxide skin when the theme returns to light', async () => {
    themeService.setTheme('dark');
    fixture.detectChanges();
    await fixture.whenStable();

    themeService.setTheme('light');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(initCalls).toHaveLength(3);
    expect(initCalls[2].skin).toBe('oxide');
    expect(removedEditors).toHaveLength(2);
  });

  it('boots directly with the oxide-dark skin when the global theme is already dark', () => {
    themeService.setTheme('dark');
    fixture.destroy();
    installTinyMceMock();

    fixture = TestBed.createComponent(MarkdownEditorComponent);
    fixture.componentRef.setInput('initialContent', '# Title');
    fixture.detectChanges();

    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].skin).toBe('oxide-dark');
  });
});
