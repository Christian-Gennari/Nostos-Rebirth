import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Book, Download } from 'lucide-angular';
import { ModalShell } from '../ui/modal-shell/modal-shell.component';

/**
 * The question Add Book should have asked first: is this book coming from
 * somewhere, or are you typing it in?
 *
 * It matters because the answer decides what the user needs next. Importing ends
 * at a prefilled form; adding by hand starts at an empty one. Handing someone 21
 * fields and a provider tab before knowing which of those they want makes them
 * find their own way to the right door.
 */
@Component({
  selector: 'app-add-book-intent',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, ModalShell],
  templateUrl: './add-book-intent.component.html',
  styleUrl: './add-book-intent.component.css',
})
export class AddBookIntent {
  isOpen = input.required<boolean>();

  /** Add an empty book by hand. */
  manual = output<void>();

  /** Find the book at a source and import it. */
  source = output<void>();

  cancel = output<void>();

  BookIcon = Book;
  DownloadIcon = Download;
}
