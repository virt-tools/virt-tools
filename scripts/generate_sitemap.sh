#!/bin/sh
# Generate sitemap.xml from the canonical JSON catalog at build time.
# Usage: generate_sitemap.sh <web_root> <base_url>
set -eu

ROOT="$1"
BASE="${2%/}"

python3 - "$ROOT" "$BASE" <<'PY'
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

root = Path(sys.argv[1]).resolve()
base = sys.argv[2].rstrip("/")
project_root = root.parent
catalog = json.loads((root / "assets" / "tool-catalog.json").read_text(encoding="utf-8"))

hidden = set()
policy_path = project_root / "data" / "tool-curation.json"
if policy_path.is_file():
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    keep = set(policy.get("keep", []))
    hidden.update(policy.get("unlist", []))
    hidden.update(policy.get("redirects", {}))
    prefixes = tuple(policy.get("unlist_prefixes", []))
    if prefixes:
        hidden.update(
            page.parent.name
            for page in (root / "tools").glob("*/index.html")
            if page.parent.name.startswith(prefixes) and page.parent.name not in keep
        )
    hidden.difference_update(keep)
generated_path = project_root / "data" / "generated-conversion-tools.json"
if generated_path.is_file():
    generated = json.loads(generated_path.read_text(encoding="utf-8"))
    hidden.update(generated.get("legacy_redirects", {}))

# Locale pages written by generate_i18n.py; absent for an English-only build.
manifest = {}
manifest_path = root / "assets" / "i18n" / "manifest.json"
if manifest_path.is_file():
    candidate = json.loads(manifest_path.read_text(encoding="utf-8"))
    if isinstance(candidate, dict):
        manifest = candidate

tools = [
    tool for tool in catalog["tools"]
    if tool.get("listed", True) and tool["slug"] not in hidden
]
tool_slugs = {tool["slug"] for tool in tools}


def alternates(relative):
    """xhtml:link hreflang set for one page path, or an empty string."""
    pairs = [("x-default", f"{base}/{relative}"), ("en", f"{base}/{relative}")]
    for code, info in sorted(manifest.items()):
        if relative not in info.get("pages", {}):
            continue
        pairs.append((code, f"{base}/{info['path']}/{relative}"))
    if len({url for _, url in pairs}) < 2:
        return ""
    return "".join(
        f'<xhtml:link rel="alternate" hreflang="{escape(code)}" href="{escape(url)}"/>'
        for code, url in pairs
    )


lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
    ' xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    f'  <url><loc>{escape(base)}/</loc>{alternates("")}</url>',
    f'  <url><loc>{escape(base)}/feedback/</loc></url>',
    f'  <url><loc>{escape(base)}/privacy/</loc></url>',
]
for tool in tools:
    lastmod = str(tool.get("reviewedAt") or tool.get("added") or "")[:10]
    slug = tool["slug"]
    lines.append(
        f'  <url><loc>{escape(base)}/tools/{escape(slug)}/</loc>'
        f'<lastmod>{escape(lastmod)}</lastmod>{alternates("tools/" + slug + "/")}</url>'
    )

localized = 0
for code, info in sorted(manifest.items()):
    path = info.get("path", "")
    for relative in sorted(info.get("pages", {})):
        if relative.startswith("tools/"):
            slug = relative.strip("/").split("/")[-1]
            if slug not in tool_slugs:
                continue
        loc = f"{base}/{path}/{relative}"
        lines.append(f'  <url><loc>{escape(loc)}</loc>{alternates(relative)}</url>')
        localized += 1

lines.append("</urlset>")
out = root / "sitemap.xml"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Generated {out} ({len(tools) + 3 + localized} urls, {localized} localized)")
PY
