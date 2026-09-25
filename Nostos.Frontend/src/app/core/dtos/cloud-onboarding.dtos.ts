export type CloudOnboardingState =
  | 'subscription_required'
  | 'subscription_pending'
  | 'checkout_pending'
  | 'grace'
  | 'past_due'
  | 'canceled'
  | 'subscription_inactive'
  | 'inactive'
  | 'ready_to_provision'
  | 'provisioning'
  | 'provisioning_failed'
  | 'ready'
  | 'account_unavailable';

export interface CloudOnboardingOffer {
  offerId: string;
  planName: string;
  billingCadence: string;
}

export interface CloudOnboardingSnapshot {
  state: CloudOnboardingState;
  subscriptionStatus: string | null;
  ready: boolean;
  canCheckout: boolean;
  canCheckSubscription: boolean;
  canManageSubscription: boolean;
  canRetry: boolean;
  selectedOffer: CloudOnboardingOffer | null;
}

export interface CloudOnboardingCheckoutRequest {
  offerId: string;
}

export interface CloudOnboardingRedirect {
  url: string;
}
