import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DragDropModule,
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import {
  LucideAngularModule,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  GripVertical,
} from 'lucide-angular';
import { WritingDto } from '../../dtos/writing.dtos';

@Component({
  selector: 'app-file-tree-item',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, DragDropModule],
  templateUrl: './file-tree-item.html',
  styleUrls: ['./file-tree-item.css'],
})
export class FileTreeItem {
  @Input({ required: true }) item!: WritingDto;
  @Input() activeId: string | null = null;
  @Input() level = 0;

  // Important: Receive all connected IDs so we can drag INTO this folder
  @Input() connectedDropLists: string[] = [];

  @Output() itemSelected = new EventEmitter<WritingDto>();
  @Output() itemMoved = new EventEmitter<{ item: WritingDto; newParentId: string | null }>();

  expanded = signal(false);

  Icons = { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, GripVertical };

  toggleExpand(event: MouseEvent) {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  handleSelect(event: MouseEvent) {
    this.itemSelected.emit(this.item);
    if (this.item.type === 'Folder') {
      this.expanded.set(true);
    }
  }

  onDrop(event: CdkDragDrop<WritingDto[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );

      const movedItem = event.container.data[event.currentIndex];
      // This list's ID is "folder-{this.item.id}"
      this.itemMoved.emit({
        item: movedItem,
        newParentId: this.item.id,
      });
    }
  }

  // Bubble up events
  onChildSelected(child: WritingDto) {
    this.itemSelected.emit(child);
  }

  onChildMoved(event: { item: WritingDto; newParentId: string | null }) {
    this.itemMoved.emit(event);
  }
}
