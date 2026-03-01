import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  inject,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  LucideAngularModule,
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Edit2,
  Trash2,
  FolderOpen,
  ArrowUp,
} from 'lucide-angular';
import { buildFlatTree, FlatTreeNode } from './flat-tree.helper';

@Component({
  selector: 'app-flat-tree',
  standalone: true,
  imports: [CommonModule, DragDropModule, LucideAngularModule],
  templateUrl: './flat-tree.component.html',
  styleUrls: ['./flat-tree.component.css'],
})
export class FlatTreeComponent {
  private elRef = inject(ElementRef);
  private _items = signal<any[]>([]);

  @Input({ required: true })
  set items(value: any[]) {
    this._items.set(value);
  }

  @Input() activeId: string | null = null;
  @Input() typeField = 'type';

  private _editingId: string | null = null;

  @Input()
  set editingId(value: string | null) {
    this._editingId = value;
    if (value) {
      setTimeout(() => {
        const input = this.elRef.nativeElement.querySelector(
          '.inline-rename-input',
        ) as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      });
    }
  }
  get editingId(): string | null {
    return this._editingId;
  }

  @Output() nodeSelected = new EventEmitter<any>();
  @Output() nodeMoved = new EventEmitter<{ item: any; newParentId: string | null }>();
  @Output() nodeRenamed = new EventEmitter<any>();
  @Output() nodeDeleted = new EventEmitter<string>();
  @Output() nodeRenameSaved = new EventEmitter<{ id: string; newName: string }>();
  @Output() nodeRenameCancelled = new EventEmitter<void>();

  Icons = {
    Folder,
    FolderOpen,
    FileText,
    ChevronRight,
    ChevronDown,
    GripVertical,
    Edit2,
    Trash2,
    ArrowUp,
  };

  expandedIds = signal<Set<string>>(new Set());

  treeNodes = computed(() => {
    return buildFlatTree(this._items(), this.expandedIds(), this.typeField);
  });

  toggleExpand(event: MouseEvent, node: FlatTreeNode) {
    event.stopPropagation();
    if (!node.expandable) return;

    const newSet = new Set(this.expandedIds());
    if (newSet.has(node.id)) {
      newSet.delete(node.id);
    } else {
      newSet.add(node.id);
    }
    this.expandedIds.set(newSet);
  }

  handleSelect(node: FlatTreeNode) {
    // Auto-toggle expand for expandable (folder) nodes
    if (node.expandable) {
      const newSet = new Set(this.expandedIds());
      if (newSet.has(node.id)) {
        newSet.delete(node.id);
      } else {
        newSet.add(node.id);
      }
      this.expandedIds.set(newSet);
    }
    this.nodeSelected.emit(node.originalData);
  }

  onRenameSave(id: string, event: Event) {
    const input = event.target as HTMLInputElement;
    this.nodeRenameSaved.emit({ id, newName: input.value });
  }

  moveToRoot(node: FlatTreeNode, event: Event) {
    event.stopPropagation();
    this.nodeMoved.emit({
      item: node.originalData,
      newParentId: null,
    });
  }

  onDrop(event: CdkDragDrop<FlatTreeNode[]>) {
    const draggedNode = event.item.data as FlatTreeNode;
    const allVisibleNodes = this.treeNodes();
    const targetNode = allVisibleNodes[event.currentIndex];

    // Safety check: If dropped outside a valid row, do nothing.
    if (!targetNode) return;

    if (draggedNode.id === targetNode.id) return;

    let newParentId = targetNode.parentId;

    // Drop ON a folder -> Nest inside
    if (targetNode.type === 'Folder') {
      newParentId = targetNode.id;
      this.expandedIds.update((set) => {
        const s = new Set(set);
        s.add(targetNode.id);
        return s;
      });
    }

    if (draggedNode.parentId === newParentId) return;

    this.nodeMoved.emit({
      item: draggedNode.originalData,
      newParentId: newParentId,
    });
  }
}
