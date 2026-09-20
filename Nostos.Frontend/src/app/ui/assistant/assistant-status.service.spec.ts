import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssistantStatusService } from './assistant-status.service';

describe('AssistantStatusService', () => {
  let service: AssistantStatusService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AssistantStatusService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('stays unavailable until the server reports otherwise', () => {
    // Availability is a server fact, never an assumption.
    expect(service.available()).toBe(false);
  });

  it('reads availability from the dedicated status route', () => {
    service.refresh();

    const request = http.expectOne('/api/assistant/status');
    expect(request.request.method).toBe('GET');
    request.flush({ available: true });

    expect(service.available()).toBe(true);
  });

  it('treats a failed status request as unavailable', () => {
    service.available.set(true);
    service.refresh();

    http
      .expectOne('/api/assistant/status')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });

    expect(service.available()).toBe(false);
  });

  it('fetches the status once per session through ensureLoaded', () => {
    service.ensureLoaded();
    service.ensureLoaded();

    http.expectOne('/api/assistant/status').flush({ available: true });

    expect(service.available()).toBe(true);
  });
});
