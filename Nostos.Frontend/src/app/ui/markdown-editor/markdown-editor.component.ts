import { Component, input, output, effect, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import TurndownService from 'turndown';
import { marked } from 'marked';

// Import TinyMCE as a global type reference
declare var tinymce: any;

/**
 * Editor content page — warm ink on a white paper sheet, theme-independent.
 * The paper intentionally does NOT follow the app theme: dark/sepia modes
 * describe the room around the manuscript, never the manuscript itself.
 * (Expert design §4 — keep verbatim.)
 */
const NOSTOS_EDITOR_CONTENT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap');

  :root {
    color-scheme: light;

    --paper: #ffffff;
    --ink: #292622;
    --ink-soft: #5f5952;
    --ink-faint: #817a72;

    --rule: #e7e2dc;
    --rule-strong: #d8d1c8;

    --link: #526d87;
    --link-hover: #394f65;
    --selection: rgba(104, 126, 148, 0.24);

    --quote-bg: #faf8f4;
    --quote-rule: #b9aa98;

    --code-bg: #f5f3ef;
    --code-ink: #3b3834;
  }

  html {
    min-height: 100%;
    background: var(--paper);
    scroll-behavior: auto;
  }

  body {
    box-sizing: border-box;
    width: 100%;
    min-height: 100%;
    margin: 0;
    padding:
      clamp(2.5rem, 5.5vw, 4.5rem)
      clamp(1.5rem, 7vw, 4.5rem)
      7rem;

    color: var(--ink);
    background: var(--paper);

    font-family: Lora, Georgia, 'Times New Roman', serif;
    font-size: 18px;
    font-weight: 400;
    line-height: 1.8;

    text-rendering: optimizeLegibility;
    font-kerning: normal;
    font-variant-ligatures: common-ligatures;
    overflow-wrap: break-word;
  }

  ::selection {
    color: var(--ink);
    background: var(--selection);
  }

  p {
    margin: 0 0 1.35em;
  }

  h1,
  h2,
  h3 {
    color: var(--ink);
    font-family: Inter, system-ui, sans-serif;
    font-weight: 600;
    font-style: normal;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  h1 {
    margin: 0 0 1.25em;
    font-size: 2rem;
    line-height: 1.18;
  }

  h2 {
    margin: 2.4em 0 0.75em;
    font-size: 1.42rem;
    line-height: 1.25;
  }

  h3 {
    margin: 2em 0 0.65em;
    font-size: 1.08rem;
    line-height: 1.35;
    letter-spacing: -0.012em;
  }

  h1 + h2,
  h2 + h3 {
    margin-top: 1.2em;
  }

  h1 + p,
  h2 + p,
  h3 + p {
    margin-top: 0;
  }

  strong {
    color: #211f1c;
    font-weight: 600;
  }

  em {
    font-style: italic;
  }

  a {
    color: var(--link);
    text-decoration-line: underline;
    text-decoration-color: rgba(82, 109, 135, 0.42);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
  }

  a:hover {
    color: var(--link-hover);
    text-decoration-color: currentColor;
  }

  blockquote {
    margin: 2rem 0;
    padding: 0.2rem 0 0.2rem 1.35rem;

    color: var(--ink-soft);
    background: linear-gradient(
      90deg,
      var(--quote-bg) 0,
      rgba(250, 248, 244, 0) 82%
    );
    border-left: 2px solid var(--quote-rule);

    font-style: italic;
  }

  blockquote p:last-child {
    margin-bottom: 0;
  }

  ul,
  ol {
    margin: 0 0 1.4em;
    padding-left: 1.6em;
  }

  li {
    margin: 0.3em 0;
    padding-left: 0.18em;
  }

  li::marker {
    color: var(--ink-faint);
  }

  code {
    padding: 0.12em 0.34em;
    color: var(--code-ink);
    background: var(--code-bg);
    border: 1px solid var(--rule);
    border-radius: 4px;

    font-family:
      'IBM Plex Mono',
      'SFMono-Regular',
      Consolas,
      monospace;
    font-size: 0.84em;
  }

  pre {
    margin: 1.8rem 0;
    padding: 1.15rem 1.25rem;
    overflow-x: auto;

    color: var(--code-ink);
    background: var(--code-bg);
    border: 1px solid var(--rule);
    border-radius: 6px;

    font-family:
      'IBM Plex Mono',
      'SFMono-Regular',
      Consolas,
      monospace;
    font-size: 0.86rem;
    line-height: 1.65;
    white-space: pre-wrap;
  }

  pre code {
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 0;
    font-size: inherit;
  }

  hr {
    width: 32%;
    margin: 3.25rem auto;
    border: 0;
    border-top: 1px solid var(--rule-strong);
  }

  table {
    width: 100%;
    margin: 2rem 0;
    border-collapse: collapse;
    border-spacing: 0;

    color: var(--ink);
    font-family: Inter, system-ui, sans-serif;
    font-size: 0.84rem;
    line-height: 1.55;
  }

  th,
  td {
    padding: 0.7rem 0.75rem;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--rule);
  }

  th {
    color: var(--ink-soft);
    background: #faf9f7;
    border-top: 1px solid var(--rule-strong);
    border-bottom-color: var(--rule-strong);
    font-weight: 600;
  }

  tr:last-child td {
    border-bottom-color: var(--rule-strong);
  }

  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 2rem auto;
    border-radius: 3px;
  }

  .mce-content-body[data-mce-placeholder]::before {
    color: #a39c93;
    font-style: italic;
  }

  @media (max-width: 640px) {
    body {
      padding: 2rem 1.25rem 6rem;
      font-size: 17px;
      line-height: 1.72;
    }

    h1 {
      font-size: 1.7rem;
    }

    h2 {
      font-size: 1.3rem;
    }
  }
