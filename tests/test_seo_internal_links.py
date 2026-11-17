"""Tests for the build-time internal links injected by scripts/generate_seo.py.

The shipped tool pages used to contain no ``<a href="/tools/...">`` at all: the
catalog, breadcrumb and related-tools list were built by assets/app.js in the
browser, so only the sitemaps exposed 2,000+ pages. These tests build a small
throwaway frontend, run the real SEO pass over it, and check the HTML a crawler
receives.
"""

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import generate_seo

MATH = [f"math-{letter}" for letter in "abcdefghij"]


def tool_record(slug: str, category: str, name: str = "") -> dict:
    return {
        "slug": slug,
        "name": name or slug.replace("-", " ").title(),
        "description": f"{slug} description.",
        "category": category,
        "listed": True,
    }


TOOLS = (
    [tool_record(slug, "Math") for slug in MATH]
    + [tool_record("tiny-a", "Tiny"), tool_record("tiny-b", "Tiny")]
    + [tool_record("solo-a", "Solo")]
)


def page_html(title: str, body_extra: str = "", close_main: bool = True) -> str:
    body = (
        '<header id="site-header"></header>\n'
        "<main>\n"
        f"<h1>{title}</h1>\n"
        "<p>Tool body.</p>\n" + body_extra
    )
    if close_main:
        body += "</main>\n"
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        f"<title>{title} — Virtual Tools</title>\n"
        "</head>\n"
        "<body>\n"
        + body
        + '<script src="/assets/app.js"></script>\n'
        "</body>\n"
        "</html>\n"
    )


def build_frontend(root: Path) -> None:
    """A miniature site: 10 Math tools, 2 Tiny tools, 1 Solo tool, de + es."""
    (root / "assets" / "i18n").mkdir(parents=True)
    (root / "assets" / "tool-catalog.json").write_text(
        json.dumps({"version": 1, "tools": TOOLS}, indent=2), encoding="utf-8"
    )
    (root / "index.html").write_text(page_html("All tools", "", close_main=False), encoding="utf-8")

    for tool in TOOLS:
        slug = tool["slug"]
        extra = ""
        close_main = True
        if slug == "math-a":
            # A sample document and a JS string that both look like real tags.
            extra = (
                '<textarea id="sample">&lt;main&gt;x&lt;/main&gt;</textarea>\n'
                '<script>var sample = "<main>fake</main>";</script>\n'
            )
        if slug == "tiny-b":
            close_main = False  # a few hand-written pages never close <main>
        target = root / "tools" / slug / "index.html"
        target.parent.mkdir(parents=True)
        target.write_text(page_html(tool["name"], extra, close_main), encoding="utf-8")

    manifest = {
        "de": {
            "path": "de",
            "htmlLang": "de",
            "pages": {
                "": {"name": "Alle Tools", "description": "Deutsch."},
                "tools/math-a/": {"name": "Mathe A (DE)", "description": "Deutsch."},
                "tools/math-b/": {"name": "Mathe B (DE)", "description": "Deutsch."},
            },
        },
        "es": {
            "path": "es",
            "htmlLang": "es",
            "pages": {
                "": {"name": "Todas las herramientas", "description": "Español."},
                "tools/math-a/": {"name": "Matemáticas A (ES)", "description": "Español."},
            },
        },
    }
    for code, info in manifest.items():
        locale_root = root / info["path"]
        locale_root.mkdir(parents=True)
        (locale_root / "index.html").write_text(
            page_html(info["pages"][""]["name"], "", close_main=False).replace(
                '<html lang="en">', f'<html lang="{code}">'
            ),
            encoding="utf-8",
        )
        for relative in info["pages"]:
            if not relative:
                continue
            target = root / info["path"] / relative / "index.html"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                page_html(info["pages"][relative]["name"]).replace(
                    '<html lang="en">', f'<html lang="{code}">'
                ),
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


def breadcrumbs(text: str) -> list[str]:
    return re.findall(r'<nav class="seo-breadcrumb".*?</nav>', text, re.S)


