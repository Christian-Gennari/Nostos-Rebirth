import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { LucideAngularModule, Library, PenTool, BrainCog, Settings } from 'lucide-angular';
import { NavigationHistoryService } from '../../core/services/navigation-history.service';

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
          <lucide-icon [img]="LibraryIcon" [size]="16" strokeWidth="1.75"></lucide-icon>
          <span class="label">Library</span>
        </a>

        <a
          [routerLink]="getLink('/second-brain')"
          (click)="handleDockClick('/second-brain', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="The Brain"
        >
          <lucide-icon [img]="BrainIcon" [size]="16" strokeWidth="1.75"></lucide-icon>
          <span class="label">Brain</span>
        </a>

        <a
          [routerLink]="getLink('/studio')"
          (click)="handleDockClick('/studio', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="Writing Studio"
        >
          <lucide-icon [img]="PenToolIcon" [size]="16" strokeWidth="1.75"></lucide-icon>
          <span class="label">Studio</span>
        </a>

        <a
          routerLink="/settings"
          routerLinkActive="active"
          class="dock-item"
          title="Settings"
        >
          <lucide-icon [img]="SettingsIcon" [size]="16" strokeWidth="1.75"></lucide-icon>
          <span class="label">Settings</span>
        </a>
      </div>
    </nav>
  `,
  styles: [
    `
      /* --- HOST & CONTAINER --- */
      :host {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        padding: 0;
        pointer-events: none;
      }

      .app-dock-container {
        position: relative;
        border-radius: 999px;
        pointer-events: auto;
        box-shadow:
          0 16px 36px -6px rgba(0, 0, 0, 0.14),
          0 2px 8px rgba(0, 0, 0, 0.04);
        transition: box-shadow 0.2s ease;
      }

      /* --- THE GLASS FOREGROUND --- */
      .dock-glass {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.86);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
        box-sizing: border-box;
      }

      /* --- DOCK ITEMS (DESKTOP) --- */
      .dock-item {
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: 999px;
        color: var(--color-text-muted, #64748b);
        text-decoration: none;
        font-family: 'Inter', sans-serif;
        font-size: 0.82rem;
        font-weight: 500;
        letter-spacing: -0.01em;
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease;
        white-space: nowrap;
        user-select: none;
      }

      .dock-item:hover {
        background: var(--bg-hover, rgba(0, 0, 0, 0.05));
        color: var(--color-text-main, #0f172a);
      }

      .dock-item.active {
        background: var(--color-primary, #0f172a);
        color: var(--bg-surface, #ffffff);
        font-weight: 500;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16);
      }

      .dock-item.active lucide-icon {
        color: inherit;
      }

      .label {
        font-size: 0.82rem;
        font-weight: 500;
        line-height: 1;
        opacity: 1;
      }

      /* --- MOBILE OVERRIDES --- */
      @media (max-width: 768px) {
        :host {
          bottom: 0;
          left: 0;
          transform: none;
          width: 100%;
          pointer-events: auto;
        }

        .app-dock-container {
          border-radius: 0;
          width: 100%;
          box-shadow: 0 -1px 8px rgba(0, 0, 0, 0.04);
        }

        .dock-glass {
          border-radius: 0;
          border: none;
          border-top: 1px solid var(--border-color);
          width: 100%;
          justify-content: space-around;
          padding: 6px 8px;
          padding-bottom: max(6px, env(safe-area-inset-bottom));
          background: rgba(255, 255, 255, 0.94);
        }

        .dock-item {
          flex-direction: column;
          gap: 2px;
          padding: 4px 8px;
          border-radius: 8px;
          flex: 1;
          font-size: 0.68rem;
        }

        .dock-item.active {
          background: var(--color-accent-bg, rgba(0, 0, 0, 0.06));
          color: var(--color-primary);
          box-shadow: none;
        }

        .label {
          font-size: 0.68rem;
          font-weight: 500;
        }
      }
    `,
  ],
})
export class AppDockComponent {
  private historyService = inject(NavigationHistoryService);
  private router = inject(Router);

  LibraryIcon = Library;
  BrainIcon = BrainCog;
  PenToolIcon = PenTool;
  SettingsIcon = Settings;

  getLink(prefix: string): string {
    return this.historyService.getLastUrl(prefix);
  }

  handleDockClick(prefix: string, event: Event) {
    if (this.router.url.startsWith(prefix)) {
      event.preventDefault();
      // Selection is URL-owned; re-clicking the Library dock item clears it.
      void this.router.navigate([prefix], {
        queryParams: { collection: null },
        queryParamsHandling: 'merge',
      });
    }
  }
}