`;

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  imports: [FormsModule],
  template: ` <textarea id="markdown-tinymce-editor" [(ngModel)]="htmlContent"></textarea> `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        position: relative;
      }

      /* --- Nostos chrome bridge (expert design §3) ---
         One constant skin ('oxide'); every color below is driven by the
         app's --editor-ui-* tokens, which follow the global theme through
         plain CSS inheritance. Theme changes repaint instantly; the editor
         is never destroyed or re-created. */

      /* Base font and color */
      :host ::ng-deep .tox {
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--editor-ui-text);
      }

      /* Header and toolbar become one quiet, shallow strip */
      :host ::ng-deep .tox .tox-editor-header,
      :host ::ng-deep .tox .tox-toolbar-overlord,
      :host ::ng-deep .tox .tox-toolbar,
      :host ::ng-deep .tox .tox-toolbar__primary {
        background: var(--editor-ui-bg) !important;
        box-shadow: none !important;
      }

      :host ::ng-deep .tox .tox-editor-header {
        border-bottom: 1px solid var(--editor-ui-border) !important;
      }

      :host ::ng-deep .tox .tox-toolbar__primary {
        min-height: 46px;
        padding: 5px 8px !important;
      }

      /* Remove Oxide's grouped-control appearance */
      :host ::ng-deep .tox .tox-toolbar__group {
        gap: 3px;
        padding: 0 5px !important;
        border: 0 !important;
      }

      /* Quiet toolbar controls */
      :host ::ng-deep .tox .tox-tbtn,
      :host ::ng-deep .tox .tox-mbtn {
        min-width: 34px;
        height: 34px;
        margin: 0;
        padding: 0 8px;

        color: var(--editor-ui-muted) !important;
        background: transparent !important;
        border: 0 !important;
        border-radius: 6px !important;
        box-shadow: none !important;

        transition:
          color 120ms ease,
          background-color 120ms ease;
      }

      :host ::ng-deep .tox .tox-tbtn svg {
        fill: currentColor !important;
      }

      /* Hover */
      :host ::ng-deep .tox .tox-tbtn:hover,
      :host ::ng-deep .tox .tox-mbtn:hover,
      :host ::ng-deep .tox .tox-split-button:hover {
        color: var(--editor-ui-text) !important;
        background: var(--editor-ui-bg-hover) !important;
      }

      /* Active formatting state */
      :host ::ng-deep .tox .tox-tbtn--enabled,
      :host ::ng-deep .tox .tox-tbtn--enabled:hover,
      :host ::ng-deep .tox .tox-mbtn--active {
        color: var(--editor-ui-accent) !important;
        background: var(--editor-ui-accent-soft) !important;
      }

      /* Keyboard focus must be clearer than hover */
      :host ::ng-deep .tox .tox-tbtn:focus,
      :host ::ng-deep .tox .tox-mbtn:focus,
      :host ::ng-deep .tox .tox-split-button:focus-within {
        outline: 2px solid var(--editor-ui-focus) !important;
        outline-offset: 1px;
      }

      /* Blocks dropdown is text, not another bulky button */
      :host ::ng-deep .tox .tox-tbtn--select {
        min-width: 112px;
        justify-content: space-between;
      }

      /* Hard removal even if config regresses */
      :host ::ng-deep .tox .tox-menubar,
      :host ::ng-deep .tox .tox-statusbar {
        display: none !important;
      }
    `,
  ],
})
export class MarkdownEditorComponent implements OnInit, OnDestroy {
  initialContent = input<string>('');
  contentChange = output<string>();
  wordCountChange = output<number>();

