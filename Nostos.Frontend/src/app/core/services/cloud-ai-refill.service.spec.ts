import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CloudAiRefillService } from './cloud-ai-refill.service';

describe('CloudAiRefillService', () => {
  let service: CloudAiRefillService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(CloudAiRefillService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the product-level managed AI usage and refill state', async () => {
    const resultPromise = firstValueFrom(service.getUsage());
    const request = http.expectOne('/api/cloud/ai/usage');

    expect(request.request.method).toBe('GET');
    request.flush({
      state: 'near_limit',
      renewsAtUtc: '2026-10-01T00:00:00Z',
      refill: { available: false, state: 'empty' },
    });

    const usage = await resultPromise;
    expect(usage.state).toBe('near_limit');
    expect(usage.refill.state).toBe('empty');
  });
});
