import { AfterViewInit, Directive, ElementRef, inject, signal } from '@angular/core';

/**
 * Reveals an image out of a lens defocus instead of letting it pop in sharp.
 *
 * Adds `.bloom-art` (start state: opacity 0) plus, once the browser actually has
 * pixels, `.is-bloomed` — which plays the global `bloom-in` keyframes
 * (blur 12px -> 0, scale 1.03 -> 1, opacity 0 -> 1).
 *
 * The reveal is bound to the element's own `load`/`error` event rather than to
 * tag insertion, because an `<img>` inserted before its bytes arrive would play
 * the whole animation on an empty box. `error` reveals too: a cover that fails
 * to load must degrade to the paper ground behind it, never stay invisible.
 *
 * `complete` is checked after view init because a cached image can finish
 * decoding before Angular attaches these listeners, and `load` will never fire
 * for us in that case.
 *
 * The flag is a signal read by the host binding, not a plain property: the app
 * runs zoneless, so mutating a field from a manually attached listener would
 * never schedule change detection and the cover would sit at opacity 0 forever.
 * A signal write marks the view dirty and refreshes it on its own.
 */
@Directive({
  selector: 'img[appBloomArt]',
  host: {
    class: 'bloom-art',
    '[class.is-bloomed]': 'bloomed()',
  },
})
export class BloomArtDirective implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLImageElement>>(ElementRef);

  readonly bloomed = signal(false);

  constructor() {
    const img = this.host.nativeElement;
    const reveal = () => this.bloomed.set(true);
    img.addEventListener('load', reveal);
    img.addEventListener('error', reveal);
  }

  ngAfterViewInit(): void {
    if (this.host.nativeElement.complete) this.bloomed.set(true);
  }
}
