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
  ChevronRight,
  ChevronDown,
  Edit2,
  Trash2,
  GripVertical,
} from 'lucide-angular';
import { Collection } from '../../dtos/collection.dtos';

@Component({
  selector: 'app-collection-tree-item',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, DragDropModule],
  templateUrl: './collection-tree-item.html',
  styleUrls: ['./collection-tree-item.css'],
})
export class CollectionTreeItem {
  @Input({ required: true }) item!: Collection;
  @Input() level = 0;
  @Input() activeId: string | null = null;

  // IDs of all other lists to allow dragging between folders
  @Input() connectedDropLists: string[] = [];

  @Output() selected = new EventEmitter<string>();
  @Output() moved = new EventEmitter<{ item: Collection; newParentId: string | null }>();
  @Output() rename = new EventEmitter<Collection>();
  @Output() delete = new EventEmitter<string>();

  expanded = signal(false);

  // Icons
  Icons = { Folder, FolderOpen, ChevronRight, ChevronDown, Edit2, Trash2, GripVertical };

  toggleExpand(event: MouseEvent) {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  handleSelect(event: MouseEvent) {
    event.stopPropagation();
    this.selected.emit(this.item.id);
  }

  onDrop(event: CdkDragDrop<Collection[]>) {
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
      // The dropped list ID is 'folder-{id}'. The item is now a child of THIS item.
      this.moved.emit({
        item: movedItem,
        newParentId: this.item.id,
      });
    }
  }

  // --- Bubble Up Events from Children ---
  onChildSelected(id: string) {
    this.selected.emit(id);
  }

  onChildMoved(event: { item: Collection; newParentId: string | null }) {
    this.moved.emit(event);
  }

  onChildRename(col: Collection) {
    this.rename.emit(col);
  }

  onChildDelete(id: string) {
    this.delete.emit(id);
  }
}
