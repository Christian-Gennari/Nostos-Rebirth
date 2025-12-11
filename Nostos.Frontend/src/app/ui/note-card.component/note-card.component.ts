// Nostos.Frontend/src/app/ui/note-card.component/note-card.component.ts
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

import { Note, UpdateNoteDto } from '../../dtos/note.dtos';
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

  // Updated Output signature to match UpdateNoteDto
  @Output() update = new EventEmitter<{ id: string; content: string; selectedText?: string }>();
  @Output() delete = new EventEmitter<string>();
  @Output() conceptClick = new EventEmitter<string>();
  @Output() quoteClick = new EventEmitter<void>();
  @Output() cardClick = new EventEmitter<void>();

  isEditing = false;
  editContent = '';
  editSelectedText = ''; // <--- New state for editing quote

  // Collapse logic
  isExpanded = false;
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
    this.editSelectedText = this.note.selectedText || ''; // Initialize quote editor
    this.isEditing = true;
    this.isExpanded = true;
  }

  cancelEdit(event?: Event) {
    event?.stopPropagation();
    this.isEditing = false;
    this.editContent = '';
    this.editSelectedText = '';
    this.isExpanded = false;
  }

  saveEdit(event?: Event) {
    event?.stopPropagation();
    const cleanContent = this.editContent.trim();
    const cleanQuote = this.editSelectedText.trim();

    // Check if either field changed
    const contentChanged = cleanContent !== this.note.content;
    const quoteChanged = cleanQuote !== (this.note.selectedText || '');

    if (contentChanged || quoteChanged) {
      this.update.emit({
        id: this.note.id,
        content: cleanContent,
        selectedText: cleanQuote, // Emit the new quote
      });
    }
    this.isEditing = false;
    this.isExpanded = false;
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
