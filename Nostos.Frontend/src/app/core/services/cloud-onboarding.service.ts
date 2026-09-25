import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CloudOnboardingCheckoutRequest,
  CloudOnboardingRedirect,
  CloudOnboardingSnapshot,
} from '../dtos/cloud-onboarding.dtos';

@Injectable({ providedIn: 'root' })
export class CloudOnboardingService {
  private readonly http = inject(HttpClient);

  getState(offerId: string | null = null): Observable<CloudOnboardingSnapshot> {
    let params = new HttpParams();
    if (offerId !== null) params = params.set('offer', offerId);

    return this.http.get<CloudOnboardingSnapshot>('/api/cloud/onboarding/', { params });
  }

  provision(): Observable<CloudOnboardingSnapshot> {
    return this.http.post<CloudOnboardingSnapshot>('/api/cloud/onboarding/provision', {});
  }

  createCheckout(offerId: string): Observable<CloudOnboardingRedirect> {
    const request: CloudOnboardingCheckoutRequest = { offerId };
    return this.http.post<CloudOnboardingRedirect>('/api/cloud/onboarding/checkout', request);
  }

  reconcileSubscription(): Observable<CloudOnboardingSnapshot> {
    return this.http.post<CloudOnboardingSnapshot>('/api/cloud/onboarding/reconcile', {});
  }

  createBillingPortal(): Observable<CloudOnboardingRedirect> {
    return this.http.post<CloudOnboardingRedirect>('/api/cloud/onboarding/billing-portal', {});
  }
}
