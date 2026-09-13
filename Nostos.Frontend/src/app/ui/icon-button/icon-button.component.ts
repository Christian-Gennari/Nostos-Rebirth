import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

/** Button box rungs. Measured from the live app, not invented. */
export type IconButtonSize = 'xxs' | 'xs' | 'md';
/** Tone affects the hover ink only; the fill stays neutral. */
export type IconButtonTone = 'default' | 'danger';

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
 *
 * THERE IS NO `active` INPUT, ON PURPOSE.
 * Every surface's selected state is styled by its own `.icon-btn.active` rule, and
 * because the host is the button a plain `[class.active]="tocOpen()"` keeps working
 * untouched. An `active` input emitting `icon-btn--active` would be a SECOND way to
 * express one state, and the two would drift.
 *
 * THERE IS NO `ariaLabel` INPUT, ON PURPOSE.
 * A host binding like `[attr.aria-label]="ariaLabel() || null"` OVERRIDES a
 * static `aria-label` written on the call site, so `<button appIconButton
 * aria-label="Edit book">` had its label silently replaced with nothing — a
 * real accessibility regression that no unit test caught and only the computed
 * probe did. Because the host IS the `<button>`, native attributes already pass
 * through untouched, so the input only ever added a way to lose the label.
 * Write `aria-label` (or `title`) on the call site directly.
 */
@Component({
  selector: 'button[appIconButton]',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<lucide-icon [img]="icon()" [size]="glyphSize()" />`,
  host: {
    class: 'icon-btn',
    '[class.icon-btn--danger]': "tone() === 'danger'",
    '[class.icon-btn--xxs]': "size() === 'xxs'",
    '[class.icon-btn--xs]': "size() === 'xs'",
    '[attr.aria-pressed]': 'pressedAttr()',
  },
  styles: [
    `
      /* The token graph and the "icon-btn" base stay in styles.css. Measured
         per-surface rungs, re-declared here once instead of in five places:

           reader  / modal   32px  a smart-hidden  [--control-h-md]
           library rows      28px  radius 4px
           note-card .xs     24px  radius 50%   <- round chip, NOT xs=28px

         "small" appeared in note-card markup but had NO CSS rule anywhere, so it
         already computed at 32px and maps to md; a "small" size is deliberately
         not a rung, because inventing one would change those buttons' size. The
         dead class was dropped during that migration. */
      :host(.icon-btn--xxs) {
        width: 24px;
        height: 24px;
      }
      :host(.icon-btn--xs) {
        width: var(--control-h-xs);
        height: var(--control-h-xs);
      }
      /* Size only. Radius deliberately NOT owned: it varies per surface on
         purpose — 3px global (--radius-sm), 4px on Library rows and the reader
         toolbar, 6px on the studio zen toggle, 50% on note-card's round chips —
         and it mostly arrives through descendant rules that keep matching because
         the host is still the button. Encoding a radius rung here would move
         pixels on four surfaces to no benefit.
         Hover, active and the .delete tone likewise stay with the surfaces. */
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

  /** `xxs` = 24px round chip, `xs` = 28px, `md` = 32px (the token default). */
  readonly size = input<IconButtonSize>('md');

  /** `danger` tints the hover ink; the fill stays neutral by design. */
  readonly tone = input<IconButtonTone>('default');

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
