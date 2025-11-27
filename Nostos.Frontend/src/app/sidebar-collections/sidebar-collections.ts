import { Component, OnInit, inject, signal, model } from '@angular/core';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Folder,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2, // <--- Import
  Edit2, // <--- Import
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [CommonModule, FormsModule, LucideAngularModule],
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

  collections = signal<Collection[]>([]);
  expanded = signal(true);

  // State for Creating
  adding = signal(false);
  newName = model<string>('');

  // State for Renaming
  editingId = signal<string | null>(null);

  // Access Global Active ID
  activeId = this.collectionsService.activeCollectionId;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.collectionsService.list().subscribe({
      next: (cols) => this.collections.set(cols),
    });
  }

  toggle(): void {
    this.expanded.set(!this.expanded());
  }

  select(id: string | null): void {
    this.collectionsService.activeCollectionId.set(id);
  }

  // --- Create ---
  startAdd(): void {
    this.adding.set(true);
    // Auto-expand if collapsed to show input
    if (!this.expanded()) this.expanded.set(true);
  }

  create(): void {
    const name = this.newName().trim();
    if (!name) return;

    this.collectionsService.create({ name }).subscribe({
      next: (newCol) => {
        this.newName.set('');
        this.adding.set(false);
        this.load();
        this.select(newCol.id); // Auto-select new
      },
    });
  }

  // --- Rename ---
  startRename(col: Collection): void {
    this.editingId.set(col.id);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  saveRename(id: string, newName: string): void {
    if (!newName.trim()) return;

    this.collectionsService.update(id, { name: newName }).subscribe({
      next: () => {
        this.editingId.set(null);
        this.load();
      },
    });
  }

  // --- Delete ---
  deleteCollection(id: string): void {
    if (!confirm('Are you sure? Books in this collection will remain in your library.')) return;

    this.collectionsService.delete(id).subscribe({
      next: () => this.load(),
    });
  }
}
