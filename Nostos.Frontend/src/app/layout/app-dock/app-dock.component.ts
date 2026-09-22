import {
  Component,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationHistoryService } from '../../core/services/navigation-history.service';
import { LibraryFilterService } from '../../library/library-filter.service';
import { NostosIconComponent } from '../../ui/icon/nostos-icon.component';

@Component({
  standalone: true,
  selector: 'app-app-dock',
  imports: [RouterLink, RouterLinkActive, NostosIconComponent],
  template: `
    <nav class="app-dock-container" aria-label="Main navigation">
      <div class="dock-bar" #dockBar>
        <span class="dock-pill" aria-hidden="true"></span>
        <a
          [routerLink]="getLink('/library')"
          (click)="handleDockClick('/library', $event)"
          routerLinkActive="active"
          [class.pending]="pendingDestination() === '/library'"
          class="dock-item"
          title="Library"
        >
          <nostos-icon name="books" [size]="20" weight="regular"></nostos-icon>
          <span class="label">Library</span>
        </a>

        <a
          [routerLink]="getLink('/second-brain')"
          (click)="handleDockClick('/second-brain', $event)"
          routerLinkActive="active"
          [class.pending]="pendingDestination() === '/second-brain'"
          class="dock-item"
          title="The Brain"
        >
          <nostos-icon name="brain" [size]="20" weight="regular"></nostos-icon>
          <span class="label">Brain</span>
        </a>

        <a
          [routerLink]="getLink('/studio')"
          (click)="handleDockClick('/studio', $event)"
          routerLinkActive="active"
          [class.pending]="pendingDestination() === '/studio'"
          class="dock-item"
          title="Writing Studio"
        >
          <nostos-icon name="pen-nib" [size]="20" weight="regular"></nostos-icon>
          <span class="label">Studio</span>
        </a>

        <a
          routerLink="/settings"
          (click)="handleDockClick('/settings', $event)"
          routerLinkActive="active"
          [class.pending]="pendingDestination() === '/settings'"
          class="dock-item"
          title="Settings"
        >
          <nostos-icon name="gear-six" [size]="20" weight="regular"></nostos-icon>
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
        z-index: var(--layer-navigation);
        width: auto;
        padding: 0;
        transform: translateX(-50%);
      }

      .app-dock-container {
        width: max-content;
        border: 1px solid var(--dock-border);
        border-radius: 12px;
        overflow: clip;
        background: var(--dock-surface);
        box-shadow: var(--dock-shadow);
      }

      .dock-bar {
        position: relative;
        display: flex;
        align-items: stretch;
        justify-content: center;
        gap: 0;
        padding: 6px;
      }

      .dock-pill {
        position: absolute;
        bottom: 4px;
        left: 0;
        z-index: 2;
        height: 2px;
        width: 0;
        border-radius: var(--radius-pill);
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
        min-width: 92px;
        min-height: 40px;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 14px 10px;
        border: 0;
        border-radius: 8px;
        color: var(--color-text-muted);
        cursor: pointer;
        font-family: 'Hanken Grotesk', sans-serif;
        text-decoration: none;
        transition:
          background-color var(--motion-fast) ease,
          color var(--motion-fast) ease,
          transform var(--motion-fast) var(--ease-out);
        touch-action: manipulation;
      }

      .dock-item + .dock-item::before {
        content: '';
        position: absolute;
        top: 9px;
        bottom: 9px;
        left: -1px;
        width: 1px;
        background: var(--dock-border);
        opacity: 0.62;
        pointer-events: none;
      }

      .dock-item:hover {
        background: var(--bg-hover);
        color: var(--color-text-main);
      }

      .dock-item:active {
        transform: scale(0.97);
      }

      .dock-item:focus-visible {
        outline: var(--focus-ring-width) solid var(--color-accent);
        outline-offset: -2px;
      }

      .dock-item.active {
        background: color-mix(in srgb, var(--color-accent) 8%, var(--dock-surface));
        color: var(--dock-item-active-ink);
      }

      .dock-item.pending {
        background: color-mix(in srgb, var(--color-accent) 11%, var(--dock-surface));
        color: var(--dock-item-active-ink);
      }

      .dock-item nostos-icon {
        flex: 0 0 auto;
        opacity: 0.9;
      }

      .dock-item.active nostos-icon,
      .dock-item.pending nostos-icon {
        opacity: 1;
      }

      .label {
        font-size: 0.74rem;
        font-weight: 500;
        letter-spacing: 0.012em;
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
          width: 100%;
          max-width: none;
          border-right: 0;
          border-bottom: 0;
          border-left: 0;
          border-radius: 0;
          box-shadow: var(--dock-shadow-rail);
          box-sizing: border-box;
          height: calc(var(--dock-rail-h) + env(safe-area-inset-bottom, 0px));
        }

        .dock-bar {
          width: 100%;
          box-sizing: border-box;
          height: 100%;
          align-items: center;
          justify-content: space-around;
          gap: 2px;
          padding: 4px 8px max(4px, env(safe-area-inset-bottom));
        }

        .dock-pill {
          bottom: max(4px, env(safe-area-inset-bottom));
        }

        .dock-item {
          min-width: 0;
          min-height: 44px;
          flex: 1;
          flex-direction: column;
          gap: 3px;
          padding: 5px 4px 7px;
          border-radius: var(--radius-lg);
        }

        .dock-item + .dock-item::before {
          display: none;
        }

        .label {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.01em;
        }

        .dock-item:hover {
          transform: none;
        }

        .dock-item:active {
          transform: scale(0.96);
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
  private dockBar = viewChild<ElementRef<HTMLElement>>('dockBar');

  /** Destination chosen by the pointer but not yet committed by the router. */
  readonly pendingDestination = signal<string | null>(null);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.pendingDestination.set(null);
        this.movePill();
      }
    });
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
      const active =
        bar.querySelector<HTMLElement>('.dock-item.pending') ??
        bar.querySelector<HTMLElement>('.dock-item.active');
      if (!active) {
        pill.style.opacity = '0';
        return;
      }
      const barRect = bar.getBoundingClientRect();
      const itemRect = active.getBoundingClientRect();
      const pillWidth = Math.min(28, Math.max(0, itemRect.width - 24));
      const pillOffset = itemRect.left - barRect.left + (itemRect.width - pillWidth) / 2;
      pill.style.opacity = '1';
      pill.style.width = `${pillWidth}px`;
      pill.style.transform = `translateX(${pillOffset}px)`;
    });
  }

  getLink(prefix: string): string {
    return this.historyService.getLastUrl(prefix);
  }

  handleDockClick(prefix: string, event: Event) {
    if (this.router.url.startsWith(prefix)) {
      event.preventDefault();
      this.pendingDestination.set(null);
      // Re-clicking the Library dock item clears the active filters.
      if (prefix === '/library') this.filters.clearAll();
      return;
    }

    // A click event runs before RouterLink starts navigation. Paint the intended
    // destination now; RouterLinkActive becomes authoritative on completion.
    this.pendingDestination.set(prefix);
    this.movePill();
  }
}
