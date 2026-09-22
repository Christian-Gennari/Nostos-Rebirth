export type DeploymentMode = 'SelfHosted' | 'Cloud';

export interface DeploymentCapabilities {
  deploymentMode: DeploymentMode;
  requiresAuthentication: boolean;
  canConfigureAiProvider: boolean;
  managedAi: boolean;
  managedVoiceTranscription: boolean;
  usesCloudStorage: boolean;
  supportsLocalBackupConfiguration: boolean;
  usageMeteringAvailable: boolean;
}
