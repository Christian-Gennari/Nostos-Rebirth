import { Component, input, output, effect, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import TurndownService from 'turndown';
import { marked } from 'marked';
import { skipUntil } from 'rxjs';

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
        min-height: 100%;
        position: relative;
      }
      /* Remove the blue focus outline (The "Shell" glow) */
      ::ng-deep .tox-tinymce {
        border: none !important;
        box-shadow: none !important;
      }
      /* Optional: Make the toolbar sticky at the top if the content gets long */
      ::ng-deep .tox-editor-header {
        position: sticky !important;
        top: 0;
        z-index: 100;
        background: #fff;
        border-bottom: 1px solid #f0f0f0 !important;
      }
    `,
  ],
})
export class MarkdownEditorComponent implements OnInit, OnDestroy {
  initialContent = input<string>('');
  contentChange = output<string>();

  htmlContent = '';
  private editorId = 'markdown-tinymce-editor';

  // Turndown converts HTML back to Markdown
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  private editor: any;

  editorConfig = {
    base_url: '/tinymce',
    license_key: 'gpl',

    // --- 1. APPEARANCE & LAYOUT ---
    highlight_on_focus: false, // Removes the blue glow
    min_height: 500, // Starts at a decent page size
    menubar: true, // Keep it clean (hide File/Edit/View)
    statusbar: true, // Hide the bottom bar (path/wordcount)
    resize: false, // Autoresize handles this

    // --- 2. PLUGINS (The "Everything" List) ---
    // Added: table, advlist (for fancy lists), searchreplace, visualblocks
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
    ].join(' '),

    skin: 'oxide',
    // --- 3. TOOLBAR (Word-Style Grouping) ---
    // | separates groups.
    // 'blocks' restores the Heading dropdown.
    toolbar:
      'undo redo | ' +
      'blocks | ' +
      'bold italic underline strikethrough | ' +
      'alignleft aligncenter alignright alignjustify | ' +
      'bullist numlist outdent indent | ' +
      'link image table | ' +
      'removeformat code searchreplace',

    // Configure what appears in the "Blocks" dropdown
    block_formats:
      'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Quote=blockquote; Code=pre',

    // --- 4. CONTENT STYLING (The "Paper" Look) ---
    content_style: `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:ital,wght@0,400;0,700;1,400&display=swap');

      body {
        font-family: 'Lora', serif;
        font-size: 18px; /* Slightly larger for modern feel */
        line-height: 1.75;
        color: #1a1a1a;
        margin: 2rem 3rem; /* Generous margins like a real doc */
        background-color: #fff;
        overflow-x: hidden; /* Prevent horizontal scroll */
      }

      /* Clean Headings */
      h1, h2, h3, h4, h5, h6 {
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        color: #111;
        margin-top: 1.5em;
        margin-bottom: 0.75em;
        letter-spacing: -0.02em;
      }

      /* Clean Links */
      a { color: #2563eb; text-decoration: underline; cursor: pointer; }

      /* Blockquotes like modern editorial */
      blockquote {
        border-left: 3px solid #e5e7eb;
        margin-left: 0;
        padding-left: 1.25rem;
        color: #4b5563;
        font-style: italic;
      }

      /* Tables (Clean grid) */
      table {
        border-collapse: collapse;
        width: 100%;
        margin: 1.5rem 0;
      }
      table td, table th {
        border: 1px solid #e5e7eb;
        padding: 0.75rem;
      }
      table th {
        background-color: #f9fafb;
        font-weight: 600;
        text-align: left;
      }

      /* Code Blocks */
      pre {
        background: #f3f4f6;
        padding: 1rem;
        border-radius: 0.5rem;
        font-family: monospace;
        font-size: 0.9em;
        color: #374151;
      }

      /* Remove outline on focus */
      .mce-content-body:not([dir=rtl][data-mce-placeholder]) {
        outline: none !important;
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
    effect(async () => {
      const markdown = this.initialContent();
      if (this.editor) {
        const currentMarkdown = this.turndownService.turndown(this.editor.getContent());
        if (currentMarkdown.trim() !== markdown.trim()) {
          this.editor.setContent(await marked.parse(markdown), { format: 'html' });
        }
      } else if (markdown) {
        this.htmlContent = await marked.parse(markdown);
      }
    });
  }

  ngOnInit() {
    tinymce.init({
      selector: `#${this.editorId}`,
      ...this.editorConfig,
    });
  }

  ngOnDestroy() {
    if (this.editor) {
      tinymce.remove(this.editor);
    }
  }

  onHtmlChange(html: string) {
    const markdown = this.turndownService.turndown(html);
    this.contentChange.emit(markdown);
  }
}
