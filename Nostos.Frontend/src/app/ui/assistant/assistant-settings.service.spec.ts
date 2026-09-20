import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssistantSettingsService } from './assistant-settings.service';

describe('AssistantSettingsService', () => {
  let service: AssistantSettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AssistantSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('defaults to verbatim before the server answers', () => {
    expect(service.captureProcessingMode()).toBe('verbatim');
    expect(service.loadFailed()).toBe(false);
  });

  it('loads the stored value from the settings route', () => {
    service.refresh();

    const request = http.expectOne('/api/settings/assistant');
    expect(request.request.method).toBe('GET');
    request.flush({ captureProcessingMode: 'light_polish' });

    expect(service.captureProcessingMode()).toBe('light_polish');
    expect(service.loadFailed()).toBe(false);
  });

  it('falls back to verbatim for a value outside the three known modes', () => {
    service.refresh();

    http.expectOne('/api/settings/assistant').flush({ captureProcessingMode: 'shout' });

    expect(service.captureProcessingMode()).toBe('verbatim');
  });

  it('sets loadFailed and keeps the last value when the GET fails', () => {
    service.captureProcessingMode.set('clarify');
    service.refresh();

    http
      .expectOne('/api/settings/assistant')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });

    expect(service.loadFailed()).toBe(true);
    expect(service.captureProcessingMode()).toBe('clarify');
  });

  it('adopts the value the server returns from a PUT, not the value that was asked for', () => {
    service.setCaptureProcessingMode('light_polish');

    const request = http.expectOne('/api/settings/assistant');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ captureProcessingMode: 'light_polish' });
    // The server is the authority: it answers with a different stored value.
    request.flush({ captureProcessingMode: 'clarify' });

    expect(service.captureProcessingMode()).toBe('clarify');
    expect(service.saveFailed()).toBe(false);
  });

  it('keeps the previous value and reports when the PUT fails', () => {
    service.captureProcessingMode.set('light_polish');
    service.setCaptureProcessingMode('clarify');

    http
      .expectOne('/api/settings/assistant')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(service.captureProcessingMode()).toBe('light_polish');
    expect(service.saveFailed()).toBe(true);
  });

  it('fetches once per session through ensureLoaded', () => {
    service.ensureLoaded();
    service.ensureLoaded();

    http.expectOne('/api/settings/assistant').flush({ captureProcessingMode: 'clarify' });

    expect(service.captureProcessingMode()).toBe('clarify');
  });
});
