import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { OpdsService } from './opds.service';

describe('OpdsService', () => {
  let service: OpdsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(OpdsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('keeps catalog discovery on the normal product endpoint', async () => {
    const result = firstValueFrom(service.getInfo());
    const request = http.expectOne('/api/opds/info');
    expect(request.request.method).toBe('GET');
    request.flush({
      enabled: true,
      catalogUrl: 'https://app.example/opds/',
      urlSource: 'configured',
      localOnly: false,
    });
    expect((await result).catalogUrl).toBe('https://app.example/opds/');
  });

  it('uses browser-authenticated Cloud management endpoints for the credential lifecycle', async () => {
    const state = firstValueFrom(service.getManagedAccess());
    let request = http.expectOne('/api/cloud/opds/');
    expect(request.request.method).toBe('GET');
    request.flush({
      enabled: false,
      username: null,
      password: null,
      createdAtUtc: null,
      rotatedAtUtc: null,
      revokedAtUtc: null,
    });
    expect((await state).enabled).toBe(false);

    const enabled = firstValueFrom(service.enableManagedAccess());
    request = http.expectOne('/api/cloud/opds/');
    expect(request.request.method).toBe('POST');
    request.flush({
      enabled: true,
      username: 'reader-example',
      password: 'one-time-password',
      createdAtUtc: '2026-09-24T17:00:00Z',
      rotatedAtUtc: '2026-09-24T17:00:00Z',
      revokedAtUtc: null,
    });
    expect((await enabled).password).toBe('one-time-password');

    const rotated = firstValueFrom(service.rotateManagedPassword());
    request = http.expectOne('/api/cloud/opds/rotate');
    expect(request.request.method).toBe('POST');
    request.flush({
      enabled: true,
      username: 'reader-example',
      password: 'replacement-password',
      createdAtUtc: '2026-09-24T17:00:00Z',
      rotatedAtUtc: '2026-09-24T18:00:00Z',
      revokedAtUtc: null,
    });
    expect((await rotated).password).toBe('replacement-password');

    const revoked = firstValueFrom(service.revokeManagedAccess());
    request = http.expectOne('/api/cloud/opds/');
    expect(request.request.method).toBe('DELETE');
    request.flush({
      enabled: false,
      username: 'reader-example',
      password: null,
      createdAtUtc: '2026-09-24T17:00:00Z',
      rotatedAtUtc: '2026-09-24T18:00:00Z',
      revokedAtUtc: '2026-09-24T19:00:00Z',
    });
    expect((await revoked).enabled).toBe(false);
  });
});
