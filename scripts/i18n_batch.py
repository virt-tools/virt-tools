#!/usr/bin/env python3
"""Batch export/import for the per-tool translation memories.

The translation memory for one tool is all-or-nothing: every unit on the page
must have a string, or the page is not published in that locale. At ~2,000 pages
that is a job for batches, so this script splits the queue into payloads a
translator (human or model) can fill in one pass, then validates the result
mechanically before anything is written under data/i18n/tools/.

  i18n_batch.py export --locale de --count 12 --out batch.json
  i18n_batch.py import --locale de --in batch.json [--write]
  i18n_batch.py status

`import` never trusts the payload: it re-extracts the page's units, requires an
exact match, checks that markup, placeholders, numbers and entities survived,
and refuses prose that is byte-identical to the English. `--write` commits the
memories; without it the run is a dry run.
"""

from __future__ import annotations

import argparse
import html as html_module
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import i18n_lib  # noqa: E402

DATA = ROOT / "data"
CATALOG = ROOT / "frontend" / "assets" / "tool-catalog.json"
PAGES = ROOT / "frontend" / "tools"
TM_DIR = DATA / "i18n" / "tools"

# Established vocabulary. The shell catalog is the authority (it is what the
# navbar, chips and buttons already say), and the two translated locales inherit
# it so a tool page never disagrees with the frame around it.
GLOSSARY = {
    "de": {
        "tool": "Tool (n., plural: Tools)",
        "browser": "Browser",
        "Reset": "Zurücksetzen",
        "Calculate": "Berechnen",
        "Clear": "Leeren",
        "Copy": "Kopieren",
        "Download": "Herunterladen",
        "Example": "Beispiel",
        "Result": "Ergebnis",
        "Results": "Ergebnisse",
        "Input": "Eingabe",
        "Output": "Ausgabe",
        "Settings": "Einstellungen",
        "locally": "lokal (not \"vor Ort\")",
        "in your browser": "in deinem Browser (informal \"du\", never \"Sie\")",
        "estimate": "schätzen / Schätzung",
        "Note": "Hinweis",
        "rounded": "gerundet",
        "unit": "Einheit",
        "value": "Wert",
        "default": "Standard",
        "step": "Schritt",
        "chart": "Diagramm",
        "table": "Tabelle",
        "total": "Gesamt",
        "average": "Durchschnitt",
        "range": "Bereich",
        "percent": "Prozent",
        "per": "pro",
        "Source": "Quelle",
        "does not": "does not — render negations as a sentence, not a literal calque",
    },
    "es": {
        "tool": "herramienta",
        "browser": "navegador",
        "Reset": "Restablecer",
        "Calculate": "Calcular",
        "Clear": "Borrar",
        "Copy": "Copiar",
        "Download": "Descargar",
        "Example": "Ejemplo",
        "Result": "Resultado",
        "Results": "Resultados",
        "Input": "Entrada",
        "Output": "Salida",
        "Settings": "Ajustes",
        "locally": "localmente",
        "in your browser": "en tu navegador (informal \"tú\", never \"usted\")",
        "estimate": "estimar / estimación",
        "Note": "Nota",
        "rounded": "redondeado",
        "unit": "unidad",
        "value": "valor",
        "default": "predeterminado",
        "step": "paso",
        "chart": "gráfico",
        "table": "tabla",
        "total": "total",
        "average": "promedio",
        "range": "intervalo",
        "percent": "por ciento",
        "per": "por",
        "Source": "Fuente",
    },
}

TAG_RE = re.compile(r"</?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>")
NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")
PLACEHOLDER_RE = re.compile(r"\{[a-z][a-zA-Z0-9_]*\}")
# Strings a translator may legitimately leave untouched: symbols, units, proper
# nouns. Anything longer that is byte-identical is treated as untranslated.
KEEP_WORDS = {
    "JSON", "XML", "CSV", "TSV", "HTML", "CSS", "HTTP", "HTTPS", "URL", "URI", "API",
    "SQL", "REST", "TCP", "UDP", "IP", "IPV4", "IPV6", "DNS", "SSH", "TLS", "SSL",
    "AES", "SHA", "MD5", "UUID", "UTF-8", "ASCII", "RGB", "CMYK", "HSL", "HEX",
    "PNG", "JPEG", "SVG", "PDF", "GIF", "WEBP", "MP3", "MP4", "WAV", "FLAC",
    "BPM", "RPM", "DPI", "PPI", "FPS", "HZ", "KHZ", "MHZ", "GHZ", "DB", "DBM",
    "KW", "KWH", "MAH", "MM", "CM", "KM", "KG", "ML", "OZ", "LB", "FT", "PSI",
    "BAR", "KPA", "MPA", "CELSIUS", "FAHRENHEIT", "KEVIN", "BTC", "ETH", "USD",
    "EUR", "GBP", "YAML", "TOML", "GIT", "DOCKER", "KUBERNETES", "LINUX", "MACOS",
    "WINDOWS", "SSD", "HDD", "GPU", "CPU", "RAM", "NAT", "VPN", "LAN", "WAN",
}


