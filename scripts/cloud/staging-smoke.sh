#!/usr/bin/env bash
set -euo pipefail

base_url="${NOSTOS_STAGING_BASE_URL:?NOSTOS_STAGING_BASE_URL is required}"
base_url="${base_url%/}"
bearer="${NOSTOS_STAGING_BEARER_TOKEN:-}"
run_ai="${NOSTOS_STAGING_MANAGED_AI_SMOKE:-false}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

curl_json() {
  curl --fail-with-body --silent --show-error     --connect-timeout 10     --max-time 90     -H "Accept: application/json"     "$@"
}

echo "Checking staging liveness/readiness..."
curl_json "$base_url/health/live" >/dev/null
curl_json "$base_url/health/ready" >/dev/null
curl --fail-with-body --silent --show-error --max-time 30 "$base_url/" >/dev/null

capabilities="$(curl_json "$base_url/api/runtime/capabilities")"
echo "$capabilities" | jq -e '.deploymentMode == "Cloud" and .requiresAuthentication == true and .usesCloudStorage == true' >/dev/null

anonymous_session="$(curl_json "$base_url/api/auth/session")"
echo "$anonymous_session" | jq -e '.authenticated == false' >/dev/null

if [ -z "$bearer" ]; then
  echo "::notice title=Authenticated staging smoke skipped::Set NOSTOS_STAGING_BEARER_TOKEN in the staging GitHub environment to exercise provisioning and Library read/write."
  exit 0
fi

auth=(-H "Authorization: Bearer $bearer")

session="$(curl_json "${auth[@]}" "$base_url/api/auth/session")"
echo "$session" | jq -e '.authenticated == true and (.account.id | type == "string")' >/dev/null

echo "Ensuring the dedicated staging account is provisioned..."
provisioning="$(curl_json "${auth[@]}" -X POST "$base_url/api/cloud/provisioning/")"
echo "$provisioning" | jq -e '.ready == true and .accountState == "Active"' >/dev/null

smoke_id="${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}-$$"
title="Nostos staging smoke $smoke_id"
create_payload="$(jq -nc --arg title "$title" '{type:"EBook", title:$title}')"

created="$(curl_json "${auth[@]}"   -H "Content-Type: application/json"   -X POST   --data "$create_payload"   "$base_url/api/books/")"

book_id="$(echo "$created" | jq -er '.id')"

delete_book() {
  curl --silent --show-error     -H "Authorization: Bearer $bearer"     -X DELETE     "$base_url/api/books/$book_id" >/dev/null 2>&1 || true
}
trap 'delete_book; cleanup' EXIT

fetched="$(curl_json "${auth[@]}" "$base_url/api/books/$book_id")"
echo "$fetched" | jq -e --arg title "$title" '.id == "'"$book_id"'" and .title == $title' >/dev/null

if [ "${run_ai,,}" = "true" ]; then
  echo "Running one bounded Ask Nostos release smoke..."
  turn_payload="$(jq -nc --arg key "staging-$smoke_id" '{
    clientId:"staging-release-smoke",
    idempotencyKey:$key,
    message:"Reply with exactly OK. Do not call tools.",
    context:{surface:"staging-smoke", route:"/staging-smoke"}
  }')"

  turn="$(curl_json "${auth[@]}"     -H "Content-Type: application/json"     -X POST     --data "$turn_payload"     "$base_url/api/assistant/turn")"
  echo "$turn" | jq -e '.reply | type == "string" and length > 0' >/dev/null
fi

curl_json "${auth[@]}" -X DELETE "$base_url/api/books/$book_id" >/dev/null
book_id=""

post_auth_session="$(curl_json "$base_url/api/auth/session")"
echo "$post_auth_session" | jq -e '.authenticated == false' >/dev/null

echo "Staging smoke passed."
