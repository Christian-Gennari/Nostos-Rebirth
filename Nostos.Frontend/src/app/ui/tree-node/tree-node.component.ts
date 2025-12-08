import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
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
import { TreeDragService } from './tree-drag.service';

@Component({
  selector: 'app-tree-node',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, DragDropModule],
  templateUrl: './tree-node.component.html',
  styleUrls: ['./tree-node.component.css'],
})
export class TreeNodeComponent implements OnInit, OnDestroy {
  private treeDragService = inject(TreeDragService);

  @Input({ required: true }) item!: TreeNode;
  @Input() level = 0;
  @Input() activeId: string | null = null;
  // REMOVED: @Input() connectedDropLists

  // --- Configuration Inputs ---
  @Input() editable = false;
  @Input() expandOnSelect = false;

  // --- Outputs ---
  @Output() nodeSelected = new EventEmitter<TreeNode>();
  @Output() nodeMoved = new EventEmitter<TreeNodeMoveEvent>();
  @Output() nodeRenamed = new EventEmitter<TreeNode>();
  @Output() nodeDeleted = new EventEmitter<string>();

  expanded = signal(false);

  // Icons registry
  Icons = { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, GripVertical, Edit2, Trash2 };

  isFolder = computed(() => !this.item.type || this.item.type === 'Folder');

  // --- ID Getters ---
  // We define these as getters to ensure consistency between registration and template
  get folderDropId() {
    return 'folder-drop-' + this.item.id;
  }
  get childrenDropId() {
    return 'folder-' + this.item.id;
  }

  // Connect directly to the global service.
  // No recursion = No thrashing = Stable Drag & Drop.
  connectedLists = this.treeDragService.dropListIds;

  ngOnInit() {
    if (this.isFolder()) {
      // Register both the "drop ON folder" and "drop IN folder" lists
      this.treeDragService.register(this.folderDropId);
      this.treeDragService.register(this.childrenDropId);
    }
  }

  ngOnDestroy() {
    // Cleanup to prevent memory leaks or "ghost" targets
    if (this.isFolder()) {
      this.treeDragService.unregister(this.folderDropId);
      this.treeDragService.unregister(this.childrenDropId);
    }
  }

  toggleExpand(event: MouseEvent) {
    event.stopPropagation();
    if (this.isFolder()) {
      this.expanded.update((v) => !v);
    }
  }

  handleSelect(event: MouseEvent) {
    event.stopPropagation();
    this.nodeSelected.emit(this.item);

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

  // Handle dropping directly onto a folder row
  onFolderDrop(event: CdkDragDrop<TreeNode>) {
    // Safety check
    if (!event.previousContainer.data || !Array.isArray(event.previousContainer.data)) return;

    const draggedItem = event.previousContainer.data[event.previousIndex];

    // Remove from previous location
    event.previousContainer.data.splice(event.previousIndex, 1);

    // Add to this folder's children
    this.item.children.push(draggedItem);

    // Emit the move event
    this.nodeMoved.emit({
      item: draggedItem,
      newParentId: this.item.id,
    });

    // Auto-expand to show the dropped item
    this.expanded.set(true);
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
