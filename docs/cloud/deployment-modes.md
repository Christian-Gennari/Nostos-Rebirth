# Nostos deployment modes

Nostos ships as one application and one release line with two runtime deployment modes.

## Configuration

The server reads:

```text
Nostos:DeploymentMode
```

Supported values:

- `SelfHosted` — default when the setting is absent.
- `Cloud` — hosted Nostos infrastructure.

The setting can use normal ASP.NET Core configuration sources. For example:

```bash
Nostos__DeploymentMode=Cloud
```

Do not infer deployment mode from host names, build configuration, the browser, or separate frontend bundles.

## Product contract

The running backend publishes:

```http
GET /api/runtime/capabilities
```

SelfHosted currently reports the product contract:

```json
{
  "deploymentMode": "SelfHosted",
  "requiresAuthentication": false,
  "canConfigureAiProvider": true,
  "managedAi": false,
  "managedVoiceTranscription": false,
  "usesCloudStorage": false,
  "supportsLocalBackupConfiguration": true,
  "usageMeteringAvailable": false
}
```

Cloud's intended product contract is:

```json
{
  "deploymentMode": "Cloud",
  "requiresAuthentication": true,
  "canConfigureAiProvider": false,
  "managedAi": true,
  "managedVoiceTranscription": true,
  "usesCloudStorage": true,
  "supportsLocalBackupConfiguration": false,
  "usageMeteringAvailable": true
}
```

The capability names describe Nostos behavior. They intentionally do not expose infrastructure vendor choices such as PostgreSQL hosts, object-storage providers, or AI provider credentials.

## Current Cloud persistence state

Issue #396 wires Cloud mode to a separate PostgreSQL control plane and a trusted, tenant-aware customer database factory.

Cloud startup now requires server-side PostgreSQL connection settings and fails closed when they are missing. It never falls back to the SelfHosted SQLite database.

New customer databases are temporarily initialized from the current EF model and tagged `current-model-v1`. Issue #398 replaces that bridge with the permanent PostgreSQL baseline/migration lifecycle without changing the deployment-mode or tenant-routing contract.

## Composition rule

Feature/domain code should not read `Nostos:DeploymentMode` directly.

Deployment-specific infrastructure belongs at composition boundaries:

```text
SelfHosted -> SQLite / local files / owner-managed provider configuration
Cloud      -> PostgreSQL / object storage / managed services
```

Normal Nostos features continue to share the same domain model, repositories, API behavior and Angular application.

## Frontend rule

The Angular application is one build for both modes.

Frontend surfaces that genuinely differ should consume the server capability manifest through `DeploymentCapabilitiesService`. Do not add hostname checks or environment-specific frontend forks.

Issue #407 owns the later Settings/UI adaptation based on these capabilities.
