import {
  Component,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { LucideAngularModule, Library, PenTool, BrainCog, Settings } from 'lucide-angular';
import { NavigationHistoryService } from '../../core/services/navigation-history.service';
import { LibraryFilterService } from '../../library/library-filter.service';

@Component({
  standalone: true,
  selector: 'app-app-dock',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <nav class="app-dock-container" aria-label="Main navigation">
      <div class="dock-bar" #dockBar>
        <span class="dock-pill" aria-hidden="true"></span>
        <a
          [routerLink]="getLink('/library')"
          (click)="handleDockClick('/library', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="Library"
        >
          <lucide-icon [img]="LibraryIcon" [size]="20" strokeWidth="1.6"></lucide-icon>
          <span class="label">Library</span>
        </a>

        <a
          [routerLink]="getLink('/second-brain')"
          (click)="handleDockClick('/second-brain', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="The Brain"
        >
          <lucide-icon [img]="BrainIcon" [size]="20" strokeWidth="1.6"></lucide-icon>
          <span class="label">Brain</span>
        </a>

        <a
          [routerLink]="getLink('/studio')"
          (click)="handleDockClick('/studio', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="Writing Studio"
        >
          <lucide-icon [img]="PenToolIcon" [size]="20" strokeWidth="1.6"></lucide-icon>
          <span class="label">Studio</span>
        </a>

        <a
          routerLink="/settings"
          (click)="handleDockClick('/settings', $event)"
          routerLinkActive="active"
          class="dock-item"
          title="Settings"
        >
          <lucide-icon [img]="SettingsIcon" [size]="20" strokeWidth="1.6"></lucide-icon>
          <span class="label">Settings</span>
        </a>
      </div>
    </nav>
  `,
  styles: [
    `
      :host {
        position: fixed;
        bottom: 24px;
        left: 50%;
        z-index: 50;
        width: auto;
        padding: 0;
        transform: translateX(-50%);
      }

      .app-dock-container {
        width: max-content;
        border: 1px solid var(--border-color);
        border-radius: 0;
        background: var(--bg-surface);
        box-shadow: 0 8px 22px rgba(42, 38, 32, 0.12);
      }

      .dock-bar {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 3px 6px;
      }

      .dock-pill {
        position: absolute;
        bottom: 3px;
        left: 0;
        height: 2px;
        width: 0;
        background: var(--color-accent);
        opacity: 0;
        pointer-events: none;
        transition:
          transform var(--motion-base) var(--ease-spring),
          width var(--motion-base) var(--ease-spring),
          opacity var(--motion-fast) ease;
      }

      .dock-item {
        position: relative;
        display: inline-flex;
        min-width: 78px;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px 12px 7px;
        border: 0;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        color: var(--color-text-muted);
        cursor: pointer;
        font-family: 'Hanken Grotesk', sans-serif;
        text-decoration: none;
        transition:
          background-color var(--motion-fast) ease,
          color var(--motion-fast) ease;
      }

      .dock-item:hover {
        background: var(--bg-hover);
        color: var(--color-text-main);
      }

      .dock-item:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -2px;
      }

      .dock-item.active {
        border-bottom-color: transparent;
        background: transparent;
        color: var(--color-primary);
      }

      .label {
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.015em;
        line-height: 1;
      }

      @media (max-width: 768px) {
        :host {
          right: 0;
          bottom: 0;
          left: 0;
          width: 100%;
          transform: none;
        }

        .app-dock-container {
          /* The desktop dock is a floating pill sized to its content
             (width: max-content). On phones the dock is a full-bleed rail, so
             the container must stretch, otherwise it collapses to a narrow
             left-aligned pill with sub-44px tap targets. */
          width: 100%;
          max-width: none;
          border-right: 0;
          border-bottom: 0;
          border-left: 0;
          border-radius: 0;
          box-shadow: 0 -6px 20px rgba(42, 38, 32, 0.1);
        }

        .dock-bar {
          width: 100%;
          justify-content: space-around;
          gap: 1px;
          padding: 3px 10px max(3px, env(safe-area-inset-bottom));
        }

        .dock-item {
          min-width: 0;
          min-height: 44px;
          flex: 1;
          gap: 2px;
          padding: 5px 4px 6px;
        }

        .dock-item lucide-icon {
          /* 20px icons: the desktop 0.9 scale (18px) is too small to read or
             hit comfortably on a phone. */
          transform: none;
        }

        .label {
          font-size: 0.7rem;
        }

        .dock-item:hover {
          transform: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host,
        .dock-item,
        .dock-pill {
          transition: none;
        }
      }
    `,
  ],
})
export class AppDockComponent {
  private historyService = inject(NavigationHistoryService);
  private router = inject(Router);
  private filters = inject(LibraryFilterService);

  LibraryIcon = Library;
  BrainIcon = BrainCog;
  PenToolIcon = PenTool;
  SettingsIcon = Settings;

  private dockBar = viewChild<ElementRef<HTMLElement>>('dockBar');

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.movePill());
    afterNextRender(() => this.movePill());
  }

  @HostListener('window:resize')
  onResize(): void {
    this.movePill();
  }

  private movePill(): void {
    // routerLinkActive settles on the next frame; measure after that so the
    // pill never chases a stale item.
    requestAnimationFrame(() => {
      const bar = this.dockBar()?.nativeElement;
      const pill = bar?.querySelector<HTMLElement>('.dock-pill');
      if (!bar || !pill) return;
      const active = bar.querySelector<HTMLElement>('.dock-item.active');
      if (!active) {
        pill.style.opacity = '0';
        return;
      }
      const barRect = bar.getBoundingClientRect();
      const itemRect = active.getBoundingClientRect();
      pill.style.opacity = '1';
      pill.style.width = `${Math.max(0, itemRect.width - 24)}px`;
      pill.style.transform = `translateX(${itemRect.left - barRect.left + 12}px)`;
    });
  }

  getLink(prefix: string): string {
    return this.historyService.getLastUrl(prefix);
  }

  handleDockClick(prefix: string, event: Event) {
    if (this.router.url.startsWith(prefix)) {
      event.preventDefault();
      // Re-clicking the Library dock item clears the active filters.
      if (prefix === '/library') this.filters.clearAll();
    }
  }
}
