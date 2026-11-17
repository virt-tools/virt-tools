"""The sitemap index must stay in step with the catalog and the i18n manifest.

The site ships no static internal links, so these files are the only discovery
path a crawler gets: a stale child silently drops URLs, and a duplicate one
wastes crawl budget. These tests pin the layout, the counts, the hreflang sets
and the staleness gate that the image build runs.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://virt.tools"

_spec = importlib.util.spec_from_file_location(
    "generate_sitemap", ROOT / "scripts" / "generate_sitemap.py"
)
if _spec is None or _spec.loader is None:  # pragma: no cover - broken checkout
    raise SystemExit("tests/test_sitemap.py: cannot load scripts/generate_sitemap.py")
sitemap = importlib.util.module_from_spec(_spec)
sys.modules["generate_sitemap"] = sitemap
_spec.loader.exec_module(sitemap)


def _tool(slug: str, added: str = "2026-05-01") -> dict:
    return {"slug": slug, "name": slug.replace("-", " ").title(), "category": "Math",
            "listed": True, "added": added}


class SitemapLayoutTest(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "frontend"
        (self.root / "assets" / "i18n").mkdir(parents=True)
        (self.root.parent / "data").mkdir(parents=True)

        catalog = {
            "tools": [
                _tool("alpha-calculator"),
                _tool("beta-calculator"),
                _tool("gamma-calculator"),
                dict(_tool("hidden-calculator"), listed=False),
            ]
        }
        (self.root / "assets" / "tool-catalog.json").write_text(json.dumps(catalog))
        manifest = {
            "de": {"path": "de", "pages": {"": "h", "tools/alpha-calculator/": "h",
                                           "tools/beta-calculator/": "h"}},
            "es": {"path": "es", "pages": {"": "h", "tools/alpha-calculator/": "h"}},
        }
        (self.root / "assets" / "i18n" / "manifest.json").write_text(json.dumps(manifest))
        (self.root.parent / "data" / "tool-curation.json").write_text(
            json.dumps({"unlist": ["gamma-calculator"], "keep": []})
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def files(self) -> dict:
        return sitemap.build(self.root, BASE)

    def test_index_lists_every_child_once(self):
        files = self.files()
        index = files["sitemap.xml"]
        self.assertIn("<sitemapindex", index)
        children = [name for name in files if name != "sitemap.xml"]
        for name in children:
            self.assertEqual(index.count(f"/{name}"), 1, name)
        self.assertEqual(len(children), 4)
        self.assertIn("sitemap-pages.xml", children)
        self.assertIn("sitemap-tools-en.xml", children)
        self.assertIn("sitemap-tools-de.xml", children)
        self.assertIn("sitemap-tools-es.xml", children)

    def test_counts_follow_the_catalog_and_the_manifest(self):
        files = self.files()
        # five static pages: /, /feedback/, /privacy/ and the two locale homes
        self.assertEqual(files["sitemap-pages.xml"].count("<loc>"), 5)
        # alpha and beta are listed; gamma is unlisted
        self.assertEqual(files["sitemap-tools-en.xml"].count("<loc>"), 2)
        self.assertEqual(files["sitemap-tools-de.xml"].count("<loc>"), 2)
        self.assertEqual(files["sitemap-tools-es.xml"].count("<loc>"), 1)
        self.assertNotIn("gamma-calculator", "".join(files.values()))
        self.assertNotIn("hidden-calculator", "".join(files.values()))

    def test_every_translated_url_carries_the_same_hreflang_set(self):
        files = self.files()
        sets = {}
        for name, xml in files.items():
            for block in sitemap.re.findall(r"<url>.*?</url>", xml, sitemap.re.S):
                if "/tools/alpha-calculator/" not in block:
                    continue
                sets[name] = tuple(sorted(sitemap.re.findall(r'hreflang="([^"]+)"', block)))
        self.assertEqual(len(set(sets.values())), 1, sets)
        self.assertEqual(set(sets["sitemap-tools-en.xml"]), {"x-default", "en", "de", "es"})

    def test_locale_entries_carry_lastmod_from_the_catalog(self):
        files = self.files()
        for name in ("sitemap-tools-en.xml", "sitemap-tools-de.xml", "sitemap-tools-es.xml"):
            self.assertIn("<lastmod>2026-05-01</lastmod>", files[name], name)

    def test_lastmod_is_clamped_to_today(self):
        future = (dt.date.today() + dt.timedelta(days=3)).isoformat()
        (self.root / "assets" / "tool-catalog.json").write_text(
            json.dumps({"tools": [_tool("alpha-calculator", added=future)]})
        )
        xml = self.files()["sitemap-tools-en.xml"]
        today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
        self.assertNotIn(future, xml)
        self.assertIn(f"<lastmod>{today}</lastmod>", xml)

    def test_pages_child_carries_alternates_only_where_locales_exist(self):
        pages = self.files()["sitemap-pages.xml"]
        home = sitemap.re.search(r"<url><loc>https://virt.tools/</loc>.*?</url>", pages).group(0)
        self.assertIn('hreflang="de"', home)
        self.assertIn('hreflang="es"', home)
        feedback = sitemap.re.search(r"<url><loc>https://virt.tools/feedback/</loc>.*?</url>", pages).group(0)
        self.assertNotIn("hreflang", feedback)


class SitemapGateTest(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "frontend"
        (self.root / "assets" / "i18n").mkdir(parents=True)
        (self.root.parent / "data").mkdir(parents=True)
        self.write_catalog([_tool("alpha-calculator")])

    def write_catalog(self, tools: list) -> None:
        (self.root / "assets" / "tool-catalog.json").write_text(json.dumps({"tools": tools}))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, *extra: str) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return sitemap.main(["generate_sitemap.py", str(self.root), BASE, *extra])

    def test_write_then_check_is_current(self):
        self.assertEqual(self.run_cli(), 0)
        self.assertEqual(self.run_cli("--check"), 0)

    def test_dry_run_validates_without_writing(self):
        self.assertEqual(self.run_cli("--dry-run"), 0)
        self.assertFalse((self.root / "sitemap.xml").exists())
        self.assertEqual(self.run_cli("--check"), 1)

    def test_check_before_writing_reports_stale(self):
        self.assertEqual(self.run_cli("--check"), 1)

    def test_a_new_tool_makes_the_files_stale(self):
        self.assertEqual(self.run_cli(), 0)
        self.write_catalog([_tool("alpha-calculator"), _tool("delta-calculator")])
        self.assertEqual(self.run_cli("--check"), 1)
        self.assertEqual(self.run_cli(), 0)
        self.assertEqual(self.run_cli("--check"), 0)

    def test_an_unlisted_tool_is_dropped_on_regeneration(self):
        self.assertEqual(self.run_cli(), 0)
        self.write_catalog([_tool("alpha-calculator"), _tool("epsilon-calculator")])
        self.assertEqual(self.run_cli(), 0)
        self.assertIn("epsilon-calculator", (self.root / "sitemap-tools-en.xml").read_text())
        self.write_catalog([_tool("alpha-calculator"),
                            dict(_tool("epsilon-calculator"), listed=False)])
        self.assertEqual(self.run_cli(), 0)
        self.assertNotIn("epsilon-calculator", (self.root / "sitemap-tools-en.xml").read_text())
        self.assertEqual(self.run_cli("--check"), 0)

    def test_a_catalog_without_listed_tools_is_refused(self):
        self.write_catalog([dict(_tool("epsilon-calculator"), listed=False)])
        self.assertEqual(self.run_cli(), 1)

    def test_a_child_from_an_old_layout_is_removed(self):
        stale = self.root / "sitemap-categories.xml"
        stale.write_text("<?xml version='1.0'?><urlset/>")
        self.assertEqual(self.run_cli(), 0)
        self.assertFalse(stale.exists())
        self.assertEqual(self.run_cli("--check"), 0)


class RepositoryWiringTest(unittest.TestCase):
    """The build must generate the files and then prove they are current."""

    def test_dockerfile_generates_and_checks_the_sitemap(self):
        dockerfile = (ROOT / "nginx" / "Dockerfile").read_text()
        self.assertIn("generate_sitemap.sh frontend https://virt.tools", dockerfile)
        self.assertIn("generate_sitemap.py frontend https://virt.tools --check", dockerfile)

    def test_robots_points_at_the_index(self):
        robots = (ROOT / "frontend" / "robots.txt").read_text()
        self.assertIn("Sitemap: https://virt.tools/sitemap.xml", robots)

    def test_wrapper_still_accepts_the_old_arguments(self):
        wrapper = (ROOT / "scripts" / "generate_sitemap.sh").read_text()
        self.assertIn("generate_sitemap.py", wrapper)
        self.assertIn('"$@"', wrapper)


if __name__ == "__main__":
    unittest.main()
