# Nostos Cloud authentication and account identity

Issue: #395

## Decision

Nostos Cloud uses standards-based OpenID Connect / OAuth 2.0 rather than a provider-specific authentication SDK.

For the web/PWA application, Nostos follows a backend-for-frontend shape:

```text
browser
  -> /api/auth/login
  -> OIDC authorization code + PKCE
  -> Nostos backend
  -> HttpOnly Secure session cookie
  -> Nostos API
```

The Angular application never receives OIDC access tokens, refresh tokens, client secrets, issuer/subject identity keys, or provider credentials.

A future native Android client can authenticate against the same issuer using the native-app authorization-code + PKCE pattern and call Nostos with a bearer token. The backend already selects bearer authentication when a request carries an `Authorization: Bearer ...` header.

## Configuration

Cloud auth is only registered when:

```text
Nostos:DeploymentMode = Cloud
```

Configuration:

```text
CloudAuth:Authority
CloudAuth:ClientId
CloudAuth:Audience
CloudAuth:ClientSecretEnvironmentVariable
CloudAuth:SessionHours
```

The client secret itself is never stored in `appsettings.json`. The default environment-variable name is:

```text
NOSTOS_CLOUD_AUTH_CLIENT_SECRET
```

Cloud startup fails closed when required OIDC configuration or the secret is missing.

SelfHosted does not register any of the Cloud authentication schemes and remains zero-auth-provider-dependency.

## Canonical Nostos account identity

Email is display/contact metadata only. It is never an account key.

The trusted external identity is the OpenID Connect pair:

```text
issuer (iss) + subject (sub)
```

Nostos derives an opaque deterministic account GUID from that pair. The resulting `NostosAccountId` is what downstream Cloud infrastructure consumes.

```text
validated OIDC principal
      |
      +-- iss
      +-- sub
           |
           v
   NostosAccountId
           |
           v
 trusted tenant context
```

Request query parameters, JSON bodies and headers cannot select the Nostos account ID.

If Nostos later supports linking multiple identity-provider identities to one account, the control plane can replace the deterministic mapping with explicit aliases without changing the tenant-context interface used by product services.

## Request authorization

Cloud installs a fallback authorization policy for application endpoints.

A protected request must satisfy both:

1. a valid authenticated cookie or bearer token;
2. server-side account status = `Active`.

Account status values are:

- `Unknown`
- `Active`
- `Disabled`
- `Deleted`

The authorization handler checks status on every request. Therefore disabling or deleting an account does not depend on waiting for the browser cookie to expire.

#396 replaces the original fail-closed placeholder with the Cloud control-plane account store. Protected requests therefore succeed only when the trusted account mapping is fully provisioned, on the current Cloud schema version, and marked `Active`.

## Public/auth routes

These routes are deliberately anonymous:

- `GET /api/runtime/capabilities`
- `GET /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- the Angular SPA shell/client routes

The OIDC callback/sign-out callback paths are handled by ASP.NET Core authentication middleware.

All ordinary mapped application API routes inherit the Cloud fallback policy.

The session endpoint exposes only:

```json
{
  "authenticated": true,
  "accountState": "Active",
  "account": {
    "id": "<nostos-account-guid>",
    "displayName": "<display name>",
    "email": "<optional email>"
  }
}
```

It does not expose tokens, `iss`, `sub`, provider configuration, database IDs or storage namespaces.

## Session behavior

The Cloud browser cookie is:

- HttpOnly;
- Secure;
- `__Host-` scoped;
- SameSite=Lax;
- non-sliding;
- bounded by `CloudAuth:SessionHours`.

API authentication failures return 401/403 rather than redirecting API calls to a login page.

Interactive login is an explicit top-level navigation to `/api/auth/login`.

Logout clears the local cookie and invokes OIDC provider sign-out.

## Boundaries with later Cloud issues

### #396 — control plane / provisioning

Provides the account directory/status implementation, stable customer resource mapping, and trusted `NostosAccountId` -> customer database routing described above.

### #403 — entitlements

Consumes the trusted Nostos account identity; it must not derive identity from email or request parameters.

### #404/#405 — managed AI

Usage and quotas are attributed to the trusted account context.

### #409 — onboarding

The hosted onboarding flow now uses these auth endpoints/session semantics behind
one root Angular entry gate. See [onboarding.md](onboarding.md). It does not
implement a second auth flow or expose provider tokens to Angular.
