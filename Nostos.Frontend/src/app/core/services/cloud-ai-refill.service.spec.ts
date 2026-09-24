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

  it('reads the product-level managed AI usage state', async () => {
    const result = firstValueFrom(service.getUsage());
    const request = http.expectOne('/api/cloud/ai/usage');

    expect(request.request.method).toBe('GET');
    request.flush({
      state: 'near_limit',
      renewsAtUtc: '2026-10-01T00:00:00Z',
      refill: { available: false, state: 'empty' },
    });

    expect((await result).state).toBe('near_limit');
  });

  it('lists refill packs without exposing Paddle ids or internal capacity units', async () => {
    const result = firstValueFrom(service.getPacks());
    const request = http.expectOne('/api/cloud/billing/refills');

    expect(request.request.method).toBe('GET');
    request.flush({
      packs: [
        {
          packId: 'ai-refill-small',
          displayName: 'AI Refill - Small',
          displayPrice: '2.99 EUR',
        },
      ],
    });

    expect((await result).packs).toEqual([
      {
        packId: 'ai-refill-small',
        displayName: 'AI Refill - Small',
        displayPrice: '2.99 EUR',
      },
    ]);
  });

  it('starts checkout using only the stable Nostos pack id', async () => {
    const result = firstValueFrom(service.createCheckout('ai-refill-small'));
    const request = http.expectOne('/api/cloud/billing/refills/checkout');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ packId: 'ai-refill-small' });

    request.flush({
      packId: 'ai-refill-small',
      checkoutUrl: 'https://checkout.example/refill',
    });

    expect((await result).checkoutUrl).toBe('https://checkout.example/refill');
  });
});
