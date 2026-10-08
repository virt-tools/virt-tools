#!/usr/bin/env python3
"""Validate conservative catalog quarantine and audit-ledger coverage."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from generate_tool_catalog import curated_slugs, load_catalog, public_tools

ALLOWED_RISKS = {"high", "critical"}


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    frontend = root / "frontend"
    policy = json.loads((root / "tool-risk-policy.json").read_text(encoding="utf-8"))
    curation = json.loads((root / "tool-curation.json").read_text(encoding="utf-8"))
    _, catalog = load_catalog(frontend / "assets" / "tool-catalog.json")
    registry = {
        tool["slug"]
        for tool in public_tools(catalog, curated_slugs(root, frontend))
    }
    pages = {page.parent.name for page in (frontend / "tools").glob("*/index.html")}
    unlisted = set(curation.get("unlist", []))
    issues: list[str] = []
    quarantined: dict[str, tuple[str, str]] = {}

    if policy.get("version") != 1:
        issues.append("tool-risk-policy.json: unsupported or missing version")
    if not str(policy.get("releaseRule", "")).strip():
        issues.append("tool-risk-policy.json: releaseRule is required")

    for group in policy.get("groups", []):
        group_id = group.get("id")
        risk = group.get("risk")
        if not isinstance(group_id, str) or not group_id.strip():
            issues.append("risk group has no id")
            continue
        if risk not in ALLOWED_RISKS:
            issues.append(f"{group_id}: risk must be high or critical")
        if not str(group.get("reason", "")).strip():
            issues.append(f"{group_id}: reason is required")
        slugs = group.get("slugs")
        if not isinstance(slugs, list) or not slugs:
            issues.append(f"{group_id}: non-empty slugs list is required")
            continue
        for slug in slugs:
            if not isinstance(slug, str) or not slug:
                issues.append(f"{group_id}: invalid slug")
                continue
            if slug in quarantined:
                issues.append(f"{slug}: duplicated in {quarantined[slug][0]} and {group_id}")
            quarantined[slug] = (group_id, risk)

    catalog_by_slug = {tool["slug"]: tool for tool in catalog}
    for slug, (group_id, expected_risk) in sorted(quarantined.items()):
        if slug not in pages:
            issues.append(f"{slug}: quarantine page is missing ({group_id})")
        if slug not in unlisted:
            issues.append(f"{slug}: quarantine is absent from tool-curation.json")
        if slug in registry:
            issues.append(f"{slug}: quarantined tool remains in the public registry")
        record = catalog_by_slug.get(slug)
        if record is not None:
            if record.get("risk") != expected_risk:
                issues.append(
                    f"{slug}: canonical risk is {record.get('risk')!r}, expected {expected_risk!r}"
                )
            if record.get("listed", True):
                issues.append(f"{slug}: canonical record is not explicitly unlisted")

    ledger_path = root / "individual-tool-audit.json"
    if ledger_path.is_file():
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        records = ledger.get("tools", [])
        ledger_slugs = [record.get("slug") for record in records if isinstance(record, dict)]
        if ledger.get("total") != len(records):
            issues.append("individual-tool-audit.json: total does not match record count")
        if len(ledger_slugs) != len(set(ledger_slugs)):
            issues.append("individual-tool-audit.json: duplicate tool records")
        missing = sorted(pages - set(ledger_slugs))
        stale = sorted(set(ledger_slugs) - pages)
        if missing:
            issues.append(f"individual-tool-audit.json: {len(missing)} pages missing from ledger")
        if stale:
            issues.append(f"individual-tool-audit.json: {len(stale)} stale records")

    if issues:
        print("\n".join(issues))
        return 1
    print(
        f"Validated {len(quarantined)} quarantined tools and "
        f"{len(pages)} audit-ledger page records"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
