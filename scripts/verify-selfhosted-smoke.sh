#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
configuration="${1:-Release}"
host_dll="$repo_root/Nostos.Backend/bin/$configuration/net10.0/Nostos.Backend.dll"

if [[ ! -f "$host_dll" ]]; then
  echo "FAIL: $host_dll does not exist; build Nostos.sln first" >&2
  exit 1
fi

port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
origin="http://127.0.0.1:$port"
scratch="$(mktemp -d)"
host_pid=""

cleanup() {
  if [[ -n "$host_pid" ]]; then
    kill "$host_pid" >/dev/null 2>&1 || true
    wait "$host_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

# Do not inherit any private Cloud or GitHub credentials from the caller.
while IFS='=' read -r name _; do
  case "$name" in
    GH_TOKEN|NOSTOS_CLOUD_*) unset "$name" ;;
  esac
done < <(env)

env ASPNETCORE_ENVIRONMENT=Production \
  DOTNET_ENVIRONMENT=Production \
  Nostos__DeploymentMode=SelfHosted \
  dotnet "$host_dll" \
    --urls "$origin" \
    --contentRoot "$scratch" \
    >"$scratch/host.log" 2>&1 &
host_pid=$!

ready=false
for _ in $(seq 1 60); do
  if curl -fsS "$origin/health/ready" > "$scratch/readiness.json"; then
    ready=true
    break
  fi
  if ! kill -0 "$host_pid" >/dev/null 2>&1; then
    cat "$scratch/host.log" >&2
    exit 1
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  cat "$scratch/host.log" >&2
  echo "FAIL: SelfHosted readiness did not become healthy" >&2
  exit 1
fi

curl -fsS "$origin/api/runtime/capabilities" > "$scratch/capabilities.json"
python3 - "$scratch/capabilities.json" "$scratch/readiness.json" "$scratch/nostos.db" <<'PY'
import json
import sqlite3
import sys
from pathlib import Path

capabilities_path, readiness_path, database_path = sys.argv[1:4]
capabilities = json.loads(Path(capabilities_path).read_text(encoding="utf-8"))
readiness = json.loads(Path(readiness_path).read_text(encoding="utf-8"))

assert capabilities["deploymentMode"] == "SelfHosted", capabilities
assert capabilities["usesCloudStorage"] is False, capabilities
assert capabilities["canConfigureAiProvider"] is True, capabilities
assert readiness["status"] == "ok", readiness
assert Path(database_path).is_file() and Path(database_path).stat().st_size > 0

with sqlite3.connect(database_path) as db:
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "Books" in tables, sorted(tables)

print("OK: SelfHosted host started, SQLite bootstrapped, and deployment capabilities are local")
PY
