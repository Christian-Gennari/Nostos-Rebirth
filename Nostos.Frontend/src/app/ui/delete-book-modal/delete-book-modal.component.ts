import {
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Trash2, Loader2 } from 'lucide-angular';

@Component({
  selector: 'app-delete-book-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './delete-book-modal.component.html',
  styleUrl: './delete-book-modal.component.css',
})
export class DeleteBookModal {
  isOpen = input.required<boolean>();
  bookTitle = input<string | null | undefined>();
  deleting = input<boolean>(false);

  confirm = output<void>();
  cancel = output<void>();

  Trash2Icon = Trash2;
  LoaderIcon = Loader2;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen() && !this.deleting()) {
      this.cancel.emit();
    }
  }

  onBackdropClick(): void {
    if (!this.deleting()) {
      this.cancel.emit();
    }
  }
}
