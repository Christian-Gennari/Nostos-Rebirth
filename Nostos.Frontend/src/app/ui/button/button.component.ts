/**
 * Copyright (C) 2026 Christian Gennari
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * Canonical Nostos text/action button.
 *
 * The component matches the native <button> rather than wrapping one. Native
 * disabled/type/aria attributes and click/keyboard behaviour therefore remain
 * owned by the caller, while this component owns the visual action contract.
 *
 * Product controls with a different interaction model (tabs, radio cards,
 * icon-only actions) should keep their own semantics. Icon-only actions use
 * appIconButton.
 */
@Component({
  selector: 'button[appButton]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'nostos-button',
    '[class.nostos-button--primary]': "variant() === 'primary'",
    '[class.nostos-button--secondary]': "variant() === 'secondary'",
    '[class.nostos-button--ghost]': "variant() === 'ghost'",
    '[class.nostos-button--danger]': "variant() === 'danger'",
    '[class.nostos-button--sm]': "size() === 'sm'",
    '[attr.aria-busy]': "busy() ? 'true' : null",
  },
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 14px;
        border: 0;
        border-radius: var(--radius-action);
        font-family: inherit;
        font-size: 0.82rem;
        font-weight: var(--fw-medium);
        line-height: normal;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
        touch-action: manipulation;
        transition:
          background-color 0.15s ease,
          border-color 0.15s ease,
          color 0.15s ease,
          opacity 0.15s ease,
          transform 0.15s ease;
      }

      :host(:focus-visible) {
        outline: var(--focus-ring-width) solid var(--focus-ring);
        outline-offset: 2px;
      }

      :host(:disabled) {
        opacity: 0.5;
        cursor: not-allowed;
      }

      :host(.nostos-button--primary) {
        background: var(--cta-surface);
        color: var(--cta-ink);
      }

      :host(.nostos-button--primary:hover:not(:disabled)) {
        background: var(--cta-surface-hover);
        transform: translateY(-1px);
      }

      :host(.nostos-button--secondary) {
        background: var(--bg-surface-alt);
        color: var(--color-text-main);
        border: 1px solid var(--border-color);
      }

      :host(.nostos-button--secondary:hover:not(:disabled)) {
        background: var(--bg-hover);
      }

      :host(.nostos-button--ghost) {
        background: transparent;
        color: var(--color-text-muted);
      }

      :host(.nostos-button--ghost:hover:not(:disabled)) {
        background: var(--bg-hover);
        color: var(--color-text-main);
      }

      :host(.nostos-button--danger) {
        background: transparent;
        color: var(--color-danger);
        border: 1px solid var(--color-danger);
      }

      :host(.nostos-button--danger:hover:not(:disabled)) {
        background: var(--color-danger-bg);
      }

      :host(.nostos-button--sm) {
        padding: 5px 10px;
        font-size: var(--text-xs);
      }
    `,
  ],
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');

  /**
   * Busy is an accessibility/status signal only. It intentionally does not
   * override the native disabled attribute; callers decide whether work in
   * flight should block activation.
   */
  readonly busy = input(false);
}