def load_common(locale: str) -> dict[str, str]:
    """Canonical translations for copy that repeats across many pages."""
    path = DATA / "i18n" / "common" / f"{locale}.json"
    if not path.is_file():
        return {}
    table = json.loads(path.read_text(encoding="utf-8"))
    return {key: value for key, value in table.items() if not key.startswith("$")}


def load_catalog() -> dict[str, dict]:
    tools = json.loads(CATALOG.read_text(encoding="utf-8"))["tools"]
    return {tool["slug"]: tool for tool in tools}


def page_units(slug: str) -> tuple[dict, str]:
    root_node, _ = i18n_lib.parse((PAGES / slug / "index.html").read_text(encoding="utf-8"))
    document = i18n_lib.extract_units(root_node)
    return document, i18n_lib.source_hash(document)


def memory_path(locale: str, slug: str) -> Path:
    return TM_DIR / locale / f"{slug}.json"


def queue(locale: str) -> list[str]:
    catalog = load_catalog()
    slugs = sorted(p.parent.name for p in PAGES.glob("*/index.html"))
    missing = [slug for slug in slugs if not memory_path(locale, slug).is_file()]
    order = {slug: (catalog.get(slug, {}).get("category", "~"), catalog.get(slug, {}).get("name", slug)) for slug in missing}
    return sorted(missing, key=lambda slug: order[slug])


def export(locale: str, slugs: list[str]) -> dict:
    catalog = load_catalog()
    pages = []
    for slug in slugs:
        document, digest = page_units(slug)
        record = catalog.get(slug, {})
        pages.append(
            {
                "slug": slug,
                "sourceHash": digest,
                "name": record.get("name", ""),
                "description": record.get("description", ""),
                "guidance": record.get("guidance", ""),
                "units": i18n_lib.units(document),
            }
        )
    return {
        "locale": locale,
        "glossary": GLOSSARY.get(locale, {}),
        "common": load_common(locale),
        "pages": pages,
    }


def numeric_tokens(text: str) -> list[str]:
    normalized = []
    for token in NUMBER_RE.findall(text):
        normalized.append(token.replace(",", "."))
    return sorted(normalized)


