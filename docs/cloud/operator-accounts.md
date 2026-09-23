# Nostos Cloud — Operator accounts and provider identity

Issue: #440  
Part of #258 — Nostos Cloud.

## Purpose

Nostos Cloud depends on external cloud and operational service providers. To ensure operational continuity, security isolation, and clear business ownership, all production and alpha infrastructure accounts are anchored to the canonical Nostos domain identity (`nostos.page`) rather than personal mailboxes.

This document serves as the operator-facing reference for provider account ownership, canonical contacts, resource identifiers, expected runtime secret environment variables, MFA/recovery models, and rotation procedures.

**Security invariant:** This document contains **secret names, resource identifiers, and procedures only — never secret values**.

---

## Canonical Nostos contact and mail identity

- **Mailbox Provider:** Lark Mail (Lark Suite)
- **Primary Operational Address:** `ops@nostos.page`
- **Aliases:**
  - `billing@nostos.page` — Invoicing, payment gateways, commercial correspondence.
  - `security@nostos.page` — Security reports, DMARC aggregate reports (`rua`), abuse notices.
  - `admin@nostos.page` — General administrative and platform communications.
- **DNS / Mail Authentication:**
  - **MX:** `mx1.larksuite.com` (pri 1), `mx2.larksuite.com` (pri 5), `mx3.larksuite.com` (pri 10)
  - **SPF:** `v=spf1 include:spf.onlarksuite.com -all`
  - **DKIM:** `lark2609231042._domainkey.nostos.page` (2048-bit RSA)
  - **DMARC:** `_dmarc.nostos.page` (`v=DMARC1; p=none; rua=mailto:security@nostos.page`)
- **MFA / Organization Security Limitation:**
  - Lark Starter tier does not enforce organization-wide mandatory MFA policies. Individual account security relies on strong, unique passwords and application-level session controls. Documented as an acceptable tier constraint for #440.

---

## Provider inventory and ownership summary

| Provider | Purpose | Canonical Contact | Organization / Project / Resource ID | Runtime Secret Name(s) | MFA / Auth Model | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **Lark Mail** | Operator email & aliases | `ops@nostos.page` | Tenant `Nostos` | N/A (platform service) | Password / Session; Org MFA unenforced | Active & verified |
| **Vercel AI Gateway** | Managed Cloud LLM | `christian-gennaris-projects` team | Key `nostos-cloud-managed-ai` ($5/mo budget) | `NOSTOS_CLOUD_AI_GATEWAY_API_KEY` | Vercel team auth / GitHub SSO | Active & smoke-tested |
| **Groq** | Managed Cloud STT | `ops@nostos.page` | Org `Nostos` (`org_01m36z8gp8e94a0jgw3ggj4jf2`), Project `Nostos Cloud` (`project_01m36zjz52ezyrsp40s1phwxnk`) | `NOSTOS_CLOUD_GROQ_API_KEY` | Passwordless Stytch email verification to `ops@` | Active & smoke-tested |
| **Clerk** | Managed Auth & Accounts | `contact@cgennari.com` (pending co-admin `ops@`) | App `Nostos` (`app_3Jh5c9J9bK3MAPXJYLFJhNQHLS8`), Instance `ins_3Jh5c2V8AjyTkk8RYcFcbIAjNpq` | `NOSTOS_CLOUD_AUTH_CLIENT_SECRET` | Email / OTP / OAuth | Active (Alpha) |
| **Paddle** | Billing & Subscriptions | `christiangennari61@gmail.com` (Sandbox; contact `billing@nostos.page`) | Product `pro_01m35farcv0czvbq6fn6jb1rvz`, Price `pri_01m35fashc62w526jw2rjnshrh` | `NOSTOS_CLOUD_BILLING_PADDLE_API_KEY`, `NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET` | Two-factor SMS / App | Sandbox Active |
| **Neon** | Serverless PostgreSQL | Org `Nostos` (`org-aged-wave-24212539`), Admins: `contact@cgennari.com`, `ops@nostos.page` | Projects: `nostos-customers` (`wandering-wind-99439546`), `nostos-control-plane` (`little-bread-40821565`) | `NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION`, `NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION`, `NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION` | Neon account / GitHub SSO / MFA | Active & Co-Admin verified |
| **Backblaze B2** | Object Storage (Media/Backups) | Christian personal account | Account ID `a4c0ecd810e7`, Buckets: `nostos-cloud`, `nostos-cloud-dr` | `NOSTOS_CLOUD_OBJECT_STORAGE_ACCESS_KEY`, `NOSTOS_CLOUD_OBJECT_STORAGE_SECRET_KEY` | 2FA (SMS / TOTP) | Alpha Active |
| **Vercel / Domains** | Web hosting & DNS | `christian-gennaris-projects` | Domains: `nostos.page`, `cgennari.com` | `VERCEL_TOKEN` (CLI / deployment) | GitHub SSO / TOTP | Active |

