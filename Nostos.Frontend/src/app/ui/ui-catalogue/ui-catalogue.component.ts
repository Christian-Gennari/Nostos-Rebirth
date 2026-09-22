/**
 * Copyright (C) 2026 Christian Gennari
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Theme, ThemeService } from '../../core/services/theme.service';
import { BadgeComponent } from '../badge/badge.component';
import { ButtonComponent } from '../button/button.component';
import { ChipComponent } from '../chip/chip.component';
import { DialogActionsComponent } from '../dialog-actions/dialog-actions.component';
import { InputDirective, TextareaDirective } from '../form-control/form-control.directive';
import { DropdownComponent, type DropdownOption } from '../dropdown/dropdown.component';
import { FormFieldComponent } from '../form-field/form-field.component';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { ModalShell } from '../modal-shell/modal-shell.component';
import { SwitchComponent } from '../switch/switch.component';

/**
 * Inspectable reference fixture for Nostos UI v1.
 *
 * This is deliberately a lightweight application route rather than Storybook:
 * every example runs inside the same Angular app, token graph and theme service
 * as production surfaces, and Playwright exercises it at the app's desktop and
 * mobile widths.
 */
@Component({
  selector: 'app-ui-catalogue',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    ChipComponent,
    DialogActionsComponent,
    FormFieldComponent,
    IconButtonComponent,
    InputDirective,
    ModalShell,
    DropdownComponent,
    SwitchComponent,
    TextareaDirective,
  ],
  templateUrl: './ui-catalogue.component.html',
  styleUrl: './ui-catalogue.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiCatalogueComponent {
  private readonly themeService = inject(ThemeService);

  readonly theme = this.themeService.theme;
  readonly selectedTab = signal<'primitives' | 'patterns'>('primitives');
  readonly selectedView = signal<'list' | 'grid'>('list');
  readonly modalOpen = signal(false);
  readonly catalogueDropdownValue = signal('epub');
  readonly dropdownOptions = [
    { value: 'epub', label: 'EPUB' },
    { value: 'pdf', label: 'PDF' },
    { value: 'physical', label: 'Physical' },
    { value: 'unavailable', label: 'Unavailable format', disabled: true },
  ] satisfies readonly DropdownOption[];
  readonly longDropdownOptions = Array.from({ length: 18 }, (_, index) => ({
    value: `chapter-${index + 1}`,
    label: `Chapter ${index + 1}`,
  })) satisfies readonly DropdownOption[];

  setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }
}
