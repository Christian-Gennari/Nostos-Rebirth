import { Component, OnInit, inject, signal, model, HostListener, computed } from '@angular/core';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  DragDropModule,
  CdkDropList,
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop'; // Import DragDrop
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

// NEW IMPORT
import { CollectionTreeItem } from './collection-tree-item/collection-tree-item';

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    RouterLinkActive,
    DragDropModule, // Add this
    CollectionTreeItem, // Add this
  ],
  templateUrl: './sidebar-collections.html',
  styleUrls: ['./sidebar-collections.css'],
})
export class SidebarCollections implements OnInit {
  // ... (Icons and State remain the same as before) ...
  private collectionsService = inject(CollectionsService);
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

  // Compute connected drop lists: 'root-list' + 'folder-{id}' for every folder
  connectedDropLists = computed(() => {
    const ids = ['root-list'];
    const traverse = (items: Collection[]) => {
      for (const item of items) {
        ids.push(`folder-${item.id}`);
        if (item.children) traverse(item.children);
      }
    };
    traverse(this.collections());
    return ids;
  });

  ngOnInit(): void {
    this.load();
    if (window.innerWidth < 768) {
      this.expanded.set(false);
    }
  }

  // ... (HostListener, toggle, startAdd, resetInput, create, deleteCollection... KEEP THESE) ...

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

  // --- NEW: Drag & Drop Handlers ---

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
      // Moved to Root (ParentId = null)
      const movedItem = event.container.data[event.currentIndex];
      this.moveCollection(movedItem, null);
    }
  }

  onItemMoved(event: { item: Collection; newParentId: string | null }) {
    this.moveCollection(event.item, event.newParentId);
  }

  moveCollection(item: Collection, newParentId: string | null) {
    // If we dropped it in the same place, ignore
    if (item.parentId === newParentId) return;

    // Optimistic Update
    // (Note: To do a true optimistic update with recursion is complex,
    // simply reloading after API call is safer for now)

    this.collectionsService
      .update(item.id, {
        name: item.name,
        parentId: newParentId,
      })
      .subscribe({
        next: () => this.load(),
        error: () => this.load(), // Revert on error
      });
  }
}
