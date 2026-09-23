#!/usr/bin/env bash
set -euo pipefail

# Mints a fresh, short-lived Clerk session bearer JWT just-in-time for staging smoke.
# Uses the official Clerk Backend API to:
#  1. Create an ephemeral session for the staging user
#  2. Mint a JWT from the designated template (nostos-api)
#  3. Revoke the ephemeral session immediately
#  4. Mask and export the bearer token

secret_key="${NOSTOS_STAGING_CLERK_SECRET_KEY:-}"
user_id="${NOSTOS_STAGING_CLERK_USER_ID:-user_3JjKRM8qTH3Vj6SHWy7WqOvtIOF}"
template_name="${NOSTOS_STAGING_CLERK_JWT_TEMPLATE:-nostos-api}"

if [ -z "$secret_key" ]; then
  echo "Error: NOSTOS_STAGING_CLERK_SECRET_KEY is required to mint staging bearer token." >&2
  exit 1
fi

python3 - <<PYEOF
import json
import os
import sys
import urllib.request
import urllib.error

secret_key = os.environ["NOSTOS_STAGING_CLERK_SECRET_KEY"].strip()
user_id = os.environ.get("NOSTOS_STAGING_CLERK_USER_ID", "user_3JjKRM8qTH3Vj6SHWy7WqOvtIOF").strip()
template_name = os.environ.get("NOSTOS_STAGING_CLERK_JWT_TEMPLATE", "nostos-api").strip()

headers = {
    "Authorization": f"Bearer {secret_key}",
    "User-Agent": "Mozilla/5.0 (compatible; NostosCI/1.0)",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

# 1. Create active session
create_sess_req = urllib.request.Request(
    "https://api.clerk.com/v1/sessions",
    data=json.dumps({"user_id": user_id}).encode("utf-8"),
    headers=headers,
    method="POST"
)

try:
    with urllib.request.urlopen(create_sess_req, timeout=30) as resp:
        sess_data = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    sys.stderr.write(f"Error creating Clerk session: HTTP {e.status} {e.reason}\n")
    sys.exit(1)
except Exception as e:
    sys.stderr.write(f"Error creating Clerk session: {e}\n")
    sys.exit(1)

session_id = sess_data.get("id")
if not session_id:
    sys.stderr.write("Error: Clerk session response missing id\n")
    sys.exit(1)

token = None
try:
    # 2. Mint token from JWT template
    mint_req = urllib.request.Request(
        f"https://api.clerk.com/v1/sessions/{session_id}/tokens/{template_name}",
        data=b"",
        headers=headers,
        method="POST"
    )
    with urllib.request.urlopen(mint_req, timeout=30) as resp:
        token_data = json.loads(resp.read().decode("utf-8"))
        token = token_data.get("jwt")
except urllib.error.HTTPError as e:
    sys.stderr.write(f"Error minting Clerk token from template '{template_name}': HTTP {e.status} {e.reason}\n")
except Exception as e:
    sys.stderr.write(f"Error minting Clerk token: {e}\n")
finally:
    # 3. Always revoke the ephemeral session
    revoke_req = urllib.request.Request(
        f"https://api.clerk.com/v1/sessions/{session_id}/revoke",
        data=b"",
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(revoke_req, timeout=15):
            pass
    except Exception:
        pass

if not token:
    sys.stderr.write(f"Error: failed to obtain JWT from template '{template_name}'\n")
    sys.exit(1)

# Mask token in GitHub Actions if running inside GitHub Actions
if "GITHUB_OUTPUT" in os.environ or "GITHUB_ACTIONS" in os.environ:
    print(f"::add-mask::{token}")

# Write to GITHUB_OUTPUT if present
github_output = os.environ.get("GITHUB_OUTPUT")
if github_output and os.path.exists(github_output):
    with open(github_output, "a") as f:
        f.write(f"bearer_token={token}\n")

# Also print token to stdout for shell capturing
print(token)
PYEOF
