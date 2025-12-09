import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule, Library, BrainCircuit, PenTool } from 'lucide-angular';
import { CollectionsService } from '../../services/collections.services';

@Component({
  standalone: true,
  selector: 'app-app-dock',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <nav class="app-dock">
      <a
        routerLink="/library"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="Library"
      >
        <lucide-icon [img]="LibraryIcon" [size]="24" strokeWidth="2"></lucide-icon>
        <span class="label">Library</span>
      </a>

      <div class="divider"></div>

      <a
        routerLink="/second-brain"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="The Brain"
      >
        <lucide-icon [img]="BrainIcon" [size]="24" strokeWidth="2"></lucide-icon>
        <span class="label">Brain</span>
      </a>

      <a
        routerLink="/studio"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="Writing Studio"
      >
        <lucide-icon [img]="PenToolIcon" [size]="24" strokeWidth="2"></lucide-icon>
        <span class="label">Studio</span>
      </a>
    </nav>
  `,
  styles: [
    `
      :host {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
      }

      .app-dock {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 999px; /* Pill shape */
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06),
          0 12px 24px -8px rgba(0, 0, 0, 0.15);
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
      }

      .dock-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        width: 64px;
        height: 56px;
        border-radius: 16px;
        color: #666;
        text-decoration: none;
        transition: all 0.2s ease;
        position: relative;
      }

      .dock-item:hover {
        background: rgba(0, 0, 0, 0.05);
        color: #000;
        transform: translateY(-2px);
      }

      .dock-item.active {
        color: var(--color-primary, #000);
        background: rgba(0, 0, 0, 0.08);
      }

      .dock-item.active lucide-icon {
        stroke-width: 2.5px;
      }

      .label {
        font-size: 0.7rem;
        font-weight: 500;
      }

      .divider {
        width: 1px;
        height: 24px;
        background: rgba(0, 0, 0, 0.1);
        margin: 0 4px;
      }

      /* Mobile: Make it slightly more compact if needed */
      @media (max-width: 768px) {
        :host {
          bottom: 20px;
        }
        .app-dock {
          padding: 0.4rem 0.6rem;
        }
        .dock-item {
          width: 56px;
          height: 50px;
        }
        .label {
          font-size: 0.65rem;
        }
      }
    `,
  ],
})
export class AppDockComponent {
  private collectionsService = inject(CollectionsService);

  LibraryIcon = Library;
  BrainIcon = BrainCircuit;
  PenToolIcon = PenTool;

  resetCollection() {
    // Clear selected collection when switching main apps
    this.collectionsService.activeCollectionId.set(null);
  }
}
