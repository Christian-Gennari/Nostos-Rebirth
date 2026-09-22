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

## Current Cloud fail-closed state

Issue #394 establishes the deployment boundary before the Cloud infrastructure itself exists.

At this stage, setting `Nostos:DeploymentMode=Cloud` fails startup with an explicit error instead of silently using the SelfHosted SQLite database.

That fail-closed behavior is intentional. It will be replaced by real Cloud persistence composition after the PostgreSQL provisioning/schema work in #396 and #398 is available.

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
