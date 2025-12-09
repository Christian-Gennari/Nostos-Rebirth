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
        <lucide-icon [img]="LibraryIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
        <span class="label">Library</span>
      </a>

      <a
        routerLink="/second-brain"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="The Brain"
      >
        <lucide-icon [img]="BrainIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
        <span class="label">Brain</span>
      </a>

      <a
        routerLink="/studio"
        routerLinkActive="active"
        (click)="resetCollection()"
        class="dock-item"
        title="Writing Studio"
      >
        <lucide-icon [img]="PenToolIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
        <span class="label">Studio</span>
      </a>
    </nav>
  `,
  styles: [
    `
      /* --- DESKTOP: Minimal Floating --- */
      :host {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
      }

      .app-dock {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px;

        /* Subtle glass effect */
        background: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);

        /* Minimal border */
        border: 1px solid rgba(0, 0, 0, 0.06);

        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06);
        transition: all 0.2s ease;
      }

      .app-dock:hover {
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.08);
      }

      .dock-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 10px 16px;
        border-radius: 8px;
        color: var(--color-text-muted, #6b7280);
        text-decoration: none;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        transition: all 0.15s ease;
        position: relative;
      }

      .dock-item:hover {
        background: rgba(0, 0, 0, 0.03);
        color: var(--color-text-main, #111827);
      }

      .dock-item.active {
        background: rgba(0, 0, 0, 0.04);
        color: var(--color-primary, #2563eb);
      }

      .dock-item.active lucide-icon {
        stroke-width: 2px;
      }

      .label {
        font-size: 0.6rem;
        font-weight: 500;
        letter-spacing: 0.01em;
        opacity: 0.9;
      }

      /* --- MOBILE: Subtle Bottom Bar --- */
      @media (max-width: 768px) {
        :host {
          bottom: 0;
          left: 0;
          transform: none;
          width: 100%;
        }

        .app-dock {
          width: 100%;
          border-radius: 0;
          border: none;
          border-top: 1px solid rgba(0, 0, 0, 0.06);

          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(16px);

          justify-content: space-evenly;
          gap: 0;

          padding: 6px 16px;
          padding-bottom: max(6px, env(safe-area-inset-bottom));

          box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.04);
        }

        .dock-item {
          flex: 1;
          padding: 10px 0;
          border-radius: 8px;
        }

        .dock-item:hover {
          background: transparent;
        }

        .dock-item.active {
          background: rgba(0, 0, 0, 0.03);
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
