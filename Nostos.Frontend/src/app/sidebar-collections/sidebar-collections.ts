import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  model,
  HostListener,
  computed,
} from '@angular/core';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TreeNodeComponent } from '../ui/tree-node/tree-node.component';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  DragDropModule,
  CdkDropList,
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import {
  LucideAngularModule,
  Folder,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Edit2,
  BrainCircuit,
  Menu,
  PenTool,
  Heart,
  BookOpen,
  CheckCircle,
  Inbox,
} from 'lucide-angular';
import { TreeDragService } from '../ui/tree-node/tree-drag.service'; // Import the service

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    RouterLinkActive,
    DragDropModule,
    TreeNodeComponent,
  ],
  templateUrl: './sidebar-collections.html',
  styleUrls: ['./sidebar-collections.css'],
})
export class SidebarCollections implements OnInit, OnDestroy {
  private collectionsService = inject(CollectionsService);
  private treeDragService = inject(TreeDragService); // Inject Registry
  private router = inject(Router);

  FolderIcon = Folder;
  LibraryIcon = Library;
  PanelLeftCloseIcon = PanelLeftClose;
  PanelLeftOpenIcon = PanelLeftOpen;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  BrainIcon = BrainCircuit;
  MenuIcon = Menu;
  PenToolIcon = PenTool;
  HeartIcon = Heart;
  BookOpenIcon = BookOpen;
  CheckCircleIcon = CheckCircle;
  InboxIcon = Inbox;

  collections = signal<Collection[]>([]);
  expanded = this.collectionsService.sidebarExpanded;
  adding = signal(false);
  editingId = signal<string | null>(null);
  collapseSidebarProgress = signal(false);
  newName = model<string>('');
  private ignoreClick = false;
  activeId = this.collectionsService.activeCollectionId;

  // CONNECT TO SERVICE: Use global list instead of local array
  connectedDropLists = this.treeDragService.dropListIds;

  ngOnInit(): void {
    // Register the root list ID
    this.treeDragService.register('root-list');

    this.load();
    if (window.innerWidth < 768) {
      this.expanded.set(false);
    }
  }

  ngOnDestroy(): void {
    // Clean up
    this.treeDragService.unregister('root-list');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.ignoreClick) {
      this.ignoreClick = false;
      return;
    }
    if (!this.adding() && !this.editingId()) return;

    const target = event.target as HTMLElement;
    const isInsideInputRow = target.closest('.nav-item.input-mode');

    if (!isInsideInputRow) {
      if (this.adding()) this.resetInput();
      if (this.editingId()) this.cancelRename();
    }
  }

  load(): void {
    this.collectionsService.list().subscribe({
      next: (cols) => this.collections.set(cols),
    });
  }

  toggle(): void {
    const isCurrentlyExpanded = this.expanded();
    if (isCurrentlyExpanded) {
      this.collapseSidebarProgress.set(true);
      setTimeout(() => this.collapseSidebarProgress.set(false), 200);
    }
    this.expanded.set(!isCurrentlyExpanded);
  }

  select(id: string | null): void {
    this.collectionsService.activeCollectionId.set(id);
    this.router.navigate(['/library']);
    if (window.innerWidth < 768) {
      this.expanded.set(false);
    }
  }

  startAdd(): void {
    this.ignoreClick = true;
    this.adding.set(true);
    if (!this.expanded()) this.expanded.set(true);
  }

  resetInput(): void {
    this.adding.set(false);
    this.newName.set('');
    this.editingId.set(null);
  }

  create(): void {
    const name = this.newName().trim();
    if (!name) {
      this.resetInput();
      return;
    }
    this.collectionsService.create({ name }).subscribe({
      next: (newCol) => {
        this.resetInput();
        this.load();
        this.select(newCol.id);
      },
    });
  }

  startRename(col: Collection): void {
    this.ignoreClick = true;
    this.editingId.set(col.id);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  saveRename(id: string, newName: string): void {
    if (!newName.trim()) {
      this.cancelRename();
      return;
    }
    this.collectionsService.update(id, { name: newName }).subscribe({
      next: () => {
        this.editingId.set(null);
        this.load();
      },
    });
  }

  deleteCollection(id: string): void {
    if (!confirm('Delete this collection?')) return;
    this.collectionsService.delete(id).subscribe({ next: () => this.load() });
  }

  onRootDrop(event: CdkDragDrop<Collection[]>) {
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
      this.moveCollection(movedItem, null);
    }
  }

  onItemMoved(event: { item: Collection; newParentId: string | null }) {
    this.moveCollection(event.item, event.newParentId);
  }

  moveCollection(item: Collection, newParentId: string | null) {
    if (item.parentId === newParentId) return;

    this.collectionsService
      .update(item.id, {
        name: item.name,
        parentId: newParentId,
      })
      .subscribe({
        next: () => this.load(),
        error: () => this.load(),
      });
  }
}
