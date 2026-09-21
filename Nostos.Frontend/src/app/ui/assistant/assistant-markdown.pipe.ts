import { Pipe, PipeTransform } from '@angular/core';
import { Marked } from 'marked';

/**
 * Escape raw HTML before it reaches Angular's HTML binding. Angular still
 * sanitizes the final rendered string; this renderer additionally makes model
 * supplied HTML visible as text instead of treating it as part of the Markdown
 * surface at all.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Ask Nostos has its own Marked instance. The Writing Studio also uses Marked,
 * and sharing the global instance would let one surface's renderer extensions
 * silently change the other.
 */
const assistantMarkdown = new Marked();
assistantMarkdown.use({
  gfm: true,
  breaks: true,
  silent: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },

    image({ text }) {
      const label = text.trim();
      const copy = label ? `Image omitted: ${label}` : 'Image omitted';
      return `<span class="assistant-markdown-image-omitted" role="note">[${escapeHtml(copy)}]</span>`;
    },

    checkbox({ checked }) {
      return `<span class="assistant-markdown-task-marker" aria-hidden="true">${checked ? '☑' : '☐'}</span> `;
    },
  },
});

/**
 * Compile one assistant reply to safe-to-bind HTML.
 *
 * This deliberately returns an ordinary string rather than SafeHtml. Binding
 * the string through Angular's [innerHTML] keeps Angular's sanitizer in the
 * path for links and every other generated attribute.
 */
export function renderAssistantMarkdown(source: string): string {
  const rendered = assistantMarkdown.parse(source);
  return typeof rendered === 'string' ? rendered : escapeHtml(source);
}

@Pipe({
  name: 'assistantMarkdown',
  standalone: true,
  pure: true,
})
export class AssistantMarkdownPipe implements PipeTransform {
  transform(source: string): string {
    return renderAssistantMarkdown(source);
  }
}
