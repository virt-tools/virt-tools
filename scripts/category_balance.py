#!/usr/bin/env python3
"""Print catalog category counts for balancing new tools.

The maintenance cycle uses this to pick the next tool's category: prefer a
category below the mean, least populated first, then the one that has gone
longest without an addition. This is a soft target, not a quota.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "frontend" / "assets" / "tool-catalog.json"


def main() -> int:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    tools = data["tools"] if isinstance(data, dict) else data
    counts: Counter[str] = Counter()
    last_added: dict[str, str] = defaultdict(str)
    for tool in tools:
        category = (tool.get("category") or "(uncategorised)").strip() or "(uncategorised)"
        counts[category] += 1
        added = str(tool.get("added") or "")
        if added > last_added[category]:
            last_added[category] = added

    total = len(tools)
    mean = total / len(counts)
    print(f"{total} tools across {len(counts)} categories; mean {mean:.1f} per category")
    print()
    for category, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        print(f"{count:4d}  {category:40s} last added {last_added[category] or 'unknown'}")

    below = [category for category, count in counts.items() if count < mean]
    print()
    print("Below the mean, least populated first (ties: longest since an addition):")
    for category in sorted(below, key=lambda name: (counts[name], last_added[name] or "")):
        print(f"{counts[category]:4d}  {category}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
