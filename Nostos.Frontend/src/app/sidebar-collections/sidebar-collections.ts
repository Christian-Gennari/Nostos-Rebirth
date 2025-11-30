import { Component, OnInit, inject, signal, model, HostListener, computed } from '@angular/core'; // ADD 'computed'
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router'; // <--- Import Router
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
  private router = inject(Router); // <--- Inject Router

  // Icons
  FolderIcon = Folder;
  LibraryIcon = Library;
  PanelLeftCloseIcon = PanelLeftClose;
  PanelLeftOpenIcon = PanelLeftOpen;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  BrainIcon = BrainCircuit;

  collections = signal<Collection[]>([]);

  expanded = this.collectionsService.sidebarExpanded;

  // State for Creating/Editing
  adding = signal(false);
  editingId = signal<string | null>(null);
  collapseSidebarProgress = signal(false);

  newName = model<string>('');

  private ignoreClick = false;

  // Access Global Active ID
  activeId = this.collectionsService.activeCollectionId;

  // NEW: Computed property to fix double highlight (Request 1)

  ngOnInit(): void {
    this.load();
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

    // Only trigger collapseProgress when collapsing
    if (isCurrentlyExpanded) {
      this.collapseSidebarProgress.set(true);
      setTimeout(() => this.collapseSidebarProgress.set(false), 200);
    }

    this.expanded.set(!isCurrentlyExpanded);
  }

  select(id: string | null): void {
    this.collectionsService.activeCollectionId.set(id);
    this.router.navigate(['/library']);
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
    if (!confirm('Are you sure? Books in this collection will remain in your library.')) return;
    this.collectionsService.delete(id).subscribe({ next: () => this.load() });
  }
}
