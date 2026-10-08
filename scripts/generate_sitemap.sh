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
policy_path = project_root / "tool-curation.json"
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
generated_path = project_root / "generated-conversion-tools.json"
if generated_path.is_file():
    generated = json.loads(generated_path.read_text(encoding="utf-8"))
    hidden.update(generated.get("legacy_redirects", {}))

tools = [
    tool for tool in catalog["tools"]
    if tool.get("listed", True) and tool["slug"] not in hidden
]
lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    f'  <url><loc>{escape(base)}/</loc></url>',
    f'  <url><loc>{escape(base)}/feedback/</loc></url>',
    f'  <url><loc>{escape(base)}/privacy/</loc></url>',
]
for tool in tools:
    lastmod = str(tool.get("reviewedAt") or tool.get("added") or "")[:10]
    lines.append(
        f'  <url><loc>{escape(base)}/tools/{escape(tool["slug"])}/</loc>'
        f'<lastmod>{escape(lastmod)}</lastmod></url>'
    )
lines.append("</urlset>")
out = root / "sitemap.xml"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Generated {out} ({len(tools) + 3} urls)")
PY
