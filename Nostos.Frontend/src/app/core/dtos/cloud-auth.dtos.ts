export type CloudAccountState = 'Unknown' | 'Active' | 'Disabled' | 'Deleted' | 'DeletionRequested';

export interface CloudSessionAccount {
  id: string;
  displayName: string;
  email: string | null;
}

export interface CloudSession {
  authenticated: boolean;
  accountState: CloudAccountState | null;
  account: CloudSessionAccount | null;
}
