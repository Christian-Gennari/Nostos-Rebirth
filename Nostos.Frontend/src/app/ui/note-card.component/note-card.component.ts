import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  MessageSquareQuote,
  Edit2,
  Trash2,
  Check,
  X,
  ArrowRight,
  Library,
  ChevronDown,
  ChevronUp,
} from 'lucide-angular';

import { Note } from '../../dtos/note.dtos';
import { ConceptDto } from '../../services/concepts.services';
import { ConceptInputComponent } from '../concept-input.component/concept-input.component';
import { NoteFormatPipe } from '../pipes/note-format.pipe';

@Component({
  selector: 'app-note-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ConceptInputComponent,
    NoteFormatPipe,
    RouterLink,
  ],
  templateUrl: './note-card.component.html',
  styleUrls: ['./note-card.component.css'],
})
export class NoteCardComponent {
  @Input({ required: true }) note!: Note;
  @Input() conceptMap: Map<string, ConceptDto> = new Map();
  @Input() showNavigation = false;
  @Input() showActions = true;
  @Input() showSource = false;
  @Input() showDate = true;

  @Output() update = new EventEmitter<{ id: string; content: string }>();
  @Output() delete = new EventEmitter<string>();
  @Output() conceptClick = new EventEmitter<string>();
  @Output() quoteClick = new EventEmitter<void>();
  @Output() cardClick = new EventEmitter<void>();

  isEditing = false;
  editContent = '';

  // Collapse logic
  isExpanded = false;
  // Threshold includes both quote + content length
  readonly CHAR_THRESHOLD = 250;

  Icons = {
    MessageSquareQuote,
    Edit: Edit2,
    Delete: Trash2,
    Check,
    Close: X,
    ArrowRight,
    Library,
    ChevronDown,
    ChevronUp,
  };

  get shouldShowExpandBtn(): boolean {
    // If we are editing, we usually don't show the expand button (we show full text in inputs)
    if (this.isEditing) return false;

    const quoteLen = this.note.selectedText?.length || 0;
    const contentLen = this.note.content?.length || 0;
    return quoteLen + contentLen > this.CHAR_THRESHOLD;
  }

  toggleExpand(event: Event) {
    event.stopPropagation();
    this.isExpanded = !this.isExpanded;
  }

  startEdit(event?: Event) {
    event?.stopPropagation();
    this.editContent = this.note.content;
    this.isEditing = true;
    // Auto-expand when editing if you prefer, or handle in template
    this.isExpanded = true;
  }

  cancelEdit(event?: Event) {
    event?.stopPropagation();
    this.isEditing = false;
    this.editContent = '';
    this.isExpanded = false; // Reset to collapsed on cancel
  }

  saveEdit(event?: Event) {
    event?.stopPropagation();
    if (this.editContent.trim() !== this.note.content) {
      this.update.emit({ id: this.note.id, content: this.editContent });
    }
    this.isEditing = false;
    this.isExpanded = false; // Reset on save
  }

  onDelete(event?: Event) {
    event?.stopPropagation();
    this.delete.emit(this.note.id);
  }

  onCardClick(event?: Event) {
    event?.stopPropagation();
    this.cardClick.emit();
  }

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
