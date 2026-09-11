import { Component, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { ToastContainerComponent } from './ui/toast-container/toast-container.component';
import { SwUpdateService } from './core/services/sw-update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  private readonly router = inject(Router);
  readonly navigationPending = signal(false);

  constructor() {
    // Keeps the service worker's navigation manifest fresh, so a deploy that
    // changes how URLs are served (the app shell vs. the API) reaches an
    // already-open client without a manual reload.
    inject(SwUpdateService).start();

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) this.navigationPending.set(true);
      if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.navigationPending.set(false);
      }
    });
  }
}
