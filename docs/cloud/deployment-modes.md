# Nostos deployment capabilities

Nostos has one product, one domain model, and one Angular customer application.
The public `Nostos.Backend` executable runs SelfHosted. The official hosted service
uses a separate private executable that composes the same public `Nostos.Product`
and frontend source.

## Product contract

The backend publishes the server-authoritative capability manifest:

```http
GET /api/runtime/capabilities
```

SelfHosted reports:

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

The same public contract defines the capabilities used by the private hosted
executable:

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

Capability names describe product behavior. They do not expose infrastructure
vendors, tenant identifiers, or provider credentials. Hosted API implementations
and their configuration live in the private Nostos-Cloud repository.

## Public SelfHosted composition

The public executable always registers:

```text
SQLite + local filesystem media + local backup/restore + customer-configured BYOK
```

It does not load hosted auth, billing, tenant provisioning, managed-provider,
object-storage, or operator-recovery implementations. Starting a public clone
does not require private repository access or hosted credentials.

## Frontend rule

The Angular application is built once from public source and is shared with the
private hosted executable at the pinned public commit. Frontend components use
`DeploymentCapabilitiesService`; they do not infer deployment from a hostname or
use a private frontend fork.
