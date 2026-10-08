#!/usr/bin/env python3
"""Fast, dependency-free checks for deployment security invariants."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(path: str, needles: tuple[str, ...]) -> list[str]:
    text = (ROOT / path).read_text(encoding="utf-8")
    return [f"{path}: missing {needle!r}" for needle in needles if needle not in text]


def main() -> int:
    issues: list[str] = []
    dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")
    first_rule = next(
        (
            line.strip()
            for line in dockerignore.splitlines()
            if line.strip() and not line.startswith("#")
        ),
        "",
    )
    if first_rule != "**":
        issues.append(".dockerignore: build context must begin denied and use an allowlist")

    issues.extend(
        require(
            "api/Dockerfile",
            ("USER 10001:10001", "gunicorn", "HEALTHCHECK", "feedback_backup.py"),
        )
    )
    issues.extend(
        require(
            "nginx/Dockerfile",
            (
                "USER 101:101",
                "ASSET_VERSION",
                "validate_formula_workbenches",
                "formula-workbenches.json",
                "/build/frontend/service-worker.js",
                "validate_risk_policy.py",
                "prune_deploy_tree.py",
            ),
        )
    )
    issues.extend(
        require(
            "frontend/service-worker.js",
            ("/assets/tool-meta/", "__VT_ASSET_VERSION__", "event.waitUntil(update"),
        )
    )
    issues.extend(
        require(
            "nginx/nginx.conf",
            (
                "client_max_body_size 16k",
                "access_log off",
                "gzip on",
                "$asset_cache_control",
            ),
        )
    )
    issues.extend(
        require(
            "nginx/security-headers.conf",
            (
                "Content-Security-Policy",
                "Permissions-Policy",
                "clipboard-read=(self)",
                "X-Content-Type-Options",
            ),
        )
    )
    issues.extend(
        require(
            "docker-compose.yml",
            (
                "condition: service_healthy",
                "read_only: true",
                "cap_drop: [ALL]",
                "pids_limit",
                "VT_FEEDBACK_RETENTION_DAYS",
                "host.docker.internal:host-gateway",
            ),
        )
    )
    issues.extend(
        require(
            "api/db.py",
            ("get_or_create_rate_limit_secret", "cleanup_expired_feedback", "batch_size: int = 500"),
        )
    )
    issues.extend(
        require(
            "scripts/feedback_backup.py",
            ("ARCHIVE_HEADER", "hmac.compare_digest", "MAC_DOMAIN", "pre-restore"),
        )
    )
    issues.extend(
        require(
            "scripts/backup_feedback.sh",
            ('runtime/edge/active-slot', 'virt-tools-$active_slot'),
        )
    )
    issues.extend(
        require(
            "scripts/restore_feedback.sh",
            (
                'runtime/edge/active-slot',
                "slot_compose_command blue stop api",
                "slot_compose_command green stop api",
                'deploy.lock',
            ),
        )
    )
    issues.extend(
        require(
            "scripts/test_zero_downtime_deploy.sh",
            ("/api/ready", "failures=$((failures + 1))", '"$deploy" deploy'),
        )
    )

    requirements = (ROOT / "api/requirements.txt").read_text(encoding="utf-8").splitlines()
    for requirement in requirements:
        if requirement.strip() and not re.fullmatch(
            r"[A-Za-z0-9_.-]+==[^\s]+", requirement
        ):
            issues.append(
                f"api/requirements.txt: dependency is not exactly pinned: {requirement}"
            )

    nginx_dockerfile = (ROOT / "nginx/Dockerfile").read_text(encoding="utf-8")
    if "date +%s" in nginx_dockerfile:
        issues.append("nginx/Dockerfile: timestamp-based cache versions are nondeterministic")
    for shell_path in (
        "/build/frontend/index.html",
        "/build/frontend/privacy/index.html",
        "/build/frontend/manifest.webmanifest",
        "/build/frontend/favicon.svg",
    ):
        if shell_path not in nginx_dockerfile:
            issues.append(f"nginx/Dockerfile: service-worker version omits {shell_path}")

    if issues:
        print("\n".join(issues))
        return 1
    print("Validated operational hardening invariants")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
