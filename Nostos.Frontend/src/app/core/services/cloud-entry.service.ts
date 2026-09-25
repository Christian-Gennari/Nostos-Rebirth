import { HttpErrorResponse } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CloudOnboardingSnapshot } from '../dtos/cloud-onboarding.dtos';
import { CloudSession } from '../dtos/cloud-auth.dtos';
import { CloudAuthService } from './cloud-auth.service';
import { CloudOnboardingService } from './cloud-onboarding.service';
import { DeploymentCapabilitiesService } from './deployment-capabilities.service';
import { PortableLibraryService } from './portable-library.service';

export type CloudEntryKind =
  | 'loading'
  | 'product'
  | 'signed_out'
  | 'subscription_required'
  | 'subscription_pending'
  | 'subscription_inactive'
  | 'provisioning'
  | 'provisioning_failed'
  | 'first_run'
  | 'account_unavailable'
  | 'backend_error';

export interface CloudEntryView {
  kind: CloudEntryKind;
  onboarding?: CloudOnboardingSnapshot;
}

/**
 * Single browser orchestration boundary for hosted Cloud entry.
 *
 * The backend remains authoritative for authentication, entitlement and
 * provisioning. Browser persistence is used only for the optional first-run
 * welcome/import choice after this browser has initiated provisioning; it
 * never selects a tenant or controls access.
 */
@Injectable({ providedIn: 'root' })
export class CloudEntryService {
  private readonly session = signal<CloudSession | null>(null);
  private readonly requestedOffer = signal<string | null>(null);
  private pollHandle: ReturnType<typeof setTimeout> | undefined;

  readonly view = signal<CloudEntryView>({ kind: 'loading' });
  readonly actionPending = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly productReady = computed(() => this.view().kind === 'product');
  readonly selectedOffer = computed(() => this.view().onboarding?.selectedOffer ?? null);

  constructor(
    private readonly capabilities: DeploymentCapabilitiesService,
    private readonly auth: CloudAuthService,
    private readonly onboarding: CloudOnboardingService,
    private readonly portableLibrary: PortableLibraryService,
  ) {}

  async initialize(force = false): Promise<void> {
    this.clearPoll();
    this.actionError.set(null);
    this.requestedOffer.set(null);
    this.view.set({ kind: 'loading' });

    try {
      const capabilities = await firstValueFrom(this.capabilities.get(force));
      if (capabilities.deploymentMode === 'SelfHosted') {
        this.session.set(null);
        this.view.set({ kind: 'product' });
        return;
      }

      this.requestedOffer.set(this.readOfferFromLocation());

      const session = await firstValueFrom(this.auth.getSession(force));
      this.session.set(session);

      if (!session.authenticated || !session.account) {
        this.view.set({ kind: 'signed_out' });
        return;
      }

      if (session.accountState === 'Disabled' || session.accountState === 'Deleted') {
        this.view.set({ kind: 'account_unavailable' });
        return;
      }

      await this.refreshOnboarding();
    } catch {
      this.view.set({ kind: 'backend_error' });
    }
  }

  loginUrl(): string {
    const location = globalThis.location;
    const returnUrl = `${location.pathname}${location.search}${location.hash}` || '/';
    return this.auth.loginUrl(returnUrl, this.requestedOffer());
  }

  async retry(): Promise<void> {
    if (this.view().kind === 'provisioning_failed' || this.view().kind === 'provisioning') {
      await this.startProvisioning();
      return;
    }

    if (this.view().kind === 'backend_error') {
      await this.initialize(true);
      return;
    }

    await this.refreshOnboarding();
  }

  async beginCheckout(offerId: string | null): Promise<string | null> {
    const selectedOffer = this.selectedOffer();
    if (!selectedOffer || !offerId || offerId !== selectedOffer.offerId) {
      this.actionError.set('Choose a valid Cloud plan before continuing to checkout.');
      return null;
    }

    this.actionPending.set(true);
    this.actionError.set(null);

    try {
      const redirect = await firstValueFrom(
        this.onboarding.createCheckout(selectedOffer.offerId),
      );
      return redirect.url;
    } catch {
      this.actionError.set('Checkout is temporarily unavailable. Try again.');
      return null;
    } finally {
      this.actionPending.set(false);
    }
  }

  async checkSubscription(): Promise<void> {
    this.actionPending.set(true);
    this.actionError.set(null);

    try {
      const snapshot = await firstValueFrom(this.onboarding.reconcileSubscription());
      await this.applyOnboarding(snapshot);
    } catch {
      this.actionError.set("We couldn't check your subscription right now. Try again.");
    } finally {
      this.actionPending.set(false);
    }
  }

