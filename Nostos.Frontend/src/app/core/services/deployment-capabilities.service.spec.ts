import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { DeploymentCapabilitiesService } from './deployment-capabilities.service';

describe('DeploymentCapabilitiesService', () => {
  let service: DeploymentCapabilitiesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(DeploymentCapabilitiesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('loads the runtime capability contract from the backend', async () => {
    const resultPromise = firstValueFrom(service.get());

    const request = http.expectOne('/api/runtime/capabilities');
    expect(request.request.method).toBe('GET');

    request.flush({
      deploymentMode: 'SelfHosted',
      requiresAuthentication: false,
      canConfigureAiProvider: true,
      managedAi: false,
      managedVoiceTranscription: false,
      usesCloudStorage: false,
      supportsLocalBackupConfiguration: true,
      supportsPrivateNetworkAccess: true,
      supportsEreaderAccess: true,
      usageMeteringAvailable: false,
      accountManagementUrl: null,
    });

    const result = await resultPromise;
    expect(result.deploymentMode).toBe('SelfHosted');
    expect(result.canConfigureAiProvider).toBe(true);
    expect(result.managedAi).toBe(false);
    expect(result.supportsEreaderAccess).toBe(true);
  });

  it('replays one server-authoritative result instead of refetching per consumer', async () => {
    const firstPromise = firstValueFrom(service.get());

    const request = http.expectOne('/api/runtime/capabilities');
    request.flush({
      deploymentMode: 'Cloud',
      requiresAuthentication: true,
      canConfigureAiProvider: false,
      managedAi: true,
      managedVoiceTranscription: true,
      usesCloudStorage: true,
      supportsLocalBackupConfiguration: false,
      supportsPrivateNetworkAccess: false,
      supportsEreaderAccess: true,
      usageMeteringAvailable: true,
      accountManagementUrl: 'https://nostos.page/account',
    });

    const first = await firstPromise;
    const second = await firstValueFrom(service.get());

    http.expectNone('/api/runtime/capabilities');
    expect(first).toEqual(second);
    expect(second.deploymentMode).toBe('Cloud');
    expect(second.accountManagementUrl).toBe('https://nostos.page/account');
  });
  it('can refetch the capability contract for a safe retry after a transient failure', async () => {
    const firstPromise = firstValueFrom(service.get());
    http.expectOne('/api/runtime/capabilities').flush({
      deploymentMode: 'Cloud',
      requiresAuthentication: true,
      canConfigureAiProvider: false,
      managedAi: true,
      managedVoiceTranscription: true,
      usesCloudStorage: true,
      supportsLocalBackupConfiguration: false,
      supportsPrivateNetworkAccess: false,
      supportsEreaderAccess: true,
      usageMeteringAvailable: true,
      accountManagementUrl: 'https://nostos.page/account',
    });
    await firstPromise;

    const refreshPromise = firstValueFrom(service.get(true));
    const request = http.expectOne('/api/runtime/capabilities');
    request.flush({
      deploymentMode: 'SelfHosted',
      requiresAuthentication: false,
      canConfigureAiProvider: true,
      managedAi: false,
      managedVoiceTranscription: false,
      usesCloudStorage: false,
      supportsLocalBackupConfiguration: true,
      supportsPrivateNetworkAccess: true,
      supportsEreaderAccess: true,
      usageMeteringAvailable: false,
      accountManagementUrl: null,
    });

    expect((await refreshPromise).deploymentMode).toBe('SelfHosted');
  });
});