  htmlContent = '';
  private editorId = 'markdown-tinymce-editor';

  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  private editor: any;

  /**
   * Final chrome (expert design §1): one constant 'oxide' skin, no menubar,
   * no statusbar, no autoresize, sliding toolbar, quickbars for selection.
   * The app theme reaches the chrome through the --editor-ui-* token layer
   * (CSS inheritance), never through skin swapping or editor teardown.
   */
  editorConfig = {
    base_url: '/tinymce',
    suffix: '.min',
    license_key: 'gpl',

    // --- 1. APPEARANCE & LAYOUT ---
    skin: 'oxide',
    content_css: false,
    menubar: false,
    statusbar: false,
    branding: false,
    promotion: false,
    resize: false,

    // --- 2. PLUGINS ---
    plugins: [
      'lists',
      'link',
      'image',
      'table',
      'wordcount',
      'searchreplace',
      'quickbars',
    ].join(' '),

    // --- 3. TOOLBAR ---
    toolbar:
      'undo redo | blocks | bold italic underline | bullist numlist | link image | removeformat',
    toolbar_mode: 'sliding',
    toolbar_sticky: false,

    quickbars_selection_toolbar: 'bold italic | h2 h3 blockquote | link',
    quickbars_insert_toolbar: false,

    contextmenu: false,
    browser_spellcheck: true,

    block_formats:
      'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Quote=blockquote; Code=pre',

    // --- 4. CONTENT STYLING (warm ink on white paper, theme-independent) ---
    height: '100%',
    content_style: NOSTOS_EDITOR_CONTENT_CSS,

    setup: (editor: any) => {
      this.editor = editor;
      editor.on('Change Undo Redo blur', () => this.onHtmlChange(editor.getContent()));

      const updateWordCount = () => {
        const count = editor.plugins?.wordcount?.body?.getWordCount?.() ?? 0;
        this.wordCountChange.emit(count);
      };

      editor.on('init', () => {
        editor.getBody().style.opacity = '1';
        // Optional: Safety check in case content loaded before init
        if (this.htmlContent && !editor.getContent()) {
          editor.setContent(this.htmlContent);
        }
        updateWordCount();
      });
      editor.on('SetContent Change Input Undo Redo', updateWordCount);
    },
  };

  constructor() {
    // 1. Handle External Content Updates (e.g. clicking a new file in sidebar)
    effect(async () => {
      const markdown = this.initialContent();

      // PARSE FIRST
      // This ensures we have the HTML ready before deciding where to put it
      const html = await marked.parse(markdown);

      // Always update local model (used by template/init)
      this.htmlContent = html;

      // NOW check if editor exists.
      // If editor initialized WHILE we were awaiting parse, this will now be true.
      if (this.editor) {
        // Only update if content is significantly different to avoid cursor jumping
        const currentMarkdown = this.turndownService.turndown(this.editor.getContent());
        if (currentMarkdown.trim() !== markdown.trim()) {
          this.editor.setContent(html);
        }
      }
    });
  }

  ngOnInit() {
    this.initEditor();
  }

  ngOnDestroy() {
    this.destroyEditor();
  }

  private initEditor() {
    // Prevent double-init
    if (this.editor) return;

    tinymce.init({
      selector: `#${this.editorId}`,
      ...this.editorConfig,
    });
  }

  private destroyEditor() {
    if (this.editor) {
      // Capture final state before destroying
      const finalHtml = this.editor.getContent();
      this.onHtmlChange(finalHtml);

      // Teardown
      tinymce.remove(this.editor);
      this.editor = null;
    }
  }

  onHtmlChange(html: string) {
    const markdown = this.turndownService.turndown(html);
    this.contentChange.emit(markdown);
  }
}
