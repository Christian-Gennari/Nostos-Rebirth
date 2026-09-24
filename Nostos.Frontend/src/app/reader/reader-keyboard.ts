/**
 * Page-key handling shared by the reader shell and the EPUB reader.
 *
 * The EPUB/PDF document is an iframe, so a key pressed while reading never
 * reaches the parent document's listeners. Both sides therefore use these two
 * helpers so the binding is identical wherever the focus happens to be.
 */

export type PageAction = 'next' | 'previous';

/**
 * The page action a key event asks for, or null when the key means nothing to
 * the reader. Left/right and PageUp/PageDown are the conventional pair; Space
 * is included because it is what most readers use to advance, with Shift+Space
 * going back.
 */
export function pageActionForKey(event: { key: string; shiftKey?: boolean }): PageAction | null {
  switch (event.key) {
    case 'ArrowLeft':
    case 'PageUp':
      return 'previous';
    case 'ArrowRight':
    case 'PageDown':
      return 'next';
    case ' ':
    case 'Spacebar':
      return event.shiftKey ? 'previous' : 'next';
    default:
      return null;
  }
}

/**
 * True when the event target is a text-entry surface, where a page key means
 * "move the caret" or "change the value" instead. Guards the quick-note
 * textarea, the PDF page input and any contenteditable field.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}


/**
 * True when reader-level paging must leave the focused control alone. This is
 * broader than text entry: Space activates buttons/links/toggles natively and
 * must never also turn a page.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  // Avoid `instanceof Element`: EPUB events originate in an iframe realm, so
  // their elements are not instances of the parent window's Element constructor.
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') return false;
  return !!element.closest(
    'button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
  );
}
