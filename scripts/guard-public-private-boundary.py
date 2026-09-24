#!/usr/bin/env python3
"""Keep the public build independent of private hosted implementation code."""

from __future__ import annotations

import subprocess
import sys
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def tracked_paths() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [path.decode("utf-8") for path in result.stdout.split(b"\0") if path]


paths = tracked_paths()
errors: list[str] = []

forbidden_roots = (
    "Nostos.Backend/Cloud/",
    "Nostos.Backend/Configuration/Cloud",
    "Nostos.Backend/Endpoints/Cloud",
    "Nostos.Backend/Security/Cloud",
    "Nostos.Backend/Services/Ai/Cloud",
    "Nostos.Backend/Services/Ai/ManagedAi",
    "Nostos.Backend/Integrations/Assistant/AssistantPricing.cs",
    "Nostos.Backend/Services/Ai/GroqManagedSttProvider.cs",
    "Nostos.Backend/Services/Ai/VercelAiGatewayManagedLlmProvider.cs",
    "Nostos.Backend/Health/NostosCloudHealthChecks.cs",
    "Nostos.Backend.Tests/Cloud/",
    "Nostos.Backend.Tests/Security/Cloud",
    "Nostos.Backend.Tests/Services/Ai/ManagedCloudAiProviderTests.cs",
    ".github/workflows/cloud-release.yml",
    "scripts/cloud/",
)

for path in paths:
    candidate = ROOT / path
    if not candidate.is_file():
        continue

    if path.startswith(forbidden_roots):
        errors.append(f"hosted-only public path is still tracked: {path}")

    if path == ".gitmodules":
        content = candidate.read_text(encoding="utf-8")
        if "Nostos-Cloud" in content or "Nostos.Cloud" in content:
            errors.append(".gitmodules must not point at the private Nostos-Cloud repository")
        continue

    suffix = candidate.suffix.lower()
    if suffix in {".cs", ".csproj", ".sln", ".props", ".targets", ".yml", ".yaml"}:
        content = candidate.read_text(encoding="utf-8", errors="replace")
        if suffix == ".cs":
            for marker in (
                r"^\s*using\s+Nostos\.Cloud\.Hosting(?:\.|\s*;)",
                r"^\s*using\s+Nostos\.Cloud\.Host(?:\.|\s*;)",
                r"^\s*using\s+Nostos\.Backend\.Cloud(?:\.|\s*;)",
                r"^\s*namespace\s+Nostos\.Cloud\.Hosting(?:\.|\s*;)",
                r"^\s*namespace\s+Nostos\.Cloud\.Host(?:\.|\s*;)",
                r"^\s*namespace\s+Nostos\.Backend\.Cloud(?:\.|\s*;)",
            ):
                if re.search(marker, content, flags=re.MULTILINE):
                    errors.append(f"{path} contains hosted implementation declaration {marker!r}")

            if path.startswith(("Nostos.Backend/", "Nostos.Product/")):
                for marker in (
                    "CloudAuthOptions",
                    "CloudBillingRegistration",
                    "PaddleBilling",
                    "S3BookAssetStorage",
                    "CloudManagedAi",
                    "GroqManagedSttProvider",
                    "VercelAiGatewayManagedLlmProvider",
                    "CloudRecoveryService",
                    "CloudWorkerLease",
                    "CloudTenantDbContext",
                    "NpgsqlConnection",
                ):
                    if marker in content:
                        errors.append(f"{path} contains hosted implementation marker {marker!r}")
        else:
            for marker in (
                "Christian-Gennari/Nostos-Cloud",
                "Nostos.Cloud.Hosting",
                "Nostos.Cloud.Host",
                "Nostos.Backend.Cloud",
            ):
                if marker in content:
                    errors.append(f"{path} references private hosted implementation marker {marker!r}")

    if suffix == ".csproj":
        content = candidate.read_text(encoding="utf-8", errors="replace")
        for package in (
            "AWSSDK.S3",
            "Microsoft.AspNetCore.Authentication.JwtBearer",
            "Microsoft.AspNetCore.Authentication.OpenIdConnect",
        ):
            if package in content:
                errors.append(f"{path} retains hosted-only package {package!r}")

    if path.startswith("Nostos.Backend/") and candidate.name.startswith("appsettings"):
        content = candidate.read_text(encoding="utf-8", errors="replace")
        for section in (
            '"CloudAuth"',
            '"CloudBilling"',
            '"CloudControlPlane"',
            '"CloudDataProtection"',
            '"CloudManagedAi"',
            '"CloudManagedAiUsage"',
            '"CloudObjectStorage"',
        ):
            if section in content:
                errors.append(f"{path} contains hosted-only settings section {section}")

if errors:
    print("FAIL: public/private boundary violations found", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    sys.exit(1)

print("OK: public source, projects and workflows have no private-host dependency")
