import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
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
import { buildFlatTree, FlatTreeNode, TreeItem } from './flat-tree.helper';

@Component({
  selector: 'app-flat-tree',
  imports: [DragDropModule, LucideAngularModule],
  templateUrl: './flat-tree.component.html',
  styleUrls: ['./flat-tree.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlatTreeComponent {
  readonly items = input.required<TreeItem[]>();
  readonly activeId = input<string | null>(null);
  readonly treatAllAsFolders = input(false);
  readonly editingId = input<string | null>(null);

  readonly nodeSelected = output<TreeItem>();
  readonly nodeMoved = output<{ item: TreeItem; newParentId: string | null }>();
  readonly nodeRenamed = output<TreeItem>();
  readonly nodeDeleted = output<string>();
  readonly nodeRenameSaved = output<{ id: string; newName: string }>();
  readonly nodeRenameCancelled = output<void>();

  protected readonly Icons = {
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

  readonly expandedIds = signal<Set<string>>(new Set());

  private readonly renameInput =
    viewChild<ElementRef<HTMLInputElement>>('renameInput');

  constructor() {
    effect(() => {
      const el = this.renameInput();
      if (el) {
        el.nativeElement.focus();
        el.nativeElement.select();
      }
    });
  }

  readonly treeNodes = computed(() =>
    buildFlatTree(this.items(), this.expandedIds(), this.treatAllAsFolders()),
  );

  private toggleExpandState(nodeId: string): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  toggleExpand(event: MouseEvent, node: FlatTreeNode): void {
    event.stopPropagation();
    if (!node.expandable) return;
    this.toggleExpandState(node.id);
  }

  handleSelect(node: FlatTreeNode): void {
    this.nodeSelected.emit(node.originalData);
  }

  onRenameSave(id: string, event: Event): void {
    const el = event.target as HTMLInputElement;
    this.nodeRenameSaved.emit({ id, newName: el.value });
  }

  moveToRoot(node: FlatTreeNode, event: Event): void {
    event.stopPropagation();
    this.nodeMoved.emit({ item: node.originalData, newParentId: null });
  }

  onDrop(event: CdkDragDrop<FlatTreeNode[]>): void {
    const draggedNode = event.item.data as FlatTreeNode;
    const allVisibleNodes = this.treeNodes();
    const targetNode = allVisibleNodes[event.currentIndex];

    if (!targetNode || draggedNode.id === targetNode.id) return;

    let newParentId = targetNode.parentId;

    if (targetNode.type === 'Folder') {
      newParentId = targetNode.id;
      this.expandedIds.update((set) => {
        const s = new Set(set);
        s.add(targetNode.id);
        return s;
      });
    }

    if (draggedNode.parentId === newParentId) return;

    this.nodeMoved.emit({ item: draggedNode.originalData, newParentId });
  }

  onKeydown(event: KeyboardEvent, node: FlatTreeNode): void {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.handleSelect(node);
        break;
      case 'ArrowRight':
        if (node.expandable && !node.isExpanded) {
          event.preventDefault();
          this.toggleExpandState(node.id);
        }
        break;
      case 'ArrowLeft':
        if (node.expandable && node.isExpanded) {
          event.preventDefault();
          this.toggleExpandState(node.id);
        }
        break;
    }
  }
}
