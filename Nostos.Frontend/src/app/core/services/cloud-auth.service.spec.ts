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

  it('submits logout as a top-level POST to the BFF', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    service.logout();

    expect(submit).toHaveBeenCalledTimes(1);
    const form = submit.mock.instances[0] as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/auth/logout');
    expect(document.body.contains(form)).toBe(false);

    submit.mockRestore();
  });

  it('only creates login URLs with local return targets', () => {
    expect(service.loginUrl('/library')).toBe('/api/auth/login?returnUrl=%2Flibrary');
    expect(service.loginUrl('https://evil.example')).toBe('/api/auth/login?returnUrl=%2F');
    expect(service.loginUrl('//evil.example')).toBe('/api/auth/login?returnUrl=%2F');
  });

  it('preserves the selected Cloud offer inside a local auth return URL', () => {
    expect(service.loginUrl('/start', 'pro-annual')).toBe(
      '/api/auth/login?returnUrl=%2Fstart%3Foffer%3Dpro-annual',
    );
    expect(service.loginUrl('/start?source=pricing', 'standard-monthly')).toBe(
      '/api/auth/login?returnUrl=%2Fstart%3Fsource%3Dpricing%26offer%3Dstandard-monthly',
    );
    expect(service.loginUrl('/start?offer=standard-annual', 'pro-monthly')).toBe(
      '/api/auth/login?returnUrl=%2Fstart%3Foffer%3Dpro-monthly',
    );
  });

  it('never turns an offer into an external return target', () => {
    expect(service.loginUrl('https://evil.example', 'pro-annual')).toBe(
      '/api/auth/login?returnUrl=%2F',
    );
  });
});
