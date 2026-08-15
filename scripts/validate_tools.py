#!/usr/bin/env python3
"""Validate (and optionally repair) the frontend tool registry."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


OBJECT_RE = re.compile(r"^  \{\n.*?^  \},\n", re.MULTILINE | re.DOTALL)
SLUG_RE = re.compile(r'^    slug: "([^"]+)",$', re.MULTILINE)
REQUIRED_RE = {
    key: re.compile(rf'^    {key}: "(?:[^"\\]|\\.)*",$', re.MULTILINE)
    for key in ("slug", "name", "description", "category", "icon", "added")
}
LOCAL_REF_RE = re.compile(
    r'<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)="(/[^"?#]+)', re.IGNORECASE
)
INLINE_SCRIPT_RE = re.compile(
    r"<script(?![^>]*\bsrc=)[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL
)


def parse_registry(path: Path) -> tuple[str, list[tuple[str | None, str]], str]:
    text = path.read_text(encoding="utf-8")
    matches = list(OBJECT_RE.finditer(text))
    if not matches:
        raise ValueError(f"{path}: no registry objects found")
    prefix = text[: matches[0].start()]
    suffix = text[matches[-1].end() :]
    objects = []
    for match in matches:
        block = match.group(0)
        slug_match = SLUG_RE.search(block)
        objects.append((slug_match.group(1) if slug_match else None, block))
    return prefix, objects, suffix


def problems(root: Path, objects: list[tuple[str | None, str]]) -> list[str]:
    issues: list[str] = []
    slugs = [slug for slug, _ in objects if slug]
    seen: set[str] = set()
    for slug in slugs:
        if slug in seen:
            issues.append(f"duplicate registry slug: {slug}")
        seen.add(slug)
    for slug, block in objects:
        if not slug:
            issues.append("registry object has no slug")
            continue
        for key, pattern in REQUIRED_RE.items():
            if not pattern.search(block):
                issues.append(f"{slug}: missing or malformed {key}")

    pages = {
        page.parent.name
        for page in (root / "tools").glob("*/index.html")
    }
    registered = set(slugs)
    for slug in sorted(registered - pages):
        issues.append(f"registered tool has no page: {slug}")
    policy_path = root.parent / "tool-curation.json"
    unlisted: set[str] = set()
    redirects: dict[str, str] = {}
    if policy_path.is_file():
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        keep = set(policy.get("keep", []))
        unlisted.update(policy.get("unlist", []))
        redirects = policy.get("redirects", {})
        generated_path = root.parent / "generated-conversion-tools.json"
        if generated_path.is_file():
            generated = json.loads(generated_path.read_text(encoding="utf-8"))
            redirects = {**redirects, **generated.get("legacy_redirects", {})}
        unlisted.update(redirects)
        for slug in pages:
            if any(slug.startswith(prefix) for prefix in policy.get("unlist_prefixes", [])) and slug not in keep:
                unlisted.add(slug)
        for slug in sorted(unlisted - pages):
            issues.append(f"curation policy references missing page: {slug}")
        for source, target in sorted(redirects.items()):
            if source == target:
                issues.append(f"redirect points to itself: {source}")
            if target not in registered:
                issues.append(f"redirect target is not registered: {source} -> {target}")
    for slug in sorted(pages - registered - unlisted):
        issues.append(f"tool page is not registered: {slug}")
    for slug in sorted(registered & unlisted):
        issues.append(f"unlisted tool is still registered: {slug}")
    for page in sorted(root.rglob("*.html")):
        text = page.read_text(encoding="utf-8")
        label = page.relative_to(root)
        if not re.search(r"<title>.+?</title>", text, re.IGNORECASE | re.DOTALL):
            issues.append(f"{label}: missing or empty title")
        if "</head>" not in text.lower() or "</body>" not in text.lower():
            issues.append(f"{label}: missing closing head or body tag")
        markup = INLINE_SCRIPT_RE.sub("", text)
        for ref in LOCAL_REF_RE.findall(markup):
            target = root / ref.lstrip("/")
            if not target.is_file():
                issues.append(f"{label}: missing local asset {ref}")
    return issues


def repair(root: Path, registry: Path) -> None:
    prefix, objects, suffix = parse_registry(registry)
    pages = {page.parent.name for page in (root / "tools").glob("*/index.html")}
    last = {slug: index for index, (slug, _) in enumerate(objects) if slug}
    kept = [
        block
        for index, (slug, block) in enumerate(objects)
        if slug in pages and last.get(slug) == index
    ]
    registry.write_text(prefix + "".join(kept) + suffix, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("frontend", type=Path)
    parser.add_argument("--fix", action="store_true")
    args = parser.parse_args()
    registry = args.frontend / "assets" / "tools.js"
    if args.fix:
        repair(args.frontend, registry)
    _, objects, _ = parse_registry(registry)
    issues = problems(args.frontend, objects)
    if issues:
        print("\n".join(issues))
        return 1
    print(f"Validated {len(objects)} registered tool pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
