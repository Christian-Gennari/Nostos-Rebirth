import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class NavigationHistoryService {
  private router = inject(Router);

  // Default entry points for each app
  private history: Record<string, string> = {
    '/library': '/library',
    '/second-brain': '/second-brain',
    '/studio': '/studio',
  };

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        const url = e.urlAfterRedirects;

        // Remember the specific path for each "App"
        if (url.startsWith('/library')) {
          this.history['/library'] = url;
        } else if (url.startsWith('/second-brain')) {
          this.history['/second-brain'] = url;
        } else if (url.startsWith('/studio')) {
          this.history['/studio'] = url;
        }
      });
  }

  /**
   * Returns the last visited URL for a given app section.
   * e.g. getLastUrl('/library') might return '/library/book-123'
   */
  getLastUrl(appPrefix: string): string {
    return this.history[appPrefix] || appPrefix;
  }
}
