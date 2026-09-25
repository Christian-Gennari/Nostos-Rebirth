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

  loginUrl(returnUrl: string, offerId: string | null = null): string {
    const isLocalReturnUrl = returnUrl.startsWith('/') && !returnUrl.startsWith('//');
    const safeReturnUrl = isLocalReturnUrl ? returnUrl : '/';
    const target =
      isLocalReturnUrl && offerId !== null
        ? this.withOffer(safeReturnUrl, offerId)
        : safeReturnUrl;

    return `/api/auth/login?returnUrl=${encodeURIComponent(target)}`;
  }

  private withOffer(returnUrl: string, offerId: string): string {
    const target = new URL(returnUrl, 'https://nostos.local');
    target.searchParams.set('offer', offerId);
    return `${target.pathname}${target.search}${target.hash}`;
  }
}
