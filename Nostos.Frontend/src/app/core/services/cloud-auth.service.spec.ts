import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { CloudAuthService } from './cloud-auth.service';

describe('CloudAuthService', () => {
  let service: CloudAuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(CloudAuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads safe session state from the BFF', async () => {
    const resultPromise = firstValueFrom(service.getSession());

    const request = http.expectOne('/api/auth/session');
    expect(request.request.method).toBe('GET');
    request.flush({
      authenticated: true,
      accountState: 'Active',
      account: {
        id: '1e4df713-1a34-4fc7-9a90-c45169256845',
        displayName: 'Reader',
        email: 'reader@example.test',
      },
    });

    const result = await resultPromise;
    expect(result.authenticated).toBe(true);
    expect(result.account?.displayName).toBe('Reader');
  });

  it('caches session state until an explicit refresh', async () => {
    const firstPromise = firstValueFrom(service.getSession());
    http.expectOne('/api/auth/session').flush({
      authenticated: false,
      accountState: null,
      account: null,
    });
    await firstPromise;

    await firstValueFrom(service.getSession());
    http.expectNone('/api/auth/session');

    const refreshPromise = firstValueFrom(service.getSession(true));
    http.expectOne('/api/auth/session').flush({
      authenticated: true,
      accountState: 'Active',
      account: {
        id: '1e4df713-1a34-4fc7-9a90-c45169256845',
        displayName: 'Reader',
        email: null,
      },
    });

    expect((await refreshPromise).authenticated).toBe(true);
  });

  it('only creates login URLs with local return targets', () => {
    expect(service.loginUrl('/library')).toBe('/api/auth/login?returnUrl=%2Flibrary');
    expect(service.loginUrl('https://evil.example')).toBe('/api/auth/login?returnUrl=%2F');
    expect(service.loginUrl('//evil.example')).toBe('/api/auth/login?returnUrl=%2F');
  });
});
