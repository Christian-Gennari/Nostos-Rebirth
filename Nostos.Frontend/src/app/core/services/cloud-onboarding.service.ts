import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CloudOnboardingRedirect,
  CloudOnboardingSnapshot,
} from '../dtos/cloud-onboarding.dtos';

@Injectable({ providedIn: 'root' })
export class CloudOnboardingService {
  private readonly http = inject(HttpClient);

  getState(): Observable<CloudOnboardingSnapshot> {
    return this.http.get<CloudOnboardingSnapshot>('/api/cloud/onboarding/');
  }

  provision(): Observable<CloudOnboardingSnapshot> {
    return this.http.post<CloudOnboardingSnapshot>('/api/cloud/onboarding/provision', {});
  }

  createCheckout(): Observable<CloudOnboardingRedirect> {
    return this.http.post<CloudOnboardingRedirect>('/api/cloud/onboarding/checkout', {});
  }

  reconcileSubscription(): Observable<CloudOnboardingSnapshot> {
    return this.http.post<CloudOnboardingSnapshot>('/api/cloud/onboarding/reconcile', {});
  }

  createBillingPortal(): Observable<CloudOnboardingRedirect> {
    return this.http.post<CloudOnboardingRedirect>('/api/cloud/onboarding/billing-portal', {});
  }
}
