import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CloudAuthService } from './cloud-auth.service';
import { CloudEntryService } from './cloud-entry.service';
import { CloudOnboardingService } from './cloud-onboarding.service';
import { DeploymentCapabilitiesService } from './deployment-capabilities.service';
import { PortableLibraryService } from './portable-library.service';

describe('CloudEntryService', () => {
  let service: CloudEntryService;
  let capabilities: jasmine.SpyObj<DeploymentCapabilitiesService>;
  let auth: jasmine.SpyObj<CloudAuthService>;
  let onboarding: jasmine.SpyObj<CloudOnboardingService>;

  const cloudCapabilities = {
    deploymentMode: 'Cloud' as const,
    requiresAuthentication: true,
    canConfigureAiProvider: false,
    managedAi: true,
    managedVoiceTranscription: true,
    usesCloudStorage: true,
    supportsLocalBackupConfiguration: false,
    supportsPrivateNetworkAccess: false,
    usageMeteringAvailable: true,
  };

  const session = {
    authenticated: true,
    accountState: 'Unknown' as const,
    account: {
      id: '1e4df713-1a34-4fc7-9a90-c45169256845',
      displayName: 'Reader',
      email: 'reader@example.test',
    },
  };

  beforeEach(() => {
    localStorage.clear();

    capabilities = jasmine.createSpyObj<DeploymentCapabilitiesService>(
      'DeploymentCapabilitiesService',
      ['get'],
    );
    auth = jasmine.createSpyObj<CloudAuthService>('CloudAuthService', ['getSession', 'loginUrl']);
    onboarding = jasmine.createSpyObj<CloudOnboardingService>(
      'CloudOnboardingService',
      ['getState', 'provision', 'createCheckout', 'reconcileSubscription', 'createBillingPortal'],
    );

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        CloudEntryService,
        { provide: DeploymentCapabilitiesService, useValue: capabilities },
        { provide: CloudAuthService, useValue: auth },
        { provide: CloudOnboardingService, useValue: onboarding },
        {
          provide: PortableLibraryService,
          useValue: { importArchive: jasmine.createSpy().and.returnValue(of({})) },
        },
      ],
    });

    service = TestBed.inject(CloudEntryService);
  });

  it('leaves SelfHosted on the normal product path without Cloud auth', async () => {
    capabilities.get.and.returnValue(of({
      ...cloudCapabilities,
      deploymentMode: 'SelfHosted',
      requiresAuthentication: false,
    }));

    await service.initialize();

    expect(service.productReady()).toBeTrue();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(onboarding.getState).not.toHaveBeenCalled();
  });

  it('shows the hosted sign-in path for a signed-out Cloud user', async () => {
    capabilities.get.and.returnValue(of(cloudCapabilities));
    auth.getSession.and.returnValue(of({
      authenticated: false,
      accountState: null,
      account: null,
    }));

    await service.initialize();

    expect(service.view().kind).toBe('signed_out');
    expect(service.productReady()).toBeFalse();
  });

  it('never flashes the normal app while subscription access is missing', async () => {
    capabilities.get.and.returnValue(of(cloudCapabilities));
    auth.getSession.and.returnValue(of(session));
    onboarding.getState.and.returnValue(of({
      state: 'subscription_required',
      subscriptionStatus: 'None',
      ready: false,
      canCheckout: true,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: false,
    }));

    await service.initialize();

    expect(service.view().kind).toBe('subscription_required');
    expect(service.productReady()).toBeFalse();
  });

  it('starts idempotent provisioning for an entitled new account', async () => {
    capabilities.get.and.returnValue(of(cloudCapabilities));
    auth.getSession.and.returnValue(of(session));
    onboarding.getState.and.returnValue(of({
      state: 'ready_to_provision',
      subscriptionStatus: 'Trial',
      ready: false,
      canCheckout: false,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: true,
    }));
    onboarding.provision.and.returnValue(of({
      state: 'ready',
      subscriptionStatus: 'Trial',
      ready: true,
      canCheckout: false,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: false,
    }));

    await service.initialize();

    expect(onboarding.provision).toHaveBeenCalledTimes(1);
    expect(service.view().kind).toBe('first_run');
    expect(service.productReady()).toBeFalse();

    service.startFresh();
    expect(service.productReady()).toBeTrue();
  });

  it('resumes polling from server state after refresh during provisioning', fakeAsync(() => {
    capabilities.get.and.returnValue(of(cloudCapabilities));
    auth.getSession.and.returnValue(of(session));
    onboarding.getState.and.returnValues(
      of({
        state: 'provisioning',
        subscriptionStatus: 'Active',
        ready: false,
        canCheckout: false,
        canCheckSubscription: false,
        canManageSubscription: false,
        canRetry: false,
      }),
      of({
        state: 'ready',
        subscriptionStatus: 'Active',
        ready: true,
        canCheckout: false,
        canCheckSubscription: false,
        canManageSubscription: false,
        canRetry: false,
      }),
    );

    void service.initialize();
    tick();

    expect(service.view().kind).toBe('provisioning');
    expect(onboarding.provision).not.toHaveBeenCalled();

    tick(1500);
    tick();

    expect(service.productReady()).toBeTrue();
  }));

  it('ready returning accounts enter the normal app directly', async () => {
    capabilities.get.and.returnValue(of(cloudCapabilities));
    auth.getSession.and.returnValue(of({
      ...session,
      accountState: 'Active',
    }));
    onboarding.getState.and.returnValue(of({
      state: 'ready',
      subscriptionStatus: 'Active',
      ready: true,
      canCheckout: false,
      canCheckSubscription: false,
      canManageSubscription: false,
      canRetry: false,
    }));

    await service.initialize();

    expect(service.productReady()).toBeTrue();
    expect(service.view().kind).toBe('product');
  });

  it('does not let disabled accounts enter or trigger provisioning', async () => {
    capabilities.get.and.returnValue(of(cloudCapabilities));
    auth.getSession.and.returnValue(of({
      ...session,
      accountState: 'Disabled',
    }));

    await service.initialize();

    expect(service.view().kind).toBe('account_unavailable');
    expect(onboarding.getState).not.toHaveBeenCalled();
    expect(onboarding.provision).not.toHaveBeenCalled();
  });
});
