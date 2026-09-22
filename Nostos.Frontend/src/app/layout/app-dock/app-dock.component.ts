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
      /* The --dock-* tokens: on light the dock floats on a warm cast; on dark a
         dark shadow carries no elevation, so the surface itself lifts (measured
         1.55 tonal separation from the page). One rule, both themes.
         NOTE: no backticks in this file - these styles live in a template
         literal, and a backtick terminates it. */

      :host {
        position: fixed;
        bottom: 24px;
        left: 50%;
        z-index: var(--layer-navigation);
        width: auto;
        padding: 0;
        transform: translateX(-50%);
      }

      /* Radii are CONCENTRIC on purpose: 16 outer - 6 bar padding = 10 inner, so
         the selected item's corners stay parallel to the container's at a constant
         gap (the trick that makes a rounded rectangle look cut from one piece).
         Retuning either number means retuning both. */
      .app-dock-container {
        width: max-content;
        border: 1px solid var(--dock-border);
        border-radius: 16px;
        overflow: clip;
        background: var(--dock-surface);
        box-shadow: var(--dock-shadow);
      }

      .dock-bar {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 6px;
      }

      /* "Selected" is ONE surface: a capsule that slides between items and covers
         the whole item (icon + label), the way a segmented control marks its
         selection. It REPLACED a three-mark treatment - a disc behind the icon, a
         2px accent bar under the label, and a heavier label - whose marks
         disagreed: the disc sat a few points off the container and read as a
         smudge on dark, and the bar was the only chromatic element in the dock, so
         the eye had to travel between two markers to confirm one state.
         Geometry (width, height, position) is stamped from the live item box by
         movePill(); width is transitioned so the capsule stretches as it travels
         instead of jumping. */
      .dock-pill {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 0;
        width: 0;
        height: 0;
        border-radius: 10px;
        background: color-mix(in srgb, var(--color-accent) 18%, var(--dock-surface));
        /* The rim is what makes this read as a deliberate surface rather than a
           smudge of tint: measured against its own fill it is 8 levels on light
           and 5 on dark with --dock-border (which is close to the capsule's own
           value, so the hairline was invisible), against 17 here. The mix comes
           from the muted ink, not the accent, so the rim is neutral in both
           themes - an accent-derived rim goes teal on dark. Kept just under the
           container's own border separation (26 levels on light) so the inner
           edge cannot out-shout the outer one. */
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-muted) 25%, var(--dock-surface));
        opacity: 0;
        pointer-events: none;
        transition:
          transform var(--motion-base) var(--ease-spring),
          width var(--motion-base) var(--ease-spring),
          opacity var(--motion-fast) ease;
      }

      .dock-item {
        position: relative;
        z-index: 1;
        display: inline-flex;
        min-width: 84px;
        min-height: 58px;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 7px 12px 8px;
        border: 0;
        border-radius: 10px;
        color: var(--color-text-muted);
        cursor: pointer;
        font-family: 'Hanken Grotesk', sans-serif;
        text-decoration: none;
        transition:
          color var(--motion-fast) ease,
          transform var(--motion-fast) var(--ease-out);
        touch-action: manipulation;
      }

      /* Pointer feedback is the SAME shape as the selection at a fraction of its
         strength, so hover and selected read as one language rather than a wash
         plus a bar. It is gated on a real pointer (a tap must not leave it stuck
         on), and the item that already carries the capsule does not change under
         the pointer. */
      .dock-item::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: color-mix(in srgb, var(--color-accent) 18%, var(--dock-surface));
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--motion-fast) ease;
      }

      @media (hover: hover) {
        .dock-item:not(.active):not(.pending):hover::before {
          opacity: 0.55;
        }
      }

      .dock-item nostos-icon {
        display: grid;
        width: 28px;
        height: 28px;
        flex: 0 0 28px;
        place-items: center;
      }

      .dock-item:active {
        transform: scale(0.97);
      }

      .dock-item:focus-visible {
        /* Width comes from the shared token like every other ring in the app. The
           COLOUR stays local and deliberately so: this dock's items include
           destructive actions, and an accent-coloured ring distinguishes "this dock
           item" from the neutral slate used everywhere else. That is a role
           difference, not drift - the drift was the hardcoded width. */
        outline: var(--focus-ring-width) solid var(--color-accent);
        outline-offset: -2px;
      }

      .dock-item.active,
      .dock-item.pending {
        /* Ink on light; porcelain on dark, matching the heading rule. */
        color: var(--dock-item-active-ink);
      }

      .label {
        font-size: 0.7rem;
        font-weight: 500;
        letter-spacing: 0.015em;
        line-height: 1;
      }

      .dock-item.active .label,
      .dock-item.pending .label {
        font-weight: 600;
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
          /* The phone dock is a full-bleed rail, so its cast points UP. */
          box-shadow: var(--dock-shadow-rail);
          /* The rail's TOTAL height is the token the shell reserves for it, and it
             is set here rather than on the inner bar because this element owns the
             remaining 1px border: sizing the bar left the dock 1px taller than the
             reserve, which put it 1px over the last line of content. The inset is
             part of the height on a notched phone, matching the shell's reserve.
             "height" not "min-height": a floor lets natural content win. */
          box-sizing: border-box;
          height: calc(var(--dock-rail-h) + env(safe-area-inset-bottom, 0px));
        }

        .dock-bar {
          width: 100%;
          /* Fill the container, whose height is the reserved --dock-rail-h.
             Content clearance and dock height are therefore one value rather than
             two that can drift (they were 96px and 58px, leaving 38px of dead space
             above the dock on every page). */
          box-sizing: border-box;
          height: 100%;
          justify-content: space-around;
          gap: 2px;
          padding: 3px 8px max(3px, env(safe-area-inset-bottom));
        }

        .dock-item {
          min-width: 0;
          min-height: 44px;
          flex: 1;
          gap: 2px;
          padding: 4px 4px 6px;
        }

        .dock-item nostos-icon {
          /* 20px icons: the desktop 0.9 scale (18px) is too small to read or
             hit comfortably on a phone. */
          width: 26px;
          height: 26px;
          flex-basis: 26px;
        }

        .label {
          font-size: 0.69rem;
        }

        .dock-item:active {
          transform: scale(0.96);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host,
        .dock-item,
        .dock-pill,
        .dock-item::before {
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
    // capsule never chases a stale item.
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
      // The capsule IS the item's box, so icon and label sit on it exactly as
      // they do on hover. The previous 2px bar was 28px wide and inset 4px by
      // hand, which meant every spacing change had to be re-derived here as well
      // as in CSS.
      const barRect = bar.getBoundingClientRect();
      const itemRect = active.getBoundingClientRect();
      pill.style.opacity = '1';
      pill.style.width = `${itemRect.width}px`;
      pill.style.height = `${itemRect.height}px`;
      pill.style.transform = `translate(${itemRect.left - barRect.left}px, ${
        itemRect.top - barRect.top
      }px)`;
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
