/**
 * Copyright (C) 2026 Christian Gennari
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Directive, input } from '@angular/core';

export type FormControlSize = 'normal' | 'compact';

/**
 * Canonical Nostos single-line native input.
 *
 * The directive keeps the native input host so type, name, autocomplete,
 * validation, ngModel and accessibility attributes remain caller-owned.
 */
@Directive({
  selector: 'input[appInput]',
  standalone: true,
  host: {
    class: 'nostos-form-control nostos-form-control--input',
    '[class.nostos-form-control--compact]': "size() === 'compact'",
    '[attr.aria-invalid]': "invalid() ? 'true' : null",
  },
})
export class InputDirective {
  readonly size = input<FormControlSize>('normal');
  readonly invalid = input(false);
}

/**
 * Canonical Nostos multi-line native textarea.
 */
@Directive({
  selector: 'textarea[appTextarea]',
  standalone: true,
  host: {
    class: 'nostos-form-control nostos-form-control--textarea',
    '[class.nostos-form-control--compact]': "size() === 'compact'",
    '[attr.aria-invalid]': "invalid() ? 'true' : null",
  },
})
export class TextareaDirective {
  readonly size = input<FormControlSize>('normal');
  readonly invalid = input(false);
}

/**
 * Canonical Nostos native select.
 */
@Directive({
  selector: 'select[appSelect]',
  standalone: true,
  host: {
    class: 'nostos-form-control nostos-form-control--select',
    '[class.nostos-form-control--compact]': "size() === 'compact'",
    '[attr.aria-invalid]': "invalid() ? 'true' : null",
  },
})
export class SelectDirective {
  readonly size = input<FormControlSize>('normal');
  readonly invalid = input(false);
}
