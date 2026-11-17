"""Tests for the search-snippet budgets in scripts/generate_seo.py.

Search engines cut a result title at roughly 60 characters and a description at
roughly 160. The SEO pass therefore fits the injected ``<meta name="description">``
into ``DESC_LIMIT`` characters and drops the brand suffix from a ``<title>`` that
would overflow, on English pages and on every locale page alike. These tests run
the real pass over a small throwaway site and check the HTML a crawler receives.
"""

import html
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import generate_seo

BRAND = " — Virtual Tools"


def long_description(prefix: str, sentences: int = 6) -> str:
    """A description well past every budget, built from complete sentences."""
    sentence = (
        f"{prefix} measures one value from the others, adjusts for the conditions "
        "you enter, and shows the working so you can check the result by hand. "
    )
    return (sentence * sentences).strip()


def unbroken_description() -> str:
    """One long run of text with no sentence end before the budget."""
    return ("word " * 80).strip()


TOOLS = [
    {
        # 61 characters with the brand: one over the title budget.
        "slug": "borderline-title",
        "name": "Borderline Length Title Calculator Forty Five",
        "description": "Short and sweet. It fits without any cut at all.",
        "category": "Sizing",
        "listed": True,
    },
    {
        "slug": "long-title",
        "name": "Antenna Near-Field / Far-Field Boundary Calculator",
        "description": long_description("This tool"),
        "category": "Sizing",
        "listed": True,
    },
    {
        "slug": "huge-name",
        "name": "Calculadora de pérdida de trayecto en espacio libre y presupuesto de enlace",
        "description": unbroken_description(),
        "category": "Sizing",
        "listed": True,
    },
]

def page_html(title: str, description: str = "") -> str:
    meta = f'<meta name="description" content="{html.escape(description, quote=True)}">\n' if description else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        f"{meta}"
        f"<title>{title}</title>\n"
        "</head>\n"
        "<body>\n"
        "<main>\n"
        "<h1>Tool</h1>\n"
        "</main>\n"
        "</body>\n"
        "</html>\n"
    )


LOCALE_PAGES = {
    "de": {
        "": {
            "name": "Virtual Tools — kostenlose, private Browser-Werkzeuge mit vielen Extras",
            "description": long_description("Die Startseite"),
        },
        "tools/long-title/": {
            "name": "Rechner für die Grenze zwischen Nahfeld und Fernfeld einer Antenne",
            "description": long_description("Dieses Werkzeug"),
        },
        "tools/borderline-title/": {
            "name": "Kurzer Titel",
            "description": "Kurz und knapp. Passt ohne Kürzung.",
        },
    },
    "es": {
        "": {
            "name": "Virtual Tools — utilidades gratuitas y privadas en el navegador",
            "description": long_description("La página de inicio"),
        },
        "tools/huge-name/": {
            "name": "Calculadora de pérdida de trayecto en espacio libre y presupuesto de enlace",
            "description": long_description("Esta herramienta"),
        },
    },
}


