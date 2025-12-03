import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, MessageSquareQuote, Edit2, Trash2, Check, X } from 'lucide-angular';

import { Note } from '../../dtos/note.dtos';
import { ConceptDto } from '../../services/concepts.services';
import { ConceptInputComponent } from '../concept-input.component/concept-input.component';
import { NoteFormatPipe } from '../pipes/note-format.pipe';

@Component({
  selector: 'app-note-card',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ConceptInputComponent, NoteFormatPipe],
  templateUrl: './note-card.component.html',
  styleUrls: ['./note-card.component.css'],
})
export class NoteCardComponent {
  @Input({ required: true }) note!: Note;
  @Input() conceptMap: Map<string, ConceptDto> = new Map();

  // Events for the parent to handle the actual API calls
  @Output() update = new EventEmitter<{ id: string; content: string }>();
  @Output() delete = new EventEmitter<string>();
  @Output() conceptClick = new EventEmitter<string>();
  @Output() quoteClick = new EventEmitter<void>();

  // Internal state for editing
  isEditing = false;
  editContent = '';

  // Icons
  Icons = { MessageSquareQuote, Edit: Edit2, Delete: Trash2, Check, Close: X };

  startEdit(event?: Event) {
    event?.stopPropagation();
    this.editContent = this.note.content;
    this.isEditing = true;
  }

  cancelEdit(event?: Event) {
    event?.stopPropagation();
    this.isEditing = false;
    this.editContent = '';
  }

  saveEdit(event?: Event) {
    event?.stopPropagation();
    if (this.editContent.trim() !== this.note.content) {
      this.update.emit({ id: this.note.id, content: this.editContent });
    }
    this.isEditing = false;
  }

  onDelete(event?: Event) {
    event?.stopPropagation();
    this.delete.emit(this.note.id);
  }

  // Handle clicks on the formatted HTML (concepts)
  onContentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.classList.contains('concept-tag')) {
      const id = target.getAttribute('data-concept-id');
      if (id) {
        event.preventDefault();
        event.stopPropagation();
        this.conceptClick.emit(id);
      }
    }
  }
}
