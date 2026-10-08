#!/usr/bin/env python3
"""Maintain the deterministic one-agent-per-tool audit ledger."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = ROOT / "frontend" / "tools"
LEDGER = ROOT / "individual-tool-audit.json"
SECOND_WAVE_REPORT = ROOT / "SECOND_WAVE_INDIVIDUAL_AUDIT.md"
SECOND_WAVE_AGENT = "documented second-wave individual audit"
SECOND_WAVE_FINDING = (
    "Review and recheck evidence: SECOND_WAVE_INDIVIDUAL_AUDIT.md."
)
STATUSES = ("pending", "auditing", "clean", "findings", "fixed", "rechecked")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record")
    parser.add_argument("--status", choices=STATUSES)
    parser.add_argument("--agent")
    parser.add_argument("--finding", action="append", default=[])
    parser.add_argument(
        "--sync-second-wave",
        action="store_true",
        help=(
            "mark the 100 explicit tools in SECOND_WAVE_INDIVIDUAL_AUDIT.md "
            "as rechecked when their current status is pending"
        ),
    )
    args = parser.parse_args()
    if not args.record and (args.status or args.agent or args.finding):
        parser.error("--status, --agent, and --finding require --record")
    return args


def page_slugs() -> list[str]:
    return sorted(page.parent.name for page in TOOLS_ROOT.glob("*/index.html"))


def load_existing() -> dict[str, dict[str, object]]:
    if not LEDGER.is_file():
        return {}
    payload = json.loads(LEDGER.read_text(encoding="utf-8"))
    return {item["slug"]: item for item in payload["tools"]}


def second_wave_slugs(available: set[str]) -> list[str]:
    text = SECOND_WAVE_REPORT.read_text(encoding="utf-8")
    try:
        section = text.split("## Confirmed fixes", 1)[1].split(
            "## Completion ledger", 1
        )[0]
    except IndexError as exc:
        raise SystemExit(
            f"{SECOND_WAVE_REPORT.name}: expected Confirmed fixes and Completion ledger headings"
        ) from exc

    slugs = re.findall(r"^- `([a-z0-9-]+)`\s+—", section, flags=re.MULTILINE)
    if len(slugs) != 100 or len(set(slugs)) != 100:
        raise SystemExit(
            f"{SECOND_WAVE_REPORT.name}: expected 100 unique explicit tool entries; "
            f"found {len(slugs)} entries and {len(set(slugs))} unique slugs"
        )

    missing = sorted(set(slugs) - available)
    if missing:
        raise SystemExit(
            f"{SECOND_WAVE_REPORT.name}: referenced tool pages are missing: "
            + ", ".join(missing)
        )
    return slugs


def write_ledger(tools: list[dict[str, object]]) -> None:
    payload = json.dumps({"total": len(tools), "tools": tools}, indent=2) + "\n"
    temporary = LEDGER.with_suffix(".json.tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(LEDGER)


def main() -> int:
    args = parse_args()
    slugs = page_slugs()
    available = set(slugs)
    old = load_existing()
    tools = [
        old.get(
            slug,
            {"slug": slug, "status": "pending", "agent": None, "findings": []},
        )
        for slug in slugs
    ]
    by_slug = {item["slug"]: item for item in tools}

    synced = 0
    if args.sync_second_wave:
        for slug in second_wave_slugs(available):
            item = by_slug[slug]
            if item["status"] != "pending":
                continue
            item.update(
                status="rechecked",
                agent=SECOND_WAVE_AGENT,
                findings=[SECOND_WAVE_FINDING],
            )
            synced += 1

    if args.record:
        match = by_slug.get(args.record)
        if not match:
            raise SystemExit(f"unknown tool: {args.record}")
        if args.status:
            match["status"] = args.status
        if args.agent:
            match["agent"] = args.agent
        if args.finding:
            match["findings"] = args.finding

    write_ledger(tools)
    counts = Counter(item["status"] for item in tools)
    detail = ", ".join(f"{status}={counts[status]}" for status in STATUSES)
    if args.sync_second_wave:
        print(f"Second-wave sync: {synced} pending records promoted to rechecked")
    print(f"Audit ledger: {len(tools)} tools; {detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
