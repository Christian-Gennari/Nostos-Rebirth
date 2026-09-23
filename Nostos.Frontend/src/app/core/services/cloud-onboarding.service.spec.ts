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
    });

    const result = await resultPromise;
    expect(result.state).toBe('provisioning');
    expect(Object.keys(result)).not.toContain('databaseName');
    expect(Object.keys(result)).not.toContain('storageNamespace');
    expect(Object.keys(result)).not.toContain('failureCode');
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
    });

    expect((await resultPromise).ready).toBeTrue();
  });
});