def check_page(payload: dict, locale: str, written: dict) -> tuple[list[str], list[str]]:
    problems: list[str] = []
    warnings: list[str] = []
    english: list[tuple[str, str]] = []
    slug = payload.get("slug", "")
    if slug not in written:
        return [f"{slug}: no such page"], warnings
    source_document, source_hash = written[slug]
    expected = i18n_lib.units(source_document)

    if payload.get("sourceHash") != source_hash:
        problems.append(f"{slug}: source hash does not match the page on disk (stale payload)")
    strings = payload.get("strings")
    if not isinstance(strings, dict):
        return problems + [f"{slug}: no strings object"], warnings
    missing = [unit for unit in expected if unit not in strings]
    extras = [unit for unit in strings if unit not in expected]
    if missing:
        problems.append(f"{slug}: {len(missing)} units not translated, first: {missing[0][:60]!r}")
    if extras:
        problems.append(f"{slug}: {len(extras)} strings not on the page, first: {extras[0][:60]!r}")

    for field in ("name", "description", "guidance"):
        if not isinstance(payload.get(field, ""), str):
            problems.append(f"{slug}: {field} must be a string")

    bad = []
    identical: list[str] = []
    whitespace: list[str] = []
    prose = 0
    for unit, translation in strings.items():
        if unit not in expected:
            continue
        if not isinstance(translation, str) or not translation.strip():
            bad.append((unit, "empty translation"))
            continue
        if sorted(TAG_RE.findall(unit)) != sorted(TAG_RE.findall(translation)):
            bad.append((unit, "markup differs"))
            continue
        if sorted(PLACEHOLDER_RE.findall(unit)) != sorted(PLACEHOLDER_RE.findall(translation)):
            bad.append((unit, "placeholder differs"))
            continue
        if numeric_tokens(unit) != numeric_tokens(translation):
            bad.append((unit, "numbers differ"))
            continue
        if sorted(re.findall(r"&[a-zA-Z]+;|&#\d+;", unit)) != sorted(re.findall(r"&[a-zA-Z]+;|&#\d+;", translation)):
            bad.append((unit, "entity differs"))
            continue
        plain = html_module.unescape(re.sub(r"</?[a-zA-Z][^>]*>", "", unit)).strip()
        prose_unit = len(plain) > 12 and not i18n_lib.is_code_shaped(plain)
        if prose_unit:
            prose += 1
        # An edit that only moves whitespace is not a translation: it is a way to
        # dodge the identical-text rule (doubling a space in a CSS selector, or
        # rewriting a CSV sample). Keep the source string instead.
        if translation != unit and " ".join(translation.split()) == " ".join(unit.split()):
            whitespace.append(unit)
            continue
        if translation.strip() == unit.strip() and prose_unit:
            words = {word.upper().strip(".,:;!?()") for word in plain.split() if len(word) > 1}
            if not words or not words <= KEEP_WORDS:
                identical.append(unit)
                continue
        if locale != "en" and left_in_english(translation):
            english.append((unit, left_in_english(translation)))
    if bad:
        problems.append(f"{slug}: {len(bad)} invalid strings, first: {bad[0][0][:50]!r} ({bad[0][1]})")
    # One untranslated unit can be a font stack or a format name; most of them
    # means the page was skipped. Only the second case fails the batch.
    if identical and len(identical) >= 3 and len(identical) * 2 >= max(3, prose):
        problems.append(
            f"{slug}: {len(identical)} of {prose} prose units are identical to the English, "
            f"first: {identical[0][:50]!r}"
        )
    elif identical:
        warnings.append(f"{slug}: {len(identical)} prose unit(s) left in English, first: {identical[0][:40]!r}")
    if whitespace:
        warnings.append(f"{slug}: {len(whitespace)} whitespace-only edit(s) reverted, first: {whitespace[0][:40]!r}")
    for unit, word in english[:3]:
        warnings.append(f"{slug}: possible English left in {unit[:40]!r} ({word!r})")
    return problems, warnings


ENGLISH_MARKERS = re.compile(
    r"\b(the|and|with|your|you|from|this|that|these|those|please|enter|select|choose|must|will|when|then)\b",
    re.I,
)


def left_in_english(text: str) -> str:
    """Return an English function word when a translation still reads English.

    German and Spanish share almost none of these tokens, and the few that do
    (``will``, ``then``) are rare inside technical copy. This is a warning, not a
    gate: brand names, unit symbols and quoted code must survive translation.
    """
    if len(ENGLISH_MARKERS.findall(text)) < 2:
        return ""
    return ENGLISH_MARKERS.findall(text)[0].lower()



def import_batch(locale: str, path: Path, write: bool, prune: bool = False) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("locale") != locale:
        print(f"error: payload is for {payload.get('locale')!r}, not {locale!r}", file=sys.stderr)
        return 1
    written: dict[str, tuple[dict, str]] = {}
    problems_total = 0
    accepted = 0
    for page in payload.get("pages", []):
        slug = page.get("slug", "")
        try:
            written[slug] = page_units(slug)
        except FileNotFoundError:
            print(f"error: {slug}: page is missing", file=sys.stderr)
            problems_total += 1
            continue
        if prune:
            # The page's units moved under this payload (an extraction change, not
            # a translation error). Drop keys the page no longer exposes and
            # rebase the hash; units the page *gained* still have to be written.
            current = i18n_lib.units(written[slug][0])
            extras = sorted(set(page.get("strings", {})) - set(current))
            if extras:
                print(f"pruned {slug}: {len(extras)} stale key(s)", file=sys.stderr)
            page["strings"] = {unit: page["strings"][unit] for unit in current if unit in page.get("strings", {})}
            page["sourceHash"] = written[slug][1]
        problems, warnings = check_page(page, locale, written)
        for warning in warnings:
            print("warn: " + warning, file=sys.stderr)
        if problems:
            problems_total += len(problems)
            for problem in problems:
                print("error: " + problem, file=sys.stderr)
            continue
        for unit in list(page["strings"]):
            value = page["strings"][unit]
            if value != unit and " ".join(value.split()) == " ".join(unit.split()):
                page["strings"][unit] = unit
        common = load_common(locale)
        canonical = 0
        for unit, value in common.items():
            if unit in page["strings"] and page["strings"][unit] != value:
                page["strings"][unit] = value
                canonical += 1
        if canonical:
            print(f"note {slug}: {canonical} shared string(s) set to the canonical wording", file=sys.stderr)
        accepted += 1
        if not write:
            print(f"ok {slug}: {len(page['strings'])} strings")
            continue
        target = memory_path(locale, slug)
        target.parent.mkdir(parents=True, exist_ok=True)
        document = {
            "slug": slug,
            "locale": locale,
            "name": page.get("name", ""),
            "description": page.get("description", ""),
            "reviewed": bool(page.get("reviewed", False)),
            "sourceHash": page["sourceHash"],
            "strings": {unit: page["strings"][unit] for unit in i18n_lib.units(written[slug][0])},
        }
        guidance = page.get("guidance", "")
        if guidance:
            document["guidance"] = guidance
        target.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}: {len(document['strings'])} strings")
    print(f"{accepted}/{len(payload.get('pages', []))} pages valid, {problems_total} problems")
    return 1 if problems_total else 0


