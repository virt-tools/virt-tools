#!/usr/bin/env python3
"""Remove explicitly curated pages from a disposable deployment tree only."""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path


SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("Usage: prune_deploy_tree.py ROOT [--finalize-assets]", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve()
    frontend = root / "frontend"
    tools = (frontend / "tools").resolve()
    if not tools.is_dir():
        print(f"Deployment tool tree is missing: {tools}", file=sys.stderr)
        return 1

    if len(sys.argv) == 3:
        if sys.argv[2] != "--finalize-assets":
            print(f"Unknown option: {sys.argv[2]}", file=sys.stderr)
            return 2
        assets = frontend / "assets"
        registry = assets / "tools.js"
        metadata = assets / "tool-meta"
        if not registry.is_file() or not metadata.is_dir():
            print("Public registry or per-tool metadata is missing", file=sys.stderr)
            return 1
        source = registry.read_text(encoding="utf-8")
        marker = "window.VIRTUAL_TOOLS = "
        if source.count(marker) != 1 or not source.rstrip().endswith(";"):
            print("Public registry has an unexpected format", file=sys.stderr)
            return 1
        payload = source.split(marker, 1)[1].strip().removesuffix(";")
        public = json.loads(payload)
        public_slugs = {entry["slug"] for entry in public}
        metadata_slugs = {path.stem for path in metadata.glob("*.json")}
        if public_slugs != metadata_slugs:
            print(
                "Per-tool runtime metadata does not exactly match the public registry",
                file=sys.stderr,
            )
            return 1
        for name in ("tool-catalog.json", "tool-catalog.schema.json"):
            path = assets / name
            if not path.is_file():
                print(f"Canonical build artifact is missing: {path}", file=sys.stderr)
                return 1
            path.unlink()
        if any((assets / name).exists() for name in ("tool-catalog.json", "tool-catalog.schema.json")):
            print("Canonical catalog artifacts remain in deployment tree", file=sys.stderr)
            return 1
        print(
            f"Removed canonical catalog artifacts; retained {len(public_slugs)} public metadata files"
        )
        return 0

    policy = json.loads((root / "tool-curation.json").read_text(encoding="utf-8"))
    generated = json.loads(
        (root / "generated-conversion-tools.json").read_text(encoding="utf-8")
    )
    keep = set(policy.get("keep", []))
    explicit = set(policy.get("unlist", []))
    explicit.update(policy.get("redirects", {}))
    explicit.update(generated.get("legacy_redirects", {}))
    prefixes = tuple(policy.get("unlist_prefixes", []))
    pages = {page.parent.name for page in tools.glob("*/index.html")}
    explicit.update(
        slug for slug in pages if slug not in keep and slug.startswith(prefixes)
    )

    missing = sorted(explicit - pages)
    if missing:
        print("Curation references missing deploy pages: " + ", ".join(missing), file=sys.stderr)
        return 1

    for slug in sorted(explicit):
        if not SLUG.fullmatch(slug):
            print(f"Unsafe curated slug: {slug!r}", file=sys.stderr)
            return 1
        target = (tools / slug).resolve()
        if target.parent != tools or not target.is_dir():
            print(f"Refusing unsafe deployment prune target: {target}", file=sys.stderr)
            return 1
        shutil.rmtree(target)

    print(f"Pruned {len(explicit)} explicitly curated pages from deployment tree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
