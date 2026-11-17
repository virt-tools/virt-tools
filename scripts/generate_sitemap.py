#!/usr/bin/env python3
"""Generate the sitemap index and its per-locale child sitemaps.

Every page carries a build-time breadcrumb and related-tools block, but a
crawler still finds the whole catalog fastest through this file set, and it is
the only machine-readable index of what exists per locale. It is therefore
generated from the same sources the pages are:

  frontend/assets/tool-catalog.json   listed tools
  frontend/assets/i18n/manifest.json  pages that exist per locale
  data/tool-curation.json             unlisted, redirected and kept slugs
  data/generated-conversion-tools.json  legacy redirects

Layout: one sitemapindex plus a handful of children, split by content type and
locale rather than by tool category - categories are a UI filter with no URLs
of their own, while per-locale files give per-locale indexing reports.

  sitemap.xml
    sitemap-pages.xml        /, /feedback/, /privacy/, /de/, /es/
    sitemap-tools-en.xml     every listed tool, English
    sitemap-tools-de.xml     every translated tool, German
    sitemap-tools-es.xml     every translated tool, Spanish

Usage:
    generate_sitemap.py <web_root> <base_url>            # write the files
    generate_sitemap.py <web_root> <base_url> --check    # verify they are current
    generate_sitemap.py <web_root> <base_url> --dry-run  # validate only, write nothing
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

URLSET_OPEN = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
    ' xmlns:xhtml="http://www.w3.org/1999/xhtml">'
)
INDEX_OPEN = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'

STATIC_PATHS = ("", "feedback/", "privacy/")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class SitemapError(RuntimeError):
    """Raised when the generated file set would be inconsistent."""


def _load(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _hidden_slugs(root: Path, project_root: Path) -> set[str]:
    hidden: set[str] = set()
    policy = _load(project_root / "data" / "tool-curation.json", {})
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
    generated = _load(project_root / "data" / "generated-conversion-tools.json", {})
    hidden.update(generated.get("legacy_redirects", {}))
    return hidden


def _lastmod(tool: dict, today: str) -> str:
    """Catalog date, clamped to today so no entry claims a future change."""
    raw = str(tool.get("reviewedAt") or tool.get("added") or "")[:10]
    if not DATE_RE.match(raw):
        return ""
    return min(raw, today)


def _alternates(base: str, relative: str, manifest: dict) -> str:
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


def build(root: Path, base: str) -> dict[str, str]:
    """Return {filename: xml text} for the index and every child sitemap."""
    project_root = root.parent
    base = base.rstrip("/")
    today = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")

    catalog = _load(root / "assets" / "tool-catalog.json", None)
    if catalog is None:
        raise SitemapError(f"no tool catalog under {root}")
    manifest = _load(root / "assets" / "i18n" / "manifest.json", {})
    if not isinstance(manifest, dict):
        manifest = {}

    hidden = _hidden_slugs(root, project_root)
    tools = [
        tool
        for tool in catalog["tools"]
        if tool.get("listed", True) and tool["slug"] not in hidden
    ]
    tools.sort(key=lambda tool: tool["slug"])
    slugs = {tool["slug"] for tool in tools}

    # --- pages: the three homes plus the two English-only documents ---------
    page_urls: list[str] = []
    for path in STATIC_PATHS:
        page_urls.append(
            f'  <url><loc>{escape(base)}/{escape(path)}</loc>{_alternates(base, path, manifest)}</url>'
        )
    for code, info in sorted(manifest.items()):
        path = info.get("path", code)
        page_urls.append(
            f'  <url><loc>{escape(base)}/{escape(path)}/</loc>{_alternates(base, "", manifest)}</url>'
        )

    # --- tools per locale, each with lastmod and the full alternate set -----
    def tool_url(locale_path: str, tool: dict) -> str:
        slug = tool["slug"]
        relative = f"tools/{slug}/"
        lastmod = _lastmod(tool, today)
        stamp = f"<lastmod>{escape(lastmod)}</lastmod>" if lastmod else ""
        prefix = f"{locale_path}/" if locale_path else ""
        return (
            f'  <url><loc>{escape(base)}/{escape(prefix + relative)}</loc>{stamp}'
            f"{_alternates(base, relative, manifest)}</url>"
        )

    children: dict[str, str] = {}
    children["sitemap-pages.xml"] = URLSET_OPEN + "\n" + "\n".join(page_urls) + "\n</urlset>"
    children["sitemap-tools-en.xml"] = (
        URLSET_OPEN + "\n" + "\n".join(tool_url("", tool) for tool in tools) + "\n</urlset>"
    )
    for code, info in sorted(manifest.items()):
        path = info.get("path", code)
        translated = [
            tool
            for tool in tools
            if f"tools/{tool['slug']}/" in info.get("pages", {})
        ]
        if not translated:
            continue
        children[f"sitemap-tools-{code}.xml"] = (
            URLSET_OPEN + "\n" + "\n".join(tool_url(path, tool) for tool in translated) + "\n</urlset>"
        )

    _verify(children, tools, slugs, manifest, today)

    index_lines = [INDEX_OPEN]
    for name in children:
        lastmod = max(
            re.findall(r"<lastmod>(\d{4}-\d{2}-\d{2})</lastmod>", children[name]),
            default="",
        )
        stamp = f"<lastmod>{lastmod}</lastmod>" if lastmod else ""
        index_lines.append(f"  <sitemap><loc>{escape(base)}/{name}</loc>{stamp}</sitemap>")
    index_lines.append("</sitemapindex>")

    out = {"sitemap.xml": "\n".join(index_lines)}
    out.update(children)
    return out


def _verify(children: dict[str, str], tools: list[dict], slugs: set[str],
            manifest: dict, today: str) -> None:
    """Fail loudly rather than publish a file set that loses or duplicates URLs."""
    seen: dict[str, str] = {}
    alternate_sets: dict[str, set[str]] = {}
    for name, xml in children.items():
        locs = re.findall(r"<loc>([^<]+)</loc>", xml)
        if not locs:
            raise SitemapError(f"{name} has no URLs")
        for url in locs:
            if url in seen:
                raise SitemapError(f"{url} is listed in both {seen[url]} and {name}")
            seen[url] = name
        for stamp in re.findall(r"<lastmod>([^<]+)</lastmod>", xml):
            if not DATE_RE.match(stamp):
                raise SitemapError(f"{name}: malformed lastmod {stamp!r}")
            if stamp > today:
                raise SitemapError(f"{name}: lastmod {stamp} is in the future")
        # every tool URL must carry the same alternate set in every locale file
        for block in re.findall(r"<url>.*?</url>", xml, re.S):
            alt = tuple(sorted(re.findall(r'hreflang="([^"]+)"', block)))
            if not alt:
                continue
            loc = re.search(r"<loc>([^<]+)</loc>", block)
            if loc is None or "/tools/" not in loc.group(1):
                continue  # home pages carry alternates but are not tool URLs
            found = re.search(r"/tools/([^/<]+)/", block)
            if found is None:
                raise SitemapError(f"{name}: tool URL without a slug: {block[:60]}")
            relative = found.group(1)
            previous = alternate_sets.setdefault(relative, set(alt))
            if previous != set(alt):
                raise SitemapError(
                    f"{relative}: hreflang sets differ between locales "
                    f"({sorted(previous)} vs {sorted(alt)})"
                )

    # every listed tool must appear exactly once per locale it is translated into
    en_urls = re.findall(r"<loc>([^<]+)</loc>", children["sitemap-tools-en.xml"])
    if len(en_urls) != len(tools):
        raise SitemapError(f"sitemap-tools-en.xml lists {len(en_urls)} URLs for {len(tools)} tools")
    for code, info in sorted(manifest.items()):
        name = f"sitemap-tools-{code}.xml"
        if name not in children:
            continue
        localized = [t for t in tools if f"tools/{t['slug']}/" in info.get("pages", {})]
        listed = len(re.findall(r"<loc>", children[name]))
        if listed != len(localized):
            raise SitemapError(f"{name} lists {listed} URLs for {len(localized)} translated tools")
    if not slugs:
        raise SitemapError("the catalog has no listed tools")


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        usage = (__doc__ or "").strip().splitlines()
        print(usage[-1].strip() if usage else "usage: generate_sitemap.py <web_root> <base_url>",
              file=sys.stderr)
        return 2
    root = Path(argv[1]).resolve()
    base = argv[2]
    check = "--check" in argv[3:]
    dry_run = "--dry-run" in argv[3:]

    try:
        files = build(root, base)
    except SitemapError as error:
        print(f"generate_sitemap: {error}", file=sys.stderr)
        return 1

    total = sum(len(re.findall(r"<loc>", xml)) for xml in files.values())
    detail = ", ".join(
        f"{name.removeprefix('sitemap-').removesuffix('.xml')}={len(re.findall(r'<loc>', xml))}"
        for name, xml in files.items()
        if name != "sitemap.xml"
    )

    if dry_run:
        print(f"Sitemap set is consistent ({total} urls: {detail})")
        return 0

    if check:
        stale = [
            name
            for name, xml in files.items()
            if not (root / name).is_file()
            or (root / name).read_text(encoding="utf-8") != xml + "\n"
        ]
        leftovers = sorted(
            path.name
            for path in root.glob("sitemap*.xml")
            if path.name not in files
        )
        if stale or leftovers:
            print(
                "generate_sitemap: stale or missing sitemap file(s): "
                + ", ".join(stale + leftovers),
                file=sys.stderr,
            )
            return 1
        print(f"Sitemaps current: {len(files) - 1} child files, {total} urls")
        return 0

    # Remove children from an earlier layout so nothing stale stays advertised.
    for path in root.glob("sitemap*.xml"):
        if path.name not in files:
            path.unlink()
    for name, xml in files.items():
        (root / name).write_text(xml + "\n", encoding="utf-8")
    print(f"Generated sitemap index in {root} ({total} urls: {detail})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