def related_sections(text: str) -> list[str]:
    return re.findall(
        r'<section class="related-tools seo-related".*?</section>', text, re.S
    )


def related_hrefs(section: str) -> list[str]:
    return re.findall(r'<li><a href="([^"]+)">', section)


def resolve(root: Path, href: str) -> Path:
    assert href.startswith("/"), href
    relative = href.strip("/")
    return (root / relative / "index.html") if relative else (root / "index.html")


def tool_pages(root: Path) -> list[Path]:
    return sorted(root.rglob("tools/*/index.html"))


class SeoInternalLinksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name) / "frontend"
        cls.root.mkdir()
        build_frontend(cls.root)
        run_seo(cls.root)
        cls.first_run = {page: page.read_text(encoding="utf-8") for page in tool_pages(cls.root)}

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_every_tool_page_has_one_breadcrumb_and_one_related_section(self) -> None:
        for page in tool_pages(self.root):
            text = self.first_run[page]
            self.assertEqual(len(breadcrumbs(text)), 1, page)
            tools_on_page = TOOLS
            category = next(t["category"] for t in tools_on_page if t["slug"] == page.parent.name)
            siblings = [t for t in tools_on_page if t["category"] == category and t["slug"] != page.parent.name]
            if siblings:
                self.assertEqual(len(related_sections(text)), 1, page)
                self.assertLessEqual(len(related_hrefs(related_sections(text)[0])), 8)
            else:
                self.assertEqual(related_sections(text), [], page)

    def test_breadcrumb_names_the_page_and_links_its_locale_home(self) -> None:
        nav = breadcrumbs(self.first_run[self.root / "tools" / "math-a" / "index.html"])[0]
        self.assertIn('<a href="/">All tools</a>', nav)
        self.assertIn('<span aria-current="page">Math A</span>', nav)
        self.assertIn('aria-label="Breadcrumb"', nav)

        nav = breadcrumbs(self.first_run[self.root / "de" / "tools" / "math-a" / "index.html"])[0]
        self.assertIn('<a href="/de/">Alle Tools</a>', nav)
        self.assertIn('<span aria-current="page">Mathe A (DE)</span>', nav)
        self.assertIn('aria-label="Pfadnavigation"', nav)

        nav = breadcrumbs(self.first_run[self.root / "es" / "tools" / "math-a" / "index.html"])[0]
        self.assertIn('<a href="/es/">Todas las herramientas</a>', nav)
        self.assertIn('<span aria-current="page">Matemáticas A (ES)</span>', nav)

    def test_related_links_are_catalog_order_siblings_capped_at_eight(self) -> None:
        page = self.root / "tools" / "math-e" / "index.html"
        hrefs = related_hrefs(related_sections(self.first_run[page])[0])
        # The window starts after the current tool and wraps: every page links
        # onward to its successors, so the whole category stops being orphaned.
        expected = ["/tools/" + slug + "/" for slug in ("math-f", "math-g", "math-h", "math-i",
                                                        "math-j", "math-a", "math-b", "math-c")]
        self.assertEqual(hrefs, expected)
        self.assertNotIn("/tools/math-e/", hrefs)

    def test_every_tool_receives_an_inbound_related_link(self) -> None:
        inbound = set()
        for page in tool_pages(self.root):
            for section in related_sections(self.first_run[page]):
                inbound.update(re.findall(r'href="/tools/([^/"]+)/"', section))
        expected = {tool["slug"] for tool in TOOLS if tool["category"] in {"Math", "Tiny"}}
        self.assertEqual(inbound, expected)

    def test_small_categories_degrade_instead_of_failing(self) -> None:
        tiny = related_sections(self.first_run[self.root / "tools" / "tiny-a" / "index.html"])[0]
        self.assertEqual(related_hrefs(tiny), ["/tools/tiny-b/"])
        self.assertIn(">Related tools</h2>", tiny)

        solo = self.first_run[self.root / "tools" / "solo-a" / "index.html"]
        self.assertEqual(related_sections(solo), [])
        self.assertEqual(len(breadcrumbs(solo)), 1, "the breadcrumb still renders")

    def test_no_page_links_to_itself_and_every_href_resolves(self) -> None:
        for page in tool_pages(self.root):
            text = self.first_run[page]
            relative = page.parent.relative_to(self.root)
            own_url = "/" + str(relative) + "/"
            for nav in breadcrumbs(text):
                for href in re.findall(r'href="([^"]+)"', nav):
                    self.assertNotEqual(href, own_url)
                    self.assertTrue(resolve(self.root, href).is_file(), f"{page}: dead href {href}")
            for section in related_sections(text):
                for href in related_hrefs(section):
                    self.assertNotEqual(href, own_url, f"{page} links to itself")
                    self.assertTrue(resolve(self.root, href).is_file(), f"{page}: dead href {href}")

    def test_localized_pages_link_localized_siblings_when_published(self) -> None:
        de_page = self.first_run[self.root / "de" / "tools" / "math-a" / "index.html"]
        section = related_sections(de_page)[0]
        self.assertIn(">Ähnliche Tools</h2>", section)
        self.assertIn('<a href="/de/tools/math-b/">Mathe B (DE)</a>', section)
        # math-c has no German page: fall back to the English URL and name.
        self.assertIn('<a href="/tools/math-c/">Math C</a>', section)

        es_page = self.first_run[self.root / "es" / "tools" / "math-a" / "index.html"]
        section = related_sections(es_page)[0]
        self.assertIn(">Herramientas relacionadas</h2>", section)
        self.assertTrue(all(href.startswith("/tools/") for href in related_hrefs(section)))

    def test_second_run_leaves_exactly_one_of_each_block(self) -> None:
        run_seo(self.root)
        for page in tool_pages(self.root):
            text = page.read_text(encoding="utf-8")
            self.assertEqual(len(breadcrumbs(text)), 1, page)
            self.assertLessEqual(len(related_sections(text)), 1, page)
            self.assertEqual(
                text,
                self.first_run[page],
                f"{page}: re-running generate_seo.py changed the page",
            )

    def test_blocks_add_no_inline_script_or_handler(self) -> None:
        for page in tool_pages(self.root):
            text = self.first_run[page]
            for block in breadcrumbs(text) + related_sections(text):
                self.assertNotIn("<script", block.lower())
                self.assertNotIn("onclick", block.lower())
                self.assertNotIn("style=", block.lower())

    def test_csp_hashes_ignore_the_injected_links(self) -> None:
        page = self.root / "tools" / "math-a" / "index.html"
        text = self.first_run[page]
        stripped = generate_seo.RELATED_BLOCK_RE.sub("", generate_seo.NAV_BLOCK_RE.sub("", text))
        policy = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)">', text)
        self.assertIsNotNone(policy)
        assert policy is not None
        self.assertIn(policy.group(1), generate_seo.csp_block(stripped))

    def test_hand_written_page_without_closing_main_still_gets_links(self) -> None:
        text = self.first_run[self.root / "tools" / "tiny-b" / "index.html"]
        self.assertEqual(len(breadcrumbs(text)), 1)
        self.assertLess(text.index('<section class="related-tools'), text.index("/assets/app.js"))
        self.assertLess(text.index('<nav class="seo-breadcrumb"'), text.index("<h1>"))

    def test_blocks_stay_inside_main_and_after_the_heading(self) -> None:
        text = self.first_run[self.root / "tools" / "math-a" / "index.html"]
        self.assertLess(text.index("<main>"), text.index('<nav class="seo-breadcrumb"'))
        self.assertLess(text.index("<h1>"), text.index('<section class="related-tools'))
        # The sample <script> string contains a literal </main>; the real closing
        # tag comes later, so the section must land between the two.
        self.assertGreater(text.index('<section class="related-tools'), text.index("var sample"))
        self.assertLess(text.index('<section class="related-tools'), text.rindex("</main>"))
        self.assertGreater(text.rindex("</main>"), text.index('var sample = "<main>fake</main>"'))


if __name__ == "__main__":
    unittest.main()