  async openBillingPortal(): Promise<string | null> {
    this.actionPending.set(true);
    this.actionError.set(null);

    try {
      const redirect = await firstValueFrom(this.onboarding.createBillingPortal());
      return redirect.url;
    } catch {
      this.actionError.set('Subscription management is temporarily unavailable. Try again.');
      return null;
    } finally {
      this.actionPending.set(false);
    }
  }

  startFresh(): void {
    this.completeFirstRun();
  }

  async importPortableArchive(file: File): Promise<void> {
    this.actionPending.set(true);
    this.actionError.set(null);

    try {
      await firstValueFrom(this.portableLibrary.importArchive(file));
      this.completeFirstRun();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.actionError.set(
          'This Cloud library already contains data, so the archive was not imported.',
        );
      } else if (error instanceof HttpErrorResponse && error.status === 400) {
        this.actionError.set('That file could not be imported as a Nostos portable library.');
      } else {
        this.actionError.set("We couldn't import that library right now. Try again.");
      }
    } finally {
      this.actionPending.set(false);
    }
  }

  private async refreshOnboarding(): Promise<void> {
    this.clearPoll();

    try {
      const snapshot = await firstValueFrom(this.onboarding.getState(this.requestedOffer()));
      await this.applyOnboarding(snapshot);
    } catch {
      this.view.set({ kind: 'backend_error' });
    }
  }

  private async startProvisioning(): Promise<void> {
    this.clearPoll();
    this.markFirstRunPending();
    this.view.set({ kind: 'provisioning' });
    this.actionError.set(null);

    try {
      const snapshot = await firstValueFrom(this.onboarding.provision());
      await this.applyOnboarding(snapshot);
    } catch {
      // A dropped browser request does not own provisioning lifetime on the
      // server. Re-reading the control plane is the safe recovery path.
      this.view.set({ kind: 'backend_error' });
    }
  }

  private async applyOnboarding(snapshot: CloudOnboardingSnapshot): Promise<void> {
    switch (snapshot.state) {
      case 'ready':
        this.clearPoll();
        this.view.set({
          kind: this.hasFirstRunPending() ? 'first_run' : 'product',
          onboarding: snapshot,
        });
        return;

      case 'ready_to_provision':
        await this.startProvisioning();
        return;

      case 'provisioning':
        this.view.set({ kind: 'provisioning', onboarding: snapshot });
        this.schedulePoll();
        return;

      case 'provisioning_failed':
        this.clearPoll();
        this.view.set({ kind: 'provisioning_failed', onboarding: snapshot });
        return;

      case 'subscription_required':
        this.clearPoll();
        this.view.set({ kind: 'subscription_required', onboarding: snapshot });
        return;

      case 'subscription_pending':
        this.clearPoll();
        this.view.set({ kind: 'subscription_pending', onboarding: snapshot });
        return;

      case 'subscription_inactive':
        this.clearPoll();
        this.view.set({ kind: 'subscription_inactive', onboarding: snapshot });
        return;

      case 'account_unavailable':
        this.clearPoll();
        this.view.set({ kind: 'account_unavailable', onboarding: snapshot });
        return;
    }
  }

  private readOfferFromLocation(): string | null {
    const location = globalThis.location;
    if (location.pathname !== '/start' && location.pathname !== '/start/') return null;

    return new URLSearchParams(location.search).get('offer');
  }

  private schedulePoll(): void {
    this.clearPoll();
    this.pollHandle = setTimeout(() => {
      void this.refreshOnboarding();
    }, 1500);
  }

  private clearPoll(): void {
    if (this.pollHandle !== undefined) {
      clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  private markerKey(): string | null {
    const accountId = this.session()?.account?.id;
    return accountId ? `nostos.cloud.first-run.${accountId}` : null;
  }

  private markFirstRunPending(): void {
    const key = this.markerKey();
    if (!key) return;

    try {
      localStorage.setItem(key, 'pending');
    } catch {
      // Optional UX persistence only. Access/provisioning never depends on it.
    }
  }

  private hasFirstRunPending(): boolean {
    const key = this.markerKey();
    if (!key) return false;

    try {
      return localStorage.getItem(key) === 'pending';
    } catch {
      return false;
    }
  }

  private completeFirstRun(): void {
    const key = this.markerKey();
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Optional UX persistence only.
      }
    }

    this.actionError.set(null);
    this.view.set({ kind: 'product' });
  }
}
