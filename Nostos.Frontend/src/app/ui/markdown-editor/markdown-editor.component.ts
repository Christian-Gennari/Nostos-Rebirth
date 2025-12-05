import { Component, input, output, effect, signal, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import TurndownService from 'turndown';
import { marked } from 'marked';

// Import TinyMCE as a global type reference
declare var tinymce: any;

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  // REMOVE EditorModule
  imports: [FormsModule],
  template: ` <textarea id="markdown-tinymce-editor" [(ngModel)]="htmlContent"></textarea> `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      /* Keep the style for the TinyMCE element */
      ::ng-deep .tox-tinymce {
        border: none !important;
      }
    `,
  ],
})
export class MarkdownEditorComponent implements OnInit, OnDestroy {
  initialContent = input<string>('');
  contentChange = output<string>();

  htmlContent = '';
  private editorId = 'markdown-tinymce-editor';
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  private editor: any; // Reference to the TinyMCE editor instance

  editorConfig = {
    // CRITICAL for self-hosting: points to where assets are copied in angular.json
    base_url: '/tinymce',
    license_key: 'gpl', // Keeps it free

    height: '100%',
    menubar: false,
    statusbar: false,
    plugins: 'lists link image table code help wordcount',
    toolbar:
      'undo redo | blocks | bold italic underline | bullist numlist | blockquote | removeformat',

    skin: 'oxide',

    content_style: `
      body { font-family: 'Helvetica', sans-serif; font-size: 16px; max-width: 800px; margin: 0 auto; padding: 20px; }
    `,
    // New setup hook for change events
    setup: (editor: any) => {
      this.editor = editor;
      editor.on('Change', () => this.onHtmlChange(editor.getContent()));
      editor.on('Undo', () => this.onHtmlChange(editor.getContent()));
      editor.on('Redo', () => this.onHtmlChange(editor.getContent()));
      editor.on('blur', () => this.onHtmlChange(editor.getContent()));
    },
  };

  constructor() {
    effect(async () => {
      const markdown = this.initialContent();
      if (markdown && this.editor) {
        // Only convert and set content if the input is Markdown and it's different
        // and if the editor is initialized.
        const currentMarkdown = this.turndownService.turndown(this.editor.getContent());
        if (currentMarkdown !== markdown) {
          this.editor.setContent(await marked.parse(markdown), { format: 'html' });
        }
      } else if (markdown && !this.editor) {
        // Fallback if effect runs before init, sets content for initial load
        this.htmlContent = await marked.parse(markdown);
      }
    });
  }

  ngOnInit() {
    // Manually initialize TinyMCE
    tinymce.init({
      selector: `#${this.editorId}`, // Target the textarea by ID
      ...this.editorConfig,
    });
  }

  ngOnDestroy() {
    // Clean up the editor instance when the component is destroyed
    if (this.editor) {
      tinymce.remove(this.editor);
    }
  }

  // The logic for converting HTML to Markdown remains the same
  onHtmlChange(html: string) {
    const markdown = this.turndownService.turndown(html);
    this.contentChange.emit(markdown);
  }
}
