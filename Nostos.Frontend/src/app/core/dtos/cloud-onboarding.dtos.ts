export type CloudOnboardingState =
  | 'subscription_required'
  | 'subscription_pending'
  | 'subscription_inactive'
  | 'ready_to_provision'
  | 'provisioning'
  | 'provisioning_failed'
  | 'ready'
  | 'account_unavailable';

export interface CloudOnboardingSnapshot {
  state: CloudOnboardingState;
  subscriptionStatus: string | null;
  ready: boolean;
  canCheckout: boolean;
  canCheckSubscription: boolean;
  canManageSubscription: boolean;
  canRetry: boolean;
}

export interface CloudOnboardingRedirect {
  url: string;
}
