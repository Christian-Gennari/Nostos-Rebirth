import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
} from 'lucide-angular';
import { WritingDto } from '../../dtos/writing.dtos';

@Component({
  selector: 'app-file-tree-item',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './file-tree-item.html',
  styleUrls: ['./file-tree-item.css'],
})
export class FileTreeItem {
  @Input({ required: true }) item!: WritingDto;
  @Input() activeId: string | null = null;
  @Input() level = 0; // For indentation logic

  @Output() itemSelected = new EventEmitter<WritingDto>();

  // State
  expanded = signal(false);

  // Icons
  Icons = {
    Folder,
    FolderOpen,
    FileText,
    ChevronRight,
    ChevronDown,
  };

  toggleExpand(event: MouseEvent) {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  handleSelect(event: MouseEvent) {
    event.stopPropagation();
    this.itemSelected.emit(this.item);

    // Auto-expand folder on click if it's not already
    if (this.item.type === 'Folder') {
      this.expanded.set(true);
    }
  }

  // Pass selection events from children up to the parent
  onChildSelected(child: WritingDto) {
    this.itemSelected.emit(child);
  }
}