def build_frontend(root: Path) -> None:
    (root / "assets" / "i18n").mkdir(parents=True)
    (root / "assets" / "tool-catalog.json").write_text(
        json.dumps({"version": 1, "tools": TOOLS}, indent=2), encoding="utf-8"
    )
    (root / "index.html").write_text(page_html("Virtual Tools"), encoding="utf-8")
    for tool in TOOLS:
        target = root / "tools" / tool["slug"] / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page_html(tool["name"] + BRAND), encoding="utf-8")

    manifest = {}
    for code, pages in LOCALE_PAGES.items():
        root_code = code
        manifest[code] = {"path": root_code, "htmlLang": code, "pages": pages}
        (root / root_code).mkdir(parents=True, exist_ok=True)
        for relative, meta in pages.items():
            title = meta["name"] + BRAND
            if relative:
                target = root / root_code / relative / "index.html"
                target.parent.mkdir(parents=True, exist_ok=True)
            else:
                target = root / root_code / "index.html"
            target.write_text(
                page_html(title).replace('<html lang="en">', f'<html lang="{code}">'),
                encoding="utf-8",
            )
    (root / "assets" / "i18n" / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def run_seo(root: Path) -> None:
    argv = sys.argv
    sys.argv = ["generate_seo.py", str(root), "https://virt.tools"]
    try:
        assert generate_seo.main() == 0
    finally:
        sys.argv = argv


def title_of(text: str) -> str:
    match = re.search(r"<title>(.*?)</title>", text, re.S)
    assert match, "page has no <title>"
    return html.unescape(match.group(1))


def meta_description(text: str) -> str:
    matches = re.findall(r'<meta\s+name="description"\s+content="(.*?)">', text, re.S)
    assert len(matches) == 1, f"expected one meta description, found {len(matches)}"
    return html.unescape(matches[0])


def content_of(text: str, attr: str, key: str) -> list[str]:
    pattern = rf'<meta\s+{attr}="{re.escape(key)}"\s+content="(.*?)">'
    return [html.unescape(value) for value in re.findall(pattern, text, re.S)]


def jsonld_description(text: str) -> str:
    match = re.search(r'"@type": "WebApplication".*?"description": "(.*?)"[,}]', text, re.S)
    assert match, "tool page has no JSON-LD description"
    return match.group(1)


class DescriptionBudgetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name) / "frontend"
        cls.root.mkdir()
        build_frontend(cls.root)
        run_seo(cls.root)
        cls.pages = sorted(cls.root.rglob("index.html"))
        cls.text = {page: page.read_text(encoding="utf-8") for page in cls.pages}

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_every_meta_description_fits_the_budget(self) -> None:
        for page, text in self.text.items():
            self.assertLessEqual(len(meta_description(text)), generate_seo.DESC_LIMIT, page)

    def test_cuts_end_on_a_word_or_a_sentence(self) -> None:
        for page, text in self.text.items():
            desc = meta_description(text)
            if not desc.endswith(generate_seo.ELLIPSIS):
                continue
            stem = desc[: -len(generate_seo.ELLIPSIS)]
            self.assertFalse(stem.endswith(" "), f"{page}: trailing space before the ellipsis")
            self.assertIsNone(
                re.search(r"[—–-]$", stem), f"{page}: dangling dash before the ellipsis"
            )
            self.assertIsNone(
                re.search(r"&[A-Za-z#0-9]*$", stem), f"{page}: clipped character reference"
            )

    def test_ellipses_are_never_stacked(self) -> None:
        for page, text in self.text.items():
            desc = meta_description(text)
            self.assertNotIn("……", desc, page)
            self.assertNotIn("..…", desc, page)
            self.assertNotIn("...…", desc, page)

    def test_a_cut_never_splits_a_word(self) -> None:
        source = next(t for t in TOOLS if t["slug"] == "long-title")["description"]
        words = set(source.split())
        desc = meta_description(self.text[self.root / "tools" / "long-title" / "index.html"])
        if desc.endswith(generate_seo.ELLIPSIS):
            last = desc[: -len(generate_seo.ELLIPSIS)].split(" ")[-1]
            self.assertIn(last, words, "the cut split a word")

    def test_prefers_a_sentence_boundary_when_one_fits_late(self) -> None:
        page = self.root / "tools" / "long-title" / "index.html"
        desc = meta_description(self.text[page])
        self.assertTrue(desc.endswith("."), desc)
        self.assertGreaterEqual(len(desc), generate_seo.DESC_MIN_KEEP)

    def test_short_descriptions_are_left_untouched(self) -> None:
        page = self.root / "tools" / "borderline-title" / "index.html"
        self.assertEqual(meta_description(self.text[page]), TOOLS[0]["description"])

    def test_unbreakable_text_is_left_whole_instead_of_chopped(self) -> None:
        # No space to cut on: a chopped token would be worse than an over-budget
        # description, so the text ships as is.
        text = "x" * 200
        self.assertEqual(generate_seo.fit_description(text), text)

    def test_og_and_twitter_keep_the_full_description(self) -> None:
        page = self.root / "tools" / "long-title" / "index.html"
        text = self.text[page]
        full = next(t for t in TOOLS if t["slug"] == "long-title")["description"]
        self.assertEqual(content_of(text, "property", "og:description"), [full])
        self.assertEqual(content_of(text, "name", "twitter:description"), [full])
        self.assertEqual(jsonld_description(text), full)

    def test_locale_pages_are_budgeted_from_their_own_translation(self) -> None:
        page = self.root / "de" / "tools" / "long-title" / "index.html"
        desc = meta_description(self.text[page])
        self.assertLessEqual(len(desc), generate_seo.DESC_LIMIT)
        self.assertTrue(
            desc.startswith("Dieses Werkzeug"), f"not the localized description: {desc!r}"
        )
        es_page = self.root / "es" / "tools" / "huge-name" / "index.html"
        es_desc = meta_description(self.text[es_page])
        self.assertLessEqual(len(es_desc), generate_seo.DESC_LIMIT)
        self.assertTrue(es_desc.startswith("Esta herramienta"), es_desc[:40])

    def test_localized_homepage_description_is_budgeted(self) -> None:
        page = self.root / "es" / "index.html"
        self.assertLessEqual(len(meta_description(self.text[page])), generate_seo.DESC_LIMIT)


class TitleBudgetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name) / "frontend"
        cls.root.mkdir()
        build_frontend(cls.root)
        run_seo(cls.root)
        cls.pages = sorted(cls.root.rglob("index.html"))
        cls.text = {page: page.read_text(encoding="utf-8") for page in cls.pages}

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_no_tool_title_keeps_a_suffix_past_the_budget(self) -> None:
        for page, text in self.text.items():
            if "tools" not in page.relative_to(self.root).parts:
                continue
            title = title_of(text)
            self.assertTrue(title.strip(), f"{page}: title was emptied")
            if len(title) <= generate_seo.TITLE_LIMIT:
                continue
            self.assertEqual(
                generate_seo.budget_title(title), title,
                f"{page}: the brand suffix should be gone: {title!r}",
            )
            self.assertIsNone(generate_seo.BRAND_SUFFIX_RE.search(title), page)

    def test_a_borderline_title_drops_the_suffix(self) -> None:
        page = self.root / "tools" / "borderline-title" / "index.html"
        self.assertEqual(title_of(self.text[page]), TOOLS[0]["name"])

    def test_a_short_title_keeps_the_suffix(self) -> None:
        page = self.root / "de" / "tools" / "borderline-title" / "index.html"
        self.assertEqual(title_of(self.text[page]), "Kurzer Titel" + BRAND)

    def test_a_name_longer_than_the_budget_ships_whole(self) -> None:
        page = self.root / "tools" / "huge-name" / "index.html"
        title = title_of(self.text[page])
        self.assertEqual(title, TOOLS[2]["name"])
        self.assertGreater(len(title), generate_seo.TITLE_LIMIT)

    def test_locale_title_drops_the_suffix_too(self) -> None:
        page = self.root / "de" / "tools" / "long-title" / "index.html"
        name = LOCALE_PAGES["de"]["tools/long-title/"]["name"]
        self.assertEqual(title_of(self.text[page]), name)
        self.assertGreater(len(name + BRAND), generate_seo.TITLE_LIMIT)

    def test_suffix_variants_are_all_recognised(self) -> None:
        name = "A Very Long Tool Name That Needs Plenty Of Room Indeed"
        for suffix in (" — Virtual Tools", " — virt.tools", " &mdash; Virtual Tools", " - Virtual Tools"):
            title = name + suffix
            self.assertGreater(len(html.unescape(title)), generate_seo.TITLE_LIMIT, suffix)
            self.assertEqual(generate_seo.budget_title(title), name)
        self.assertEqual(generate_seo.budget_title("Short — Virtual Tools"), "Short — Virtual Tools")

    def test_homepage_title_is_not_mangled(self) -> None:
        self.assertTrue(title_of(self.text[self.root / "index.html"]).startswith("Virtual Tools"))


class IdempotenceTest(unittest.TestCase):
    def test_second_run_changes_no_byte(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "frontend"
            root.mkdir()
            build_frontend(root)
            run_seo(root)
            first = {page: page.read_bytes() for page in sorted(root.rglob("index.html"))}
            run_seo(root)
            for page, before in first.items():
                self.assertEqual(page.read_bytes(), before, f"{page} changed on the second run")


class HelperTest(unittest.TestCase):
    def test_fit_description_keeps_fitting_text_verbatim(self) -> None:
        text = "A description that already fits."
        self.assertEqual(generate_seo.fit_description(text), text)

    def test_fit_description_cuts_at_the_last_late_sentence(self) -> None:
        text = ("First sentence that is long enough to be worth keeping. " * 3).strip()
        fitted = generate_seo.fit_description(text)
        self.assertTrue(fitted.endswith("."))
        self.assertLessEqual(len(fitted), generate_seo.DESC_LIMIT)

    def test_fit_description_does_not_stack_ellipses(self) -> None:
        text = "No sentence boundary here " * 20 + "…"
        fitted = generate_seo.fit_description(text.strip())
        self.assertLessEqual(len(fitted), generate_seo.DESC_LIMIT)
        self.assertFalse(fitted.endswith("……"))

    def test_fit_description_drops_a_dangling_dash(self) -> None:
        self.assertEqual(generate_seo._trim_dangling("Some complete phrase —"), "Some complete phrase")
        self.assertEqual(generate_seo._trim_dangling("Some complete phrase &am"), "Some complete phrase")
        fitted = generate_seo.fit_description(("x " * 75) + "— " + ("y " * 20))
        self.assertLessEqual(len(fitted), generate_seo.DESC_LIMIT)
        self.assertIsNone(re.search(r"[—–-]…$", fitted), fitted)

    def test_budget_title_leaves_an_unknown_suffix_alone(self) -> None:
        title = "A Very Long Tool Name That Needs Room And Then Some — Some Other Site"
        self.assertEqual(generate_seo.budget_title(title), title)


if __name__ == "__main__":
    unittest.main()
