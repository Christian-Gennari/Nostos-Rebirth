#!/usr/bin/env bash
set -euo pipefail

# Contract test for the staging smoke path (staging-smoke.sh + mint-staging-bearer.sh).
# Needs no network access and no Clerk credentials: one local fake serves both the
# Clerk Backend API routes the mint script calls and the staging API routes the smoke
# calls, and records every request it received.
#
# It pins the two properties that a real release run proved were missing:
#   1. GitHub Actions renders an unconfigured variable as an EMPTY string, so the
#      dedicated staging user id / JWT template defaults must still apply.
#   2. The minted bearer must reach curl without an embedded newline -- under Actions
#      the mint script prints its ::add-mask:: directive before the token, so the
#      caller has to read the LAST line of stdout or curl fails with
#      "(43) Failed sending HTTP request".

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
smoke="$here/staging-smoke.sh"
mint="$here/mint-staging-bearer.sh"

for tool in curl jq python3; do
  command -v "$tool" >/dev/null || { echo "SKIP: $tool is required" >&2; exit 0; }
done

work="$(mktemp -d)"
fake_pid=""
cleanup() {
  if [ -n "$fake_pid" ]; then kill "$fake_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

python3 - "$work" <<'PY' &
import http.server
import json
import pathlib
import socketserver
import sys

work = pathlib.Path(sys.argv[1])
log = work / "requests.jsonl"
expected_user = "user_3JjKRM8qTH3Vj6SHWy7WqOvtIOF"
token = "header.payload.signature"
created = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def record(self, body=None):
        entry = {"method": self.command, "path": self.path,
                 "auth": self.headers.get("Authorization", ""), "body": body}
        with log.open("a") as handle:
            handle.write(json.dumps(entry) + "\n")

    def reply(self, code, payload=None):
        raw = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(code)
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if raw:
            self.wfile.write(raw)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {"__unparsed__": True}

    def do_POST(self):
        body = self.read_body()
        self.record(body)
        if self.path == "/v1/sessions":
            if body.get("user_id") == expected_user:
                self.reply(200, {"id": "sess_test", "status": "active"})
            else:
                # What Clerk answers for a missing user_id -- the shape behind the 422.
                self.reply(422, {"errors": [{"code": "form_param_missing"}]})
        elif self.path == "/v1/sessions/sess_test/tokens/nostos-api":
            self.reply(200, {"jwt": token})
        elif self.path == "/v1/sessions/sess_test/revoke":
            self.reply(200, {"id": "sess_test", "status": "revoked"})
        elif self.path == "/api/cloud/provisioning/":
            self.reply(200, {"ready": True, "accountState": "Active"})
        elif self.path == "/api/books/":
            created["title"] = body.get("title")
            self.reply(201, {"id": "book_test", "title": created["title"]})
        else:
            self.reply(404, {"errors": [{"code": "resource_not_found"}]})

    def do_GET(self):
        self.record()
        if self.path == "/api/auth/session":
            if self.headers.get("Authorization") == f"Bearer {token}":
                self.reply(200, {"authenticated": True, "accountState": "Active",
                                 "account": {"id": "acct_test"}})
            else:
                self.reply(200, {"authenticated": False, "accountState": None, "account": None})
        elif self.path == "/api/runtime/capabilities":
            self.reply(200, {"deploymentMode": "Cloud", "requiresAuthentication": True,
                             "usesCloudStorage": True})
        elif self.path == "/api/books/book_test":
            self.reply(200, {"id": "book_test", "title": created.get("title")})
        elif self.path in ("/health/live", "/health/ready", "/"):
            self.reply(200, {})
        else:
            self.reply(404, {"errors": [{"code": "resource_not_found"}]})

    def do_DELETE(self):
        self.record()
        self.reply(200, {})

    def log_message(self, *args):
        pass


with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    (work / "port").write_text(str(server.server_address[1]))
    server.serve_forever()
PY
fake_pid=$!

for _ in $(seq 1 100); do
  if [ -s "$work/port" ]; then break; fi
  sleep 0.1
done
if [ ! -s "$work/port" ]; then
  echo "FAIL: the fake API never started" >&2
  exit 1
fi

port="$(cat "$work/port")"
api_base="http://127.0.0.1:$port"
staging_user="user_3JjKRM8qTH3Vj6SHWy7WqOvtIOF"
token="header.payload.signature"
failures=0

pass() { echo "  ok: $1"; }
fail() { echo "  FAIL: $1" >&2; failures=$((failures + 1)); }

smoke_requested() { grep -q "\"path\": \"$1\"" "$work/requests.jsonl"; }

assert_smoke_run() {  # $1 label, $2 log, $3 status
  if [ "$3" -eq 0 ] && printf '%s' "$2" | grep -q "Staging smoke passed."; then
    pass "$1 smoke completed end to end"
    return
  fi
  fail "$1 smoke exited $3: $(printf '%s' "$2" | tail -n 3)"
}

echo "1) staging smoke, GitHub Actions shape (optional variables present but EMPTY)"
: > "$work/requests.jsonl"
: > "$work/gh_output.txt"   # the runner creates this file; the mint script appends to it
set +e
ci_log="$(NOSTOS_CLERK_API_BASE="$api_base" \
  NOSTOS_STAGING_BASE_URL="$api_base" \
  NOSTOS_STAGING_CLERK_SECRET_KEY="contract-test-placeholder-key" \
  NOSTOS_STAGING_CLERK_USER_ID="" \
  NOSTOS_STAGING_CLERK_JWT_TEMPLATE="" \
  NOSTOS_STAGING_BEARER_TOKEN="" \
  GITHUB_ACTIONS=true GITHUB_OUTPUT="$work/gh_output.txt" \
  GITHUB_RUN_ID=contract GITHUB_RUN_ATTEMPT=1 \
  bash "$smoke" 2>&1)"
ci_status=$?
set -e
assert_smoke_run "Actions-shape" "$ci_log" "$ci_status"

request_field_ok() {  # $1 path, $2 field ('auth' or a body field), $3 expected value
  python3 -c "
import json, sys
want_path, want_field, want_value = sys.argv[1], sys.argv[2], sys.argv[3]
for line in open('$work/requests.jsonl'):
    entry = json.loads(line)
    if entry['path'] != want_path:
        continue
    value = entry['auth'] if want_field == 'auth' else str((entry.get('body') or {}).get(want_field))
    if value == want_value:
        sys.exit(0)
sys.exit(1)
" "$1" "$2" "$3"
}

if request_field_ok "/v1/sessions" user_id "$staging_user"; then
  pass "empty NOSTOS_STAGING_CLERK_USER_ID fell back to $staging_user"
else
  fail "the empty user id variable did not fall back to the dedicated staging user"
fi
if smoke_requested "/v1/sessions/sess_test/tokens/nostos-api"; then
  pass "empty NOSTOS_STAGING_CLERK_JWT_TEMPLATE fell back to the nostos-api template"
else
  fail "the empty JWT template variable did not fall back to nostos-api"
fi
if smoke_requested "/v1/sessions/sess_test/revoke"; then
  pass "the ephemeral Clerk session was revoked"
else
  fail "the ephemeral session was not revoked"
fi
if request_field_ok "/api/auth/session" auth "Bearer $token"; then
  pass "the minted bearer reached the staging API as a single-line Authorization header"
else
  fail "no staging call carried a clean 'Bearer <jwt>' header"
fi
if smoke_requested "/api/cloud/provisioning/"; then
  pass "the authenticated provisioning check ran"
else
  fail "provisioning was never called with the minted bearer"
fi
if [ -s "$work/gh_output.txt" ]; then
  pass "the token was also published through GITHUB_OUTPUT"
else
  fail "GITHUB_OUTPUT did not receive bearer_token"
fi

echo "2) staging smoke, local operator shape (optional variables unset)"
: > "$work/requests.jsonl"
set +e
local_log="$(env -u GITHUB_ACTIONS -u GITHUB_OUTPUT -u GITHUB_RUN_ID -u GITHUB_RUN_ATTEMPT \
  NOSTOS_CLERK_API_BASE="$api_base" \
  NOSTOS_STAGING_BASE_URL="$api_base" \
  NOSTOS_STAGING_CLERK_SECRET_KEY="contract-test-placeholder-key" \
  bash "$smoke" 2>&1)"
local_status=$?
set -e
assert_smoke_run "local-shape" "$local_log" "$local_status"

echo "3) a rejected session request fails loudly with the non-secret Clerk reason"
: > "$work/requests.jsonl"
set +e
rejected="$(NOSTOS_CLERK_API_BASE="$api_base" \
  NOSTOS_STAGING_CLERK_SECRET_KEY="contract-test-placeholder-key" \
  NOSTOS_STAGING_CLERK_USER_ID="user_not_the_staging_one" \
  bash "$mint" 2>&1 >/dev/null)"
set -e
if printf '%s' "$rejected" | grep -q "HTTP 422" && printf '%s' "$rejected" | grep -q "form_param_missing"; then
  pass "the error text carries the Clerk status and error code"
else
  fail "the failure did not report the Clerk diagnostic: $(printf '%s' "$rejected" | tail -n 2)"
fi

if [ "$failures" -ne 0 ]; then
  echo "staging smoke contract test: $failures failure(s)" >&2
  exit 1
fi
echo "staging smoke contract test: all checks passed"
