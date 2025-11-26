import { Component, OnInit, inject, signal, model } from '@angular/core';
import { CollectionsService } from '../services/collections.services';
import { Collection } from '../dtos/collection.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-collections.html',
  styleUrls: ['./sidebar-collections.css'],
})
export class SidebarCollections implements OnInit {
  private collectionsService = inject(CollectionsService);

  collections = signal<Collection[]>([]);
  expanded = signal(true); // collapsible sidebar
  adding = signal(false);
  newName = model<string>('');

  activeCollection = signal<string | null>(null);

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

  startAdd(): void {
    this.adding.set(true);
  }

  create(): void {
    const name = this.newName().trim();
    if (!name) return;

    this.collectionsService.create({ name }).subscribe({
      next: () => {
        this.newName.set('');
        this.adding.set(false);
        this.load();
      },
    });
  }

  select(collection: Collection): void {
    const id = collection.id;
    this.activeCollection.set(id);
  }
}