---

## Detailed provider profiles

### 1. Vercel AI Gateway (Managed Cloud LLM)
- **Role:** Upstream OpenAI-compatible gateway routing managed Ask Nostos completions to `google/gemini-3.8-flash` with explicit `reasoning_effort: low`.
- **Base URL:** `https://ai-gateway.vercel.sh/v1`
- **Key Name:** `nostos-cloud-managed-ai`
- **Key Spend Limit:** $5.00 / month custom key budget cap.
- **Runtime Secret:** `NOSTOS_CLOUD_AI_GATEWAY_API_KEY` (replaces deprecated `NOSTOS_CLOUD_GEMINI_API_KEY`).
- **Rotation Procedure:**
  1. Generate a new key in Vercel AI Gateway dashboard with $5/month budget.
  2. Update `~/.hermes/private/nostos-cloud/secrets.env` (file mode `0600`).
  3. Verify completion and tool-calling smoke tests against `https://ai-gateway.vercel.sh/v1`.
  4. Invalidate the old key in Vercel dashboard. Zero downtime.

### 2. Groq (Managed Cloud STT)
- **Role:** High-speed speech-to-text transcription using `whisper-large-v3-turbo`.
- **Base URL:** `https://api.groq.com/openai/v1`
- **Account:** Owned directly by `ops@nostos.page`.
- **Organization:** `Nostos` (`org_01m36z8gp8e94a0jgw3ggj4jf2`).
- **Project:** `Nostos Cloud` (`project_01m36zjz52ezyrsp40s1phwxnk`).
- **Key Name:** `nostos-cloud-stt` (scoped strictly to `whisper-large-v3-turbo`).
- **Runtime Secret:** `NOSTOS_CLOUD_GROQ_API_KEY`.
- **Rate Limits & Tier:** Free tier active (20 RPM, 2,000 RPD, 7,200 audio seconds/hr, 28,800 audio seconds/day). Upgrades to Developer pay-per-token tier currently paused upstream by Groq.
- **Rotation Procedure:**
  1. Log into Groq Console with `ops@nostos.page` via email verification.
  2. In Project `Nostos Cloud` > API Keys, generate a replacement key `nostos-cloud-stt-v2`.
  3. Update `NOSTOS_CLOUD_GROQ_API_KEY` in `secrets.env`.
  4. Run smoke test (`test_en.mp3` / `test_sv.mp3`).
  5. Delete previous key in Groq console.

### 3. Clerk (Authentication & Identity)
- **Role:** Hosted authentication and OIDC authority for Nostos Cloud accounts.
- **Application:** `Nostos` (`app_3Jh5c9J9bK3MAPXJYLFJhNQHLS8`).
- **Development Instance:** `ins_3Jh5c2V8AjyTkk8RYcFcbIAjNpq` (`definite-quetzal-3503.clerk.accounts.dev`).
- **Primary Owner:** `contact@cgennari.com`.
- **Runtime Secret:** `NOSTOS_CLOUD_AUTH_CLIENT_SECRET`.
- **Operational Action:** Add `ops@nostos.page` as invited member/admin in Clerk Dashboard > Settings > Members.

