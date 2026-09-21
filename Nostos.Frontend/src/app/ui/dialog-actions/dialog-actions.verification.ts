import { Component } from '@angular/core';

import { AddBookModal } from '../../add-book-modal/add-book-modal.component';
import { Book } from '../../core/services/books.service';
import { ConfirmModal } from '../confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-dialog-actions-verification',
  standalone: true,
  imports: [AddBookModal, ConfirmModal],
  template: `
    @if (mode === 'confirm') {
      <app-confirm-modal
        [isOpen]="true"
        heading="Delete this unusually long-titled verification book from Nostos?"
        [description]="longDescription"
        confirmLabel="Delete Permanently"
        busyLabel="Deleting…"
        tone="danger"
      />
    }

    @if (mode === 'add') {
      <app-add-book-modal [isOpen]="true" [collections]="[]" />
    }

    @if (mode === 'edit') {
      <app-add-book-modal [isOpen]="true" [collections]="[]" [book]="editBook" />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: var(--bg-surface);
      }
    `,
  ],
})
export class DialogActionsVerificationHarness {
  readonly mode = new URLSearchParams(window.location.search).get('mode') ?? 'confirm';

  readonly longDescription =
    'This action cannot be undone. '.repeat(18) +
    'The long copy intentionally exercises the scrolling body while the ordinary actions remain pinned and reachable.';

  readonly editBook = {
    id: 'verify-edit-book',
    title: 'The Verification Book',
    author: 'Nostos',
    type: 'physical',
    collectionIds: [],
  } as unknown as Book;
}
