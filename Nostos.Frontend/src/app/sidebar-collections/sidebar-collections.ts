import { Component, OnInit, inject, signal, model, HostListener, ElementRef } from '@angular/core';
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
  Menu,
  Heart,
  BookOpen,
  CheckCircle,
  Inbox,
} from 'lucide-angular';

import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
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
    FlatTreeComponent,
  ],
  templateUrl: './sidebar-collections.html',
  styleUrls: ['./sidebar-collections.css'],
})
export class SidebarCollections implements OnInit {
  private collectionsService = inject(CollectionsService);
  private router = inject(Router);
  private elementRef = inject(ElementRef);

  // Icons
  FolderIcon = Folder;
  LibraryIcon = Library;
  PanelLeftCloseIcon = PanelLeftClose;
  PanelLeftOpenIcon = PanelLeftOpen;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  MenuIcon = Menu;
  HeartIcon = Heart;
  BookOpenIcon = BookOpen;
  CheckCircleIcon = CheckCircle;
  InboxIcon = Inbox;

  // State
  collections = signal<Collection[]>([]);
  expanded = this.collectionsService.sidebarExpanded;
  adding = signal(false);
  editingId = signal<string | null>(null);
  collapseSidebarProgress = signal(false);
  newName = model<string>('');
  private ignoreClick = false;
  activeId = this.collectionsService.activeCollectionId;

  // NEW: State to control initial animation
  isLoaded = signal(false);

  ngOnInit(): void {
    this.load();
    if (window.innerWidth < 768) {
      this.expanded.set(false);
    }

    // NEW: Set isLoaded to true after a minimal timeout
    setTimeout(() => {
      this.isLoaded.set(true);
    }, 0);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.ignoreClick) {
      this.ignoreClick = false;
      return;
    }

    const target = event.target as HTMLElement;

    // Mobile: Close sidebar if clicking outside
    if (window.innerWidth < 768 && this.expanded()) {
      const clickedInside = this.elementRef.nativeElement.contains(target);
      if (!clickedInside) {
        this.expanded.set(false);
        // If the sidebar is closed via outside click, we can return early
        return;
      }
    }

    if (!this.adding() && !this.editingId()) return;

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

  getNameForId(id: string): string {
    return this.collections().find((c) => c.id === id)?.name || '';
  }

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