### 4. Paddle (Billing & Subscriptions)
- **Role:** Merchant of record, billing lifecycle, checkout, webhook event ingestion (#410).
- **Environment:** Sandbox currently active (`https://sandbox-vendors.paddle.com`).
- **Account Owner:** `christiangennari61@gmail.com`.
- **Operational Contact:** Invoices and notification settings route to `billing@nostos.page`.
- **Product ID:** `pro_01m35farcv0czvbq6fn6jb1rvz` (`Nostos Cloud Sandbox`).
- **Price ID:** `pri_01m35fashc62w526jw2rjnshrh` (USD 5.00/mo, 7-day trial).
- **Runtime Secrets:**
  - `NOSTOS_CLOUD_BILLING_PADDLE_API_KEY`
  - `NOSTOS_CLOUD_BILLING_PADDLE_WEBHOOK_SECRET`
- **Rotation Procedure:**
  - Generate new API key / webhook destination in Paddle dashboard.
  - Update `secrets.env` and redeploy.
  - Revoke obsolete key. Note: Paddle sandbox API keys carry a 1-year expiration (created 2026-09-22, expires 2027-09-22).

### 5. Neon (Database — PostgreSQL)
- **Role:** Serverless PostgreSQL cluster providing tenant isolation and control plane for alpha (#393, #396).
- **Organization:** `Nostos` (`org-aged-wave-24212539`), Plan: Free.
- **Primary Admin:** `contact@cgennari.com`.
- **Co-Admin:** `ops@nostos.page` (Joined and verified).
- **Projects:**
  - `nostos-control-plane` (`little-bread-40821565`)
  - `nostos-customers` (`wandering-wind-99439546`)
- **Runtime Secrets:**
  - `NOSTOS_CLOUD_CONTROL_PLANE_CONNECTION`
  - `NOSTOS_CLOUD_POSTGRES_ADMIN_CONNECTION`
  - `NOSTOS_CLOUD_POSTGRES_CUSTOMER_CONNECTION`
- **Rotation Procedure:**
  - Neon passwords can be reset per role via Neon Console or Neon API.
  - Update connection strings in `~/.config/nostos-cloud/neon.env` and runtime secret store.

### 6. Backblaze B2 (Media & Backup Storage)
- **Role:** S3-compatible object storage for book files, audiobooks, covers, and disaster recovery replication (#397, #400).
- **Account ID:** `a4c0ecd810e7`.
- **Region:** `eu-central-003` (`s3.eu-central-003.backblazeb2.com`).
- **Buckets:**
  - `nostos-cloud` (Primary media & customer uploads).
  - `nostos-cloud-dr` (Disaster recovery replica).
- **Runtime Secrets:**
  - `NOSTOS_CLOUD_OBJECT_STORAGE_ACCESS_KEY`
  - `NOSTOS_CLOUD_OBJECT_STORAGE_SECRET_KEY`
- **Rotation Procedure:**
  - Application keys are scoped strictly to bucket `nostos-cloud`.
  - Keys can be created and deleted with zero downtime via B2 web console or B2 API.
  - Regenerate in B2 console, update `~/.config/nostos-cloud/b2.env`, test via `rclone`, then revoke prior key ID.

### 7. Vercel & Domain (`nostos.page`)
- **Role:** Domain registrar, authoritative DNS, marketing site & documentation hosting.
- **Team:** `christian-gennaris-projects`.
- **Registered Domain:** `nostos.page` (Renews Sep 19, 2027).
- **DNS Records:** Authoritatively managed on Vercel nameservers, hosting apex `nostos.page`, `docs.nostos.page`, and Lark Mail MX/SPF/DKIM/DMARC records.
- **Ownership Notes:** Domain is tied to Christian's Vercel account. Retaining Vercel management prevents DNS disruption while serving commercial subdomains.

---

## Remaining personal dependencies & rationale

1. **Vercel Account & Domain Registration:** `nostos.page` registration and project deployment remain under `christian-gennaris-projects` on Vercel. Transferring DNS/domains to an external registrar introduces unnecessary downtime risk for zero functional gain at this stage.
2. **Backblaze B2 Root Account:** The root B2 account is personal, but operational access is strictly segregated using scoped application keys (`NOSTOS_CLOUD_OBJECT_STORAGE_*`) that only possess read/write access to the specific `nostos-cloud` bucket.
3. **Paddle Merchant Account:** Paddle requires a verified human / legal entity (KYC) for payouts and merchant onboarding. Once legal structure decisions (sole proprietorship vs corporate incorporation) are finalized, merchant details will be migrated to the corporate entity.
