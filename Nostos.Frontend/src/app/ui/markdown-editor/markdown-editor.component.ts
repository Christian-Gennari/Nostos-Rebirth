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
import { Router, NavigationStart, NavigationEnd, Event as RouterEvent } from '@angular/router';
import { filter } from 'rxjs/operators';
import TurndownService from 'turndown';
import { marked } from 'marked';

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

      /* Style the Toolbar to match the brand (Clean White) */
      ::ng-deep .tox-editor-header {
        background-color: #ffffff !important; /* var(--bg-surface) */
        border-bottom: 1px solid #e5e5e5 !important; /* var(--border-color) */
        box-shadow: none !important;
        padding: 0.5rem !important;
        z-index: 10;
      }

      /* Make the toolbar sticky if needed, or let the parent handle it */
      ::ng-deep .tox-editor-header {
        position: sticky !important;
        top: 0;
      }

      /* Toolbar Buttons - Soft interaction states */
      ::ng-deep .tox .tox-tbtn {
        border-radius: 4px !important; /* var(--radius-sm) */
        color: #4a4a4a !important; /* var(--color-text-muted) */
        transition: background 0.2s ease, color 0.2s ease;
      }

      ::ng-deep .tox .tox-tbtn:hover {
        background: #f3f3f3 !important; /* var(--bg-hover) */
        color: #111111 !important; /* var(--color-primary) */
      }

      ::ng-deep .tox .tox-tbtn--enabled,
      ::ng-deep .tox .tox-tbtn--enabled:hover {
        background: #eef2ff !important; /* Very faint accent tint */
        color: #60a5fa !important; /* var(--color-accent) */
      }

      /* Status bar (bottom) - make it subtle */
      ::ng-deep .tox .tox-statusbar {
        border-top: 1px solid #e5e5e5 !important;
        background-color: #fafafa !important; /* var(--bg-body) */
        color: #888888 !important;
      }

      ::ng-deep .tox .tox-statusbar__path-item {
        color: #888888 !important;
      }
    `,
  ],
})
export class MarkdownEditorComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private elementRef = inject(ElementRef);

  initialContent = input<string>('');
  contentChange = output<string>();

  htmlContent = '';
  private editorId = 'markdown-tinymce-editor';

  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  private editor: any;

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
    skin: 'oxide',

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
      });
    },
  };

  constructor() {
    // 1. Handle External Content Updates (e.g. clicking a new file in sidebar)
    effect(async () => {
      const markdown = this.initialContent();

      // If editor is active, update it
      if (this.editor) {
        // Only update if content is significantly different to avoid cursor jumping
        const currentMarkdown = this.turndownService.turndown(this.editor.getContent());
        if (currentMarkdown.trim() !== markdown.trim()) {
          this.editor.setContent(await marked.parse(markdown), { format: 'html' });
        }
      } else {
        // If editor is not ready (e.g. detached), just update the local model
        // so it will be used when we re-init.
        this.htmlContent = await marked.parse(markdown);
      }
    });

    // 2. Handle Route Reuse / Navigation
    // Since RouteReuseStrategy keeps this component alive but detaches it from DOM,
    // the iframe dies. We must kill and rebirth the editor on navigation.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationStart || e instanceof NavigationEnd))
      .subscribe((event: RouterEvent) => {
        if (event instanceof NavigationStart) {
          // Navigating away: Force a save and cleanup
          this.destroyEditor();
        }

        if (event instanceof NavigationEnd) {
          // Navigating back: If we are visible in the DOM, re-initialize
          // (This check ensures we only init if this specific component is active)
          if (document.body.contains(this.elementRef.nativeElement)) {
            // Small delay to ensure DOM is settled
            setTimeout(() => this.initEditor(), 0);
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
