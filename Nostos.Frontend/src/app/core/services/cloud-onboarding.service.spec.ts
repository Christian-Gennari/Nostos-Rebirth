import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CloudOnboardingService } from './cloud-onboarding.service';

describe('CloudOnboardingService', () => {
  let service: CloudOnboardingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(CloudOnboardingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads only the product-level onboarding contract', async () => {
    const resultPromise = firstValueFrom(service.getState());
    const request = http.expectOne('/api/cloud/onboarding/');
    expect(request.request.method).toBe('GET');

    request.flush({
      state: 'provisioning',
      subscriptionStatus: 'Trial',
      ready: false,
      canCheckout: false,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: false,
      selectedOffer: null,
    });

    const result = await resultPromise;
    expect(result.state).toBe('provisioning');
    expect(Object.keys(result)).not.toContain('databaseName');
    expect(Object.keys(result)).not.toContain('storageNamespace');
    expect(Object.keys(result)).not.toContain('failureCode');
  });

  it('forwards an acquisition offer to the server for validation without interpreting it', async () => {
    const resultPromise = firstValueFrom(service.getState('Pro-Annual'));
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/cloud/onboarding/' &&
        candidate.params.get('offer') === 'Pro-Annual',
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual(['offer']);

    request.flush({
      state: 'subscription_required',
      subscriptionStatus: 'None',
      ready: false,
      canCheckout: true,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: false,
      selectedOffer: {
        offerId: 'pro-annual',
        planName: 'Pro',
        billingCadence: 'Annual',
      },
    });

    expect((await resultPromise).selectedOffer?.offerId).toBe('pro-annual');
  });

  it('submits only the server-validated Nostos offer id to checkout', async () => {
    const resultPromise = firstValueFrom(service.createCheckout('pro-annual'));
    const request = http.expectOne('/api/cloud/onboarding/checkout');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ offerId: 'pro-annual' });
    expect(JSON.stringify(request.request.body)).not.toContain('pri_');

    request.flush({ url: 'https://checkout.example.test/session' });

    expect((await resultPromise).url).toContain('checkout.example.test');
  });

  it('starts provisioning without sending account or resource identifiers', async () => {
    const resultPromise = firstValueFrom(service.provision());
    const request = http.expectOne('/api/cloud/onboarding/provision');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});

    request.flush({
      state: 'ready',
      subscriptionStatus: 'Active',
      ready: true,
      canCheckout: false,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: false,
      selectedOffer: null,
    });

    expect((await resultPromise).ready).toBe(true);
  });
});