def prune_memories(locale: str, write: bool) -> int:
    """Drop memory keys the page no longer exposes; report units it gained."""
    directory = TM_DIR / locale
    pruned = stale = 0
    for path in sorted(directory.glob("*.json")):
        memory = json.loads(path.read_text(encoding="utf-8"))
        slug = path.stem
        try:
            document, digest = page_units(slug)
        except FileNotFoundError:
            print(f"error: {slug}: page is missing", file=sys.stderr)
            continue
        current = i18n_lib.units(document)
        whitespace = [
            unit for unit, value in memory.get("strings", {}).items()
            if value != unit and " ".join(value.split()) == " ".join(unit.split())
        ]
        for unit in whitespace:
            memory["strings"][unit] = unit
        common = load_common(locale)
        canonical = [
            unit for unit, value in common.items()
            if unit in memory.get("strings", {}) and memory["strings"][unit] != value
        ]
        for unit in canonical:
            memory["strings"][unit] = common[unit]
        orphans = [unit for unit in memory.get("strings", {}) if unit not in current]
        missing = [unit for unit in current if unit not in memory.get("strings", {})]
        if orphans or canonical or whitespace:
            pruned += 1
            for unit in orphans:
                memory["strings"].pop(unit, None)
            memory["sourceHash"] = digest
            if write:
                path.write_text(json.dumps(memory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(
                f"{'pruned' if write else 'would prune'} {slug}: "
                f"-{len(orphans)} orphan(s), {len(canonical)} canonical, {len(whitespace)} whitespace"
            )
        if missing:
            stale += 1
            print(f"error: {slug}: {len(missing)} new unit(s), first: {missing[0][:50]!r}", file=sys.stderr)
    print(f"{pruned} memory file(s) pruned, {stale} still need translation")
    return 1 if stale else 0


def status() -> int:
    registry = json.loads((DATA / "i18n" / "locales.json").read_text(encoding="utf-8"))
    slugs = sorted(p.parent.name for p in PAGES.glob("*/index.html"))
    for entry in registry["locales"]:
        code = entry["code"]
        if code == registry["default"]:
            continue
        done = sum(1 for slug in slugs if memory_path(code, slug).is_file())
        print(f"{code}: {done}/{len(slugs)} pages have a memory ({100 * done / len(slugs):.1f}%)")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    export_cmd = sub.add_parser("export")
    export_cmd.add_argument("--locale", required=True)
    export_cmd.add_argument("--count", type=int, default=12)
    export_cmd.add_argument("--offset", type=int, default=0)
    export_cmd.add_argument("--slug", action="append", default=[])
    export_cmd.add_argument("--out", required=True)
    import_cmd = sub.add_parser("import")
    import_cmd.add_argument("--locale", required=True)
    import_cmd.add_argument("--in", dest="source", required=True)
    import_cmd.add_argument("--write", action="store_true")
    import_cmd.add_argument("--prune", action="store_true",
                            help="drop strings the page no longer exposes and rebase the hash")
    prune_cmd = sub.add_parser("prune")
    prune_cmd.add_argument("--locale", required=True)
    prune_cmd.add_argument("--write", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args(argv[1:])

    if args.command == "prune":
        return prune_memories(args.locale, args.write)
    if args.command == "status":
        return status()
    if args.command == "export":
        pending = queue(args.locale)
        slugs = args.slug or pending[args.offset : args.offset + args.count]
        payload = export(args.locale, slugs)
        Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        chars = sum(len(unit) for page in payload["pages"] for unit in page["units"])
        print(f"exported {len(slugs)} pages, {chars} source chars -> {args.out}")
        return 0
    return import_batch(args.locale, Path(args.source), args.write, args.prune)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
