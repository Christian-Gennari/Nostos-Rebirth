import { Component, input, output, effect } from '@angular/core';
import { EditorModule } from '@tinymce/tinymce-angular';
import { FormsModule } from '@angular/forms';
import TurndownService from 'turndown';
import { marked } from 'marked';

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  imports: [EditorModule, FormsModule],
  template: `
    <editor
      [init]="editorConfig"
      [(ngModel)]="htmlContent"
      (ngModelChange)="onHtmlChange($event)"
    ></editor>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      ::ng-deep .tox-tinymce {
        border: none !important;
      }
    `,
  ],
})
export class MarkdownEditorComponent {
  initialContent = input<string>('');
  contentChange = output<string>();

  htmlContent = '';
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  editorConfig = {
    // This is the CRITICAL combination now:
    base_url: '/tinymce', // Tells TinyMCE where to find resources
    license_key: 'gpl', // Keeps it free

    height: '100%',
    menubar: false,
    statusbar: false,
    plugins: 'lists link image table code help wordcount',
    toolbar:
      'undo redo | blocks | bold italic underline | bullist numlist | blockquote | removeformat',

    // TinyMCE can find its own skins/oxide/skin.min.css based on base_url, no manual paths needed.
    skin: 'oxide',

    content_style: `
      body { font-family: 'Helvetica', sans-serif; font-size: 16px; max-width: 800px; margin: 0 auto; padding: 20px; }
    `,
  };

  constructor() {
    effect(async () => {
      const markdown = this.initialContent();
      if (markdown && this.turndownService.turndown(this.htmlContent) !== markdown) {
        // Only convert if the input is Markdown and it's different from the current content
        this.htmlContent = await marked.parse(markdown);
      }
    });
  }

  onHtmlChange(html: string) {
    const markdown = this.turndownService.turndown(html);
    this.contentChange.emit(markdown);
  }
}
