import { Component, OnInit, inject, signal, model, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
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

import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
// 👇 CHANGED: Import the new Flat Tree Component
import { FlatTreeComponent } from '../ui/flat-tree/flat-tree.component';

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    RouterLinkActive,
    FlatTreeComponent, // 👈 CHANGED: Use FlatTreeComponent
  ],
  templateUrl: './sidebar-collections.html',
  styleUrls: ['./sidebar-collections.css'],
})
export class SidebarCollections implements OnInit {
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

  ngOnInit(): void {
    // REMOVED: TreeDragService registration
    this.load();
    if (window.innerWidth < 768) {
      this.expanded.set(false);
    }
  }

  // REMOVED: ngOnDestroy (no longer needed)

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

  startRename(item: any): void {
    this.ignoreClick = true;
    this.editingId.set(item.id);
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

  // 👇 ADDED: Helper for the HTML template renaming input
  getNameForId(id: string): string {
    return this.collections().find((c) => c.id === id)?.name || '';
  }

  // REMOVED: onRootDrop()

  // 👇 UPDATED: Matches FlatTreeComponent event signature
  onItemMoved(event: { item: any; newParentId: string | null }) {
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
