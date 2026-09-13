import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

/** Button box rungs. Measured from the live app, not invented. */
export type IconButtonSize = 'xxs' | 'xs' | 'md';
/** Tone affects the hover ink only; the fill stays neutral. */
export type IconButtonTone = 'default' | 'danger';
/** Corner shape. `round` is the 50% chip used by note-card's dense row actions. */
export type IconButtonShape = 'rounded' | 'round';

/**
 * A single icon button, replacing 30 hand-built copies across 5 templates.
 *
 * WHY AN ATTRIBUTE SELECTOR ON THE NATIVE BUTTON
 * ----------------------------------------------
 * `selector: 'button[appIconButton]'` means the HOST element is the real
 * `<button>`. That is not a stylistic preference, it is the only shape that
 * survives contact with this codebase:
 *
 *  - Native `disabled`, `type`, `(click)`, keyboard activation and `aria-*` keep
 *    working with no forwarding code.
 *  - One-off classes (`desktop-only`, `zen-toggle`, `overflow-toggle`) pass
 *    through untouched, so surface CSS that targets them is unaffected.
 *  - Descendant selectors keep matching. Several surfaces style the button from a
 *    scoped rule (`.reader-toolbar .icon-btn { border-radius: var(--radius-md) }`,
 *    `.doc-actions .icon-btn`, `.note-actions .icon-btn`) and specs query
 *    `.actions .icon-btn`. A custom wrapper element would break all of them, and
 *    a plain directive could not own an encapsulated stylesheet the way every
 *    other component in `src/app/ui/` does.
 *
 * The host therefore keeps the literal `icon-btn` class. That is load-bearing:
 * `styles.css` still carries `.icon-btn:hover`, `.icon-btn.delete:hover` and
 * `.icon-btn lucide-icon { top: 1px }` (the glyph nudge every surface relies on),
 * and the existing specs select on `.icon-btn`. The component adds the SIZING and
 * SHAPE, which is what the five copies each re-declared inconsistently.
 *
 * Deliberately NOT here: `data-tip`, the themed tooltip, and the `.delete`
 * fill-on-hover. Those stay in the surfaces that own them so this remains a
 * pure de-duplication and every migration is pixel-identical. Moving them is a
 * follow-up, not a refactor.
 */
@Component({
  selector: 'button[appIconButton]',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<lucide-icon [img]="icon()" [size]="glyphSize()" />`,
  host: {
    class: 'icon-btn',
    '[class.icon-btn--active]': 'active()',
    '[class.icon-btn--danger]': "tone() === 'danger'",
    '[class.icon-btn--round]': "shape() === 'round'",
    '[class.icon-btn--xxs]': "size() === 'xxs'",
    '[class.icon-btn--xs]': "size() === 'xs'",
    '[attr.aria-label]': 'ariaLabel() || null',
    '[attr.aria-pressed]': 'pressedAttr()',
  },
  styles: [
    `
      /* The token graph and the "icon-btn" base stay in styles.css. Measured
         per-surface rungs, re-declared here once instead of in five places:

           reader  / modal   32px  a smart-hidden  [--control-h-md]
           library rows      28px  radius 4px
           note-card .xs     24px  radius 50%   <- round chip, NOT xs=28px

         .small appears in note-card markup but has NO CSS rule anywhere, so it
         already computes at 32px; it therefore maps to md, and size="small"
         is not a rung. */
      :host(.icon-btn--xxs) {
        width: 24px;
        height: 24px;
      }
      :host(.icon-btn--xs) {
        width: var(--control-h-xs);
        height: var(--control-h-xs);
      }
      :host(.icon-btn--round) {
        border-radius: 50%;
      }

      /* Hover, active and the .delete tone stay in the surfaces and in styles.css,
         which this component does not own; only the two things the copies
         disagreed about (size, shape) live here. */
    `,
  ],
})
export class IconButtonComponent {
  /** The lucide icon to render. Required — a button with no glyph is a bug. */
  readonly icon = input.required<LucideIconData>();

  /**
   * Glyph size in px. Kept separate from the button box: several call sites use a
   * 14-15px glyph inside a 28px box, which is a deliberate optical choice.
   */
  readonly glyphSize = input<number>(16);

  /**
   * Becomes the host's `aria-label`, which is what an icon-only button needs.
   * `null` when empty so the attribute is absent rather than empty.
   */
  readonly ariaLabel = input<string>('');

  /** `xxs` = 24px round chip, `xs` = 28px, `md` = 32px (the token default). */
  readonly size = input<IconButtonSize>('md');

  /** `danger` tints the hover ink; the fill stays neutral by design. */
  readonly tone = input<IconButtonTone>('default');

  /** `round` for the dense circular row-actions on note cards. */
  readonly shape = input<IconButtonShape>('rounded');

  /**
   * Selected state. Applied as a class rather than an attribute because the
   * reader's own `.icon-btn.active` rule already keys off the class, and the
   * component must not fight it.
   */
  readonly active = input(false);

  /**
   * Tri-state `aria-pressed`. `null` (the default) leaves the attribute OFF
   * entirely — most icon buttons are actions, not toggles, and emitting
   * `aria-pressed="false"` on them would misreport them as toggles to AT.
   * Migrations therefore start at `null`, which is identical to today's markup.
   */
  readonly pressed = input<boolean | null>(null);

  /** Exposed for tests: which rung class the host should carry. */
  readonly sizeClass = computed(() => `icon-btn--${this.size()}`);

  /**
   * `aria-pressed` as a STRING, computed here rather than in the host binding.
   * Angular host bindings resolve against the component instance, so the global
   * `String()` is not callable there (`TS2339: Property 'String' does not exist on
   * type IconButtonComponent`). Keeping the conversion in a `computed` also keeps
   * the host binding declarative.
   */
  readonly pressedAttr = computed(() => {
    const p = this.pressed();
    return p === null ? null : p ? 'true' : 'false';
  });
}
