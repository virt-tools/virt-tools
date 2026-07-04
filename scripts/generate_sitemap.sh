#!/bin/sh
# Generate sitemap.xml from the tool registry (assets/tools.js) at build time.
#
# Usage: generate_sitemap.sh <web_root> <base_url>
#   <web_root>  path to the nginx document root (e.g. /usr/share/nginx/html)
#   <base_url>  absolute site URL without trailing slash (e.g. https://virt.tools)
#
# Each registry entry's `slug` becomes /tools/<slug>/ and its `added` ISO
# timestamp becomes <lastmod> (date portion only). The homepage and feedback
# page are added as static entries. Runs under busybox sh + awk (nginx:alpine).
set -eu

ROOT="$1"
BASE="${2%/}"
TOOLS="$ROOT/assets/tools.js"
OUT="$ROOT/sitemap.xml"

{
  printf '<?xml version="1.0" encoding="UTF-8"?>\n'
  printf '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  printf '  <url><loc>%s/</loc></url>\n' "$BASE"
  printf '  <url><loc>%s/feedback/</loc></url>\n' "$BASE"
  awk -v base="$BASE" '
    /slug:[[:space:]]*"/ {
      sub(/.*slug:[[:space:]]*"/, ""); sub(/".*/, ""); slug = $0; next
    }
    /added:[[:space:]]*"/ {
      sub(/.*added:[[:space:]]*"/, ""); sub(/".*/, ""); added = substr($0, 1, 10)
      if (slug != "") {
        printf "  <url><loc>%s/tools/%s/</loc><lastmod>%s</lastmod></url>\n", base, slug, added
        slug = ""
      }
    }
  ' "$TOOLS"
  printf '</urlset>\n'
} > "$OUT"

echo "Generated $OUT ($(grep -c '<url>' "$OUT") urls)"