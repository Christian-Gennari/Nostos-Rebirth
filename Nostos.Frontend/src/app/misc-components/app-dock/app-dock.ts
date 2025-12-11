import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { LucideAngularModule, Library, BrainCircuit, PenTool } from 'lucide-angular';
import { CollectionsService } from '../../services/collections.services';
import { NavigationHistoryService } from '../../services/navigation-history.service';

@Component({
  standalone: true,
  selector: 'app-app-dock',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <nav class="app-dock-container">
      <div class="dock-glass">
        <a
          [routerLink]="getLink('/library')"
          (click)="handleDockClick('/library', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="Library"
        >
          <lucide-icon [img]="LibraryIcon" [size]="20" strokeWidth="1"></lucide-icon>
          <span class="label">Library</span>
        </a>

        <a
          [routerLink]="getLink('/second-brain')"
          (click)="handleDockClick('/second-brain', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="The Brain"
        >
          <lucide-icon [img]="BrainIcon" [size]="20" strokeWidth="1"></lucide-icon>
          <span class="label">Brain</span>
        </a>

        <a
          [routerLink]="getLink('/studio')"
          (click)="handleDockClick('/studio', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="Writing Studio"
        >
          <lucide-icon [img]="PenToolIcon" [size]="20" strokeWidth="1"></lucide-icon>
          <span class="label">Studio</span>
        </a>
      </div>
    </nav>
  `,
  styles: [
    `
      /* --- ANIMATION DEFINITIONS --- */
      @property --gradient-angle {
        syntax: '<angle>';
        initial-value: 0deg;
        inherits: false;
      }

      @keyframes rotate-gradient {
        0% {
          --gradient-angle: 0deg;
        }
        100% {
          --gradient-angle: 360deg;
        }
      }

      /* --- HOST & LAYOUT --- */
      :host {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        /* Ensure the glow doesn't get cut off */
        padding: 10px;
      }

      .app-dock-container {
        position: relative;
        border-radius: 22px;
        /* Using isolation to ensure z-index layering works perfectly */
        isolation: isolate;
      }

      /* --- THE GLOWING BACKDROP (The "Pop") --- */
      .app-dock-container::before {
        content: '';
        position: absolute;
        inset: -3px; /* Extends slightly outside the glass */
        z-index: -1;
        border-radius: 24px;

        /* The Magic: Soft Pastel Rainbow */
        background: conic-gradient(
          from var(--gradient-angle),
          #a8c0ff,
          /* Soft Blue */ #c4a8ff,
          /* Lavender */ #ffafcc,
          /* Soft Pink */ #ffc8a2,
          /* Peach */ #bde0fe,
          /* Light Blue */ #a8c0ff /* Loop back to start */
        );

        /* Blur it to make it look like a shadow/glow */
        filter: blur(8px);
        opacity: 0.65;

        /* Animate it */
        animation: rotate-gradient 6s linear infinite;
        transition: opacity 0.3s ease, filter 0.3s ease;
      }

      /* --- THE GLASS FOREGROUND --- */
      .dock-glass {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;

        /* Solid enough to hide the rainbow center, transparent enough for glass feel */
        background: rgba(255, 255, 255, 0.4);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);

        /* Inner white border to separate glass from glow */
        border: 2px solid rgba(255, 255, 255, 0.4);

        border-radius: 20px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.02); /* Very subtle internal shadow */
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      /* --- DOCK ITEMS --- */
      .dock-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 10px 18px;
        border-radius: 14px;
        color: var(--color-text-muted, #6b7280);
        text-decoration: none;
        font-family: 'Inter', sans-serif;
        transition: all 0.2s ease;
        position: relative;
        cursor: pointer;
      }

      .dock-item.active {
        background: #fff;
        color: #111827;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      }

      .label {
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        opacity: 0.9;
        transition: opacity 0.3s ease, max-height 0.3s ease, transform 0.3s ease;
      }

      /* --- DESKTOP / TABLET (HOVER ENABLED) --- */
      @media (min-width: 769px) {
        .dock-item {
          padding: 8px 12px;
        }

        /* Generic Item Hover */
        .dock-item:hover {
          background: rgba(0, 0, 0, 0.08);
          color: var(--color-text-main, #111827);
          transform: translateY(-2px);
        }

        /* Container Hover: Tighter, brighter glow */
        .app-dock-container:hover::before {
          filter: blur(5px);
          opacity: 0.9;
          inset: -2px;
        }

        /* Container Hover: Expand glass */
        .app-dock-container:hover .dock-glass {
          gap: 20px;
          padding: 10px;
          background: rgba(255, 255, 255, 0.8);
        }

        /* Label Animation Logic */
        .label {
          max-height: 0;
          opacity: 0;
          overflow: hidden;
          transform: translateY(5px);
        }
        .app-dock-container:hover .label {
          max-height: 20px;
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* --- MOBILE --- */
      @media (max-width: 768px) {
        :host {
          bottom: 0;
          left: 0;
          transform: none;
          width: 100%;
          padding: 0;
        }

        /* On mobile, we reduce the glow so it's just a top border accent */
        .app-dock-container {
          border-radius: 0;
          width: 100%;
        }

        .app-dock-container::before {
          border-radius: 0;
          top: -2px; /* Only show glow at the top */
          bottom: 0;
          left: 0;
          right: 0;
          inset: auto;
          height: 100%;
          width: 100%;
          opacity: 0.4;
          filter: blur(15px);
        }

        .dock-glass {
          border-radius: 0;
          border: none;
          border-top: 1px solid rgba(255, 255, 255, 0.5);
          width: 100%;
          justify-content: space-evenly;
          padding: 6px 16px;
          padding-bottom: max(6px, env(safe-area-inset-bottom));
          /* More opaque on mobile to cover content scrolling behind */
          background: rgba(255, 255, 255, 0.9);
        }

        .dock-item {
          flex: 1;
          margin: 0 4px;
          padding: 8px 0;
        }

        .label {
          max-height: none;
          opacity: 0.9;
          transform: none;
        }
      }
    `,
  ],
})
export class AppDockComponent {
  private collectionsService = inject(CollectionsService);
  private historyService = inject(NavigationHistoryService);
  private router = inject(Router);

  LibraryIcon = Library;
  BrainIcon = BrainCircuit;
  PenToolIcon = PenTool;

  getLink(prefix: string): string {
    return this.historyService.getLastUrl(prefix);
  }

  handleDockClick(prefix: string, event: Event) {
    if (this.router.url.startsWith(prefix)) {
      event.preventDefault();
      this.collectionsService.activeCollectionId.set(null);
      this.router.navigate([prefix]);
    }
  }
}
