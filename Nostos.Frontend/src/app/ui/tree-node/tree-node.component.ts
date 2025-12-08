import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
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
  Edit2,
  Trash2,
} from 'lucide-angular';
import { TreeNode, TreeNodeMoveEvent } from './tree-node.interface';

@Component({
  selector: 'app-tree-node',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, DragDropModule],
  templateUrl: './tree-node.component.html',
  styleUrls: ['./tree-node.component.css'],
})
export class TreeNodeComponent {
  @Input({ required: true }) item!: TreeNode;
  @Input() level = 0;
  @Input() activeId: string | null = null;
  @Input() connectedDropLists: string[] = [];

  // --- Configuration Inputs ---
  @Input() editable = false; // Shows Edit/Delete buttons (For Collections)
  @Input() expandOnSelect = false; // Auto-expand folders on click (For Writing Studio)

  // --- Outputs ---
  @Output() nodeSelected = new EventEmitter<TreeNode>();
  @Output() nodeMoved = new EventEmitter<TreeNodeMoveEvent>();
  @Output() nodeRenamed = new EventEmitter<TreeNode>();
  @Output() nodeDeleted = new EventEmitter<string>();

  expanded = signal(false);

  // Icons registry
  Icons = { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, GripVertical, Edit2, Trash2 };

  // Helper to determine if current node is a folder
  isFolder = computed(() => !this.item.type || this.item.type === 'Folder');

  toggleExpand(event: MouseEvent) {
    event.stopPropagation();
    if (this.isFolder()) {
      this.expanded.update((v) => !v);
    }
  }

  handleSelect(event: MouseEvent) {
    event.stopPropagation();
    this.nodeSelected.emit(this.item);

    // Writing Studio behavior: expand folder when selected
    if (this.expandOnSelect && this.isFolder()) {
      this.expanded.set(true);
    }
  }

  onDrop(event: CdkDragDrop<TreeNode[]>) {
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
      this.nodeMoved.emit({
        item: movedItem,
        newParentId: this.item.id,
      });
    }
  }

  // --- Bubble Up Events ---
  onChildSelected(node: TreeNode) {
    this.nodeSelected.emit(node);
  }

  onChildMoved(event: TreeNodeMoveEvent) {
    this.nodeMoved.emit(event);
  }

  onChildRenamed(node: TreeNode) {
    this.nodeRenamed.emit(node);
  }

  onChildDeleted(id: string) {
    this.nodeDeleted.emit(id);
  }
}
