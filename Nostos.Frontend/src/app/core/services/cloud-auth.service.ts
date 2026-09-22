import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';

import { CloudSession } from '../dtos/cloud-auth.dtos';

/**
 * Safe browser-facing Cloud session state.
 *
 * Tokens, OIDC issuer/subject claims and provider credentials never enter the
 * Angular application. Interactive sign-in is a top-level navigation to the
 * backend BFF endpoint; the browser then receives only the secure session
 * cookie managed by ASP.NET Core.
 */
@Injectable({ providedIn: 'root' })
export class CloudAuthService {
  private readonly http = inject(HttpClient);
  private session$?: Observable<CloudSession>;

  getSession(refresh = false): Observable<CloudSession> {
    if (refresh || !this.session$) {
      this.session$ = this.http
        .get<CloudSession>('/api/auth/session')
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    }

    return this.session$;
  }

  loginUrl(returnUrl: string): string {
    const safeReturnUrl = returnUrl.startsWith('/') && !returnUrl.startsWith('//')
      ? returnUrl
      : '/';

    return `/api/auth/login?returnUrl=${encodeURIComponent(safeReturnUrl)}`;
  }
}
