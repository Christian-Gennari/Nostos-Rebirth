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
        <lucide-icon [img]="LibraryIcon" [size]="22" strokeWidth="2"></lucide-icon>
        <span class="label">Library</span>
      </a>

      <a
        routerLink="/second-brain"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="The Brain"
      >
        <lucide-icon [img]="BrainIcon" [size]="22" strokeWidth="2"></lucide-icon>
        <span class="label">Brain</span>
      </a>

      <a
        routerLink="/studio"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="Writing Studio"
      >
        <lucide-icon [img]="PenToolIcon" [size]="22" strokeWidth="2"></lucide-icon>
        <span class="label">Studio</span>
      </a>
    </nav>
  `,
  styles: [
    `
      /* --- DESKTOP: Floating Pill --- */
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
        gap: 0.35rem;
        padding: 0.4rem;

        /* Glass Effect */
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);

        /* Brand Border */
        border: 1px solid var(--border-color);

        border-radius: 0.5rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 10px 15px -3px rgba(0, 0, 0, 0.08);
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
      }

      .dock-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        width: 34px;
        height: 29px;
        padding: 1.7rem;
        border-radius: 0.5rem;
        color: var(--color-text-muted);
        text-decoration: none;
        font-family: 'Inter', sans-serif;
        transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
        position: relative;
      }

      .dock-item:hover {
        background: var(--bg-hover, rgba(0, 0, 0, 0.04));
        color: var(--color-text-main);
        transform: translateY(-2px);
      }

      .dock-item.active {
        background: var(--color-primary);
        color: #fff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transform: translateY(-2px);
      }

      .dock-item.active lucide-icon {
        stroke-width: 2.5px;
      }

      .label {
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.02em;
      }

      /* --- MOBILE: Fixed Bottom Bar --- */
      @media (max-width: 768px) {
        :host {
          bottom: 0;
          left: 0;
          transform: none; /* Reset center transform */
          width: 100%; /* Full width */
        }

        .app-dock {
          width: 100%;
          border-radius: 0; /* Remove pill radius */
          border: none;
          border-top: 1px solid var(--border-color); /* Only top border */

          /* Solid background usually looks cleaner on bottom bars */
          background: rgba(255, 255, 255, 0.96);

          /* Native App Tab Bar Spacing */
          justify-content: space-evenly;
          gap: 0;

          /* Safe Area Padding for iPhone */
          padding: 8px 16px;
          padding-bottom: max(8px, env(safe-area-inset-bottom));

          box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.03);
        }

        .dock-item {
          width: auto;
          flex: 1; /* Stretch to fill space */
          height: auto;
          padding: 8px 0;
          border-radius: 0.5rem; /* Softer radius for touch feedback */
        }

        /* Remove desktop hover lift on touch devices */
        .dock-item:hover,
        .dock-item.active {
          transform: none;
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
    this.collectionsService.activeCollectionId.set(null);
  }
}
