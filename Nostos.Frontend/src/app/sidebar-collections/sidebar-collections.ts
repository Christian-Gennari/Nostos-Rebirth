import { Component, OnInit, inject, signal, model, HostListener } from '@angular/core';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideAngularModule,
  Folder,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Edit2,
  BrainIcon,
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar-collections.html',
  styleUrls: ['./sidebar-collections.css'],
})
export class SidebarCollections implements OnInit {
  private collectionsService = inject(CollectionsService);

  // Icons
  FolderIcon = Folder;
  LibraryIcon = Library;
  PanelLeftCloseIcon = PanelLeftClose;
  PanelLeftOpenIcon = PanelLeftOpen;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  BrainIcon = BrainIcon;

  collections = signal<Collection[]>([]);
  expanded = signal(true);

  // State for Creating/Editing
  adding = signal(false);
  editingId = signal<string | null>(null);
  newName = model<string>('');

  // Helper to prevent immediate closing when clicking the trigger button
  private ignoreClick = false;

  // Access Global Active ID
  activeId = this.collectionsService.activeCollectionId;

  ngOnInit(): void {
    this.load();
  }

  // --- CLICK OUTSIDE LISTENER ---
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    // 1. If we just opened the input (clicked the + or Edit button), ignore this click
    if (this.ignoreClick) {
      this.ignoreClick = false;
      return;
    }

    // 2. If nothing is being edited, do nothing
    if (!this.adding() && !this.editingId()) return;

    // 3. Check if the click target is inside the active input row
    const target = event.target as HTMLElement;
    const isInsideInputRow = target.closest('.nav-item.input-mode');

    // 4. If clicked OUTSIDE the input row, save/close it
    if (!isInsideInputRow) {
      // If adding, check if empty and close
      if (this.adding()) this.resetInput();
      // If editing, cancel or save (depending on preference, usually cancel on click-away)
      if (this.editingId()) this.cancelRename();
    }
  }

  load(): void {
    this.collectionsService.list().subscribe({
      next: (cols) => this.collections.set(cols),
    });
  }

  toggle(): void {
    if (this.expanded()) {
      this.resetInput();
    }
    this.expanded.set(!this.expanded());
  }

  select(id: string | null): void {
    this.collectionsService.activeCollectionId.set(id);
  }

  // --- Create ---
  startAdd(): void {
    this.ignoreClick = true; // <--- Prevent immediate close
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

  // --- Rename ---
  startRename(col: Collection): void {
    this.ignoreClick = true; // <--- Prevent immediate close
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
    if (!confirm('Are you sure? Books in this collection will remain in your library.')) return;
    this.collectionsService.delete(id).subscribe({ next: () => this.load() });
  }
}
