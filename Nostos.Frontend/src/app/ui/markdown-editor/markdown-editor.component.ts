import {
  Component,
  input,
  output,
  effect,
  OnDestroy,
  OnInit,
  ElementRef,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import TurndownService from 'turndown';
import { marked } from 'marked';
import { ThemeService } from '../../core/services/theme.service';

// Import TinyMCE as a global type reference
declare var tinymce: any;

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

      /* --- UI Overrides (The Shell) --- */

      /* Remove the default heavy border and shadow */
      ::ng-deep .tox-tinymce {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
      }

      /* Editor chrome colors come from the TinyMCE skin (oxide / oxide-dark),
         which is selected to match the global theme — no hard-coded colors
         here, so the menubar/toolbar follow the theme while the content
         paper below stays white via content_style. */
      ::ng-deep .tox-editor-header {
        border-bottom: 1px solid var(--border-color) !important;
        box-shadow: none !important;
        padding: 0.5rem !important;
        z-index: 10;
        position: sticky !important;
        top: 0;
      }

      ::ng-deep .tox .tox-tbtn {
        border-radius: 4px !important;
        transition:
          background 0.2s ease,
          color 0.2s ease;
      }

      ::ng-deep .tox .tox-statusbar {
        border-top: 1px solid var(--border-color) !important;
      }
    `,
  ],
})
export class MarkdownEditorComponent implements OnInit, OnDestroy {
  private elementRef = inject(ElementRef);
  private themeService = inject(ThemeService);

  initialContent = input<string>('');
  contentChange = output<string>();

  htmlContent = '';
  private editorId = 'markdown-tinymce-editor';

  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  private editor: any;
  private appliedSkin: string | null = null;

  editorConfig = {
    base_url: '/tinymce',
    license_key: 'gpl',

    // --- 1. APPEARANCE & LAYOUT ---
    highlight_on_focus: false,
    min_height: 500,
    menubar: true,
    statusbar: true,
    resize: false,
    branding: false,
    promotion: false,
    // --- 2. PLUGINS ---
    plugins: [
      'lists',
      'link',
      'image',
      'table',
      'code',
      'help',
      'wordcount',
      'autoresize',
      'searchreplace',
      'visualblocks',
      'directionality',
      'quickbars',
    ].join(' '),

    // --- 3. TOOLBAR ---
    toolbar:
      'undo redo | ' +
      'blocks | ' +
      'bold italic underline | ' +
      'bullist numlist | ' +
      'link image | ' +
      'removeformat',

    quickbars_selection_toolbar: 'bold italic | h2 h3 | blockquote',
    quickbars_insert_toolbar: false,

    block_formats:
      'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Quote=blockquote; Code=pre',

    // --- 4. CONTENT STYLING ---
    content_style: `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');

      :root {
        --bg-body: #fafafa;
        --bg-surface: #ffffff;
        --color-primary: #111111;
        --color-text-main: #1a1a1a;
        --color-text-muted: #4a4a4a;
        --color-accent: #60a5fa;
        --border-color: #e5e5e5;
      }

      body {
        font-family: 'Lora', serif;
        font-size: 18px;
        line-height: 1.8;
        color: var(--color-text-main);
        margin: 2rem 3rem;
        background-color: var(--bg-surface);
        overflow-x: hidden;
      }

      h1, h2, h3, h4, h5, h6 {
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        color: var(--color-primary);
        margin-top: 1.5em;
        margin-bottom: 0.75em;
        letter-spacing: -0.02em;
      }

      a {
        color: var(--color-accent);
        text-decoration: none;
        border-bottom: 1px solid rgba(96, 165, 250, 0.3);
        transition: border-color 0.2s;
        cursor: pointer;
      }
      a:hover {
        border-bottom-color: var(--color-accent);
      }

      blockquote {
        border-left: 3px solid var(--border-color);
        margin-left: 0;
        padding-left: 1.25rem;
        color: var(--color-text-muted);
        font-style: italic;
      }

      pre {
        background: var(--bg-body);
        padding: 1rem;
        border-radius: 6px;
        font-family: monospace;
        font-size: 0.9em;
        color: var(--color-text-muted);
        border: 1px solid var(--border-color);
      }

      table {
        border-collapse: collapse;
        width: 100%;
        margin: 1.5rem 0;
      }
      table td, table th {
        border: 1px solid var(--border-color);
        padding: 0.75rem;
      }
      table th {
        background-color: var(--bg-body);
        font-weight: 600;
        text-align: left;
      }

      .mce-content-body[data-mce-placeholder]:not(.mce-visual-blocks)::before {
        color: #999;
        font-style: italic;
      }
    `,

    setup: (editor: any) => {
      this.editor = editor;
      editor.on('Change Undo Redo blur', () => this.onHtmlChange(editor.getContent()));
      editor.on('init', () => {
        editor.getBody().style.opacity = '1';
        // Optional: Safety check in case content loaded before init
        if (this.htmlContent && !editor.getContent()) {
          editor.setContent(this.htmlContent);
        }
      });
    },
  };

  constructor() {
    // Re-skin TinyMCE when the global theme changes: destroy + re-create the
    // editor (content is preserved through htmlContent) so the chrome
    // (menubar/toolbar) matches the theme while the paper stays white.
    effect(() => {
      const skin = this.getSkin();
      if (this.appliedSkin === null) {
        this.appliedSkin = skin;
        return;
      }
      if (skin === this.appliedSkin) return;
      this.appliedSkin = skin;

      if (this.editor) {
        const currentHtml = this.editor.getContent();
        this.destroyEditor();
        this.htmlContent = currentHtml;
        this.initEditor();
      }
    });

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

    this.appliedSkin = this.getSkin();
    tinymce.init({
      selector: `#${this.editorId}`,
      ...this.editorConfig,
      skin: this.appliedSkin,
    });
  }

  /** Oxide chrome for light themes, oxide-dark for dark/sepia (paper stays white). */
  private getSkin(): string {
    const theme = this.themeService.theme();
    return theme === 'dark' || theme === 'sepia' ? 'oxide-dark' : 'oxide';
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
