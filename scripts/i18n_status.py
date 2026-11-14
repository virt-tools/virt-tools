#!/usr/bin/env python3
"""Report the state of every translation memory, for the maintenance cycle.

A translation memory is keyed by the exact English strings on a page. Editing a
page therefore invalidates its translations, and the site would silently fall
back to English — losing work without any signal. This script is the signal:

  ok          the memory matches the page it was written for
  stale       the page changed under the translation (missing/stale keys)
  untranslated  the page has no memory for that locale (English fallback)

`--check` exits non-zero when any memory is stale, so a cycle that edits a
translated page has to update the translations in the same commit.
`--write-pending FILE` records the work queue for the next run.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate_i18n
import i18n_lib


def collect(root: Path, data_dir: Path, registry: dict) -> dict:
    pages = {}
    for page in sorted((root / "tools").glob("*/index.html")):
        pages[page.parent.name] = i18n_lib.extract_units(i18n_lib.parse(page.read_text(encoding="utf-8"))[0])

    report = generate_i18n.Report()
    result: dict = {"locales": {}, "pages": len(pages)}
    for entry in registry["locales"]:
        code = entry["code"]
        if code == registry["default"]:
            continue
        ok, stale, untranslated = [], [], []
        directory = data_dir / "i18n" / "tools" / code
        for slug, document in pages.items():
            path = directory / f"{slug}.json"
            if not path.is_file():
                untranslated.append(slug)
                continue
            try:
                tm = i18n_lib.load_json(path)
            except json.JSONDecodeError as exc:
                report.error(f"{code}/{slug}: invalid JSON ({exc})")
                stale.append(slug)
                continue
            problems = generate_i18n.verify_tm(tm, slug, code, document)
            if problems:
                stale.append(slug)
                report.warn(f"{code}/{slug}: {problems[0]}")
            else:
                ok.append(slug)
        result["locales"][code] = {
            "ok": ok,
            "stale": stale,
            "untranslated": untranslated,
        }
    result["errors"] = report.errors
    result["notes"] = report.warnings
    return result


def main(argv: list[str]) -> int:
    check = "--check" in argv
    as_json = "--json" in argv
    pending_path = None
    if "--write-pending" in argv:
        pending_path = Path(argv[argv.index("--write-pending") + 1])

    root = Path("frontend").resolve()
    data_dir = generate_i18n.project_root(root) / "data"
    registry = i18n_lib.load_registry(data_dir)
    state = collect(root, data_dir, registry)

    if as_json:
        print(json.dumps(state, indent=2, ensure_ascii=False))
    else:
        print(f"i18n status — {state['pages']} source pages, {len(state['locales'])} translated locales")
        for code, bucket in state["locales"].items():
            print(
                f"  {code}: {len(bucket['ok'])} current, {len(bucket['stale'])} stale, "
                f"{len(bucket['untranslated'])} untranslated"
            )
            for slug in bucket["stale"][:10]:
                print(f"    stale: {slug}")
        for note in state["notes"][:10]:
            print("  note: " + note)
        if state["locales"]:
            print()
            print("New tools stay English until a memory is added: "
                  "python3 scripts/i18n_lib.py extract frontend/tools/<slug>/index.html")

    if pending_path is not None:
        pending = {
            code: {"stale": bucket["stale"], "untranslated": bucket["untranslated"]}
            for code, bucket in state["locales"].items()
        }
        pending_path.parent.mkdir(parents=True, exist_ok=True)
        pending_path.write_text(json.dumps(pending, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {pending_path}")

    if state["errors"]:
        for line in state["errors"]:
            print("error: " + line, file=sys.stderr)
        return 1
    if check and any(bucket["stale"] for bucket in state["locales"].values()):
        print(
            "error: a translated page changed without its translation memory being updated "
            "(update data/i18n/tools/<locale>/<slug>.json, or delete the memory to fall back to English)",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
