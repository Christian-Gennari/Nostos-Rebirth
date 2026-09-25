import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalShell } from '../ui/modal-shell/modal-shell.component';
import { NostosIconComponent } from '../ui/icon/nostos-icon.component';
import { ButtonComponent } from '../ui/button/button.component';

/**
 * Add Book starts with acquisition: how is the reader giving Nostos this book?
 *
 * The answer decides which focused surface should come next. Rich bibliographic
 * metadata belongs after acquisition/identification, not in front of it.
 */
@Component({
  selector: 'app-add-book-intent',
  standalone: true,
  imports: [CommonModule, NostosIconComponent, ModalShell, ButtonComponent],
  templateUrl: './add-book-intent.component.html',
  styleUrl: './add-book-intent.component.css',
})
export class AddBookIntent {
  isOpen = input.required<boolean>();

  /** Choose a supported local ebook/audiobook file. */
  upload = output<void>();

  /** Find free reading material through the unified provider discovery flow. */
  source = output<void>();

  /** Identify a physical book, led by ISBN lookup. */
  physical = output<void>();

  /** Create a metadata record without file/source/identifier acquisition. */
  manual = output<void>();

  cancel = output<void>();
}
