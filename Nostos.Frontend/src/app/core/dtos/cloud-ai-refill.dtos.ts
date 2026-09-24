export type CloudManagedAiUsageState =
  | 'not_applicable'
  | 'not_included'
  | 'normal'
  | 'near_limit'
  | 'using_refill'
  | 'exhausted'
  | 'temporarily_unavailable';

export type CloudManagedAiRefillState = 'not_offered' | 'active' | 'low' | 'empty';

export interface CloudManagedAiRefillStatus {
  available: boolean;
  state: CloudManagedAiRefillState;
}

export interface CloudManagedAiUsage {
  state: CloudManagedAiUsageState;
  renewsAtUtc: string | null;
  refill: CloudManagedAiRefillStatus;
}

export interface CloudAiRefillPack {
  packId: string;
  displayName: string;
  displayPrice: string | null;
}

export interface CloudAiRefillPacksResponse {
  packs: CloudAiRefillPack[];
}

export interface CloudAiRefillCheckout {
  packId: string;
  checkoutUrl: string;
}
