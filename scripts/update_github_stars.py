#!/usr/bin/env python3
"""Refresh the navbar star-count snapshot from the GitHub API.

The site makes no third-party browser requests, so the count is fetched here,
server-side, and committed as a small static asset. Re-run after a release or
from a maintenance job; the header reads frontend/assets/github-stars.json.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO = "virt-tools/virt-tools"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend" / "assets" / "github-stars.json"


def main() -> int:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "virt-tools-build",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.load(response)
    except OSError as exc:
        print(f"GitHub API request failed: {exc}", file=sys.stderr)
        return 1

    stars = payload.get("stargazers_count")
    url = payload.get("html_url") or f"https://github.com/{REPO}"
    if not isinstance(stars, int):
        print("GitHub API response has no stargazers_count", file=sys.stderr)
        return 1

    document = {
        "repo": url,
        "count": stars,
        "updated": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    }
    OUTPUT.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"{url}: {stars} stars -> {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
