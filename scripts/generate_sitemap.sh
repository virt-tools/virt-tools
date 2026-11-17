#!/bin/sh
# Generate the sitemap index and its per-locale child sitemaps at build time.
# Usage: generate_sitemap.sh <web_root> <base_url> [--check]
# Kept as a thin wrapper so every existing build script keeps working; the
# generator itself lives in generate_sitemap.py.
set -eu
exec python3 "$(dirname "$0")/generate_sitemap.py" "$@"
