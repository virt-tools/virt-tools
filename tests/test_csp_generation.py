import tempfile
import unittest
from pathlib import Path

from scripts import generate_seo


PAGE = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>CSP fixture</title>
</head><body>
<button id="go" onclick="run('a&amp;b')">Go</button>
<script type="application/ld+json">{"@type": "Thing"}</script>
<script>window.ran = true;</script>
<script src="/assets/app.js"></script>
</body></html>
"""


class CspGenerationTest(unittest.TestCase):
    def test_hashes_inline_script_and_decoded_handler(self) -> None:
        block = generate_seo.csp_block(PAGE)
        self.assertIn(generate_seo._source_hash("window.ran = true;"), block)
        # The browser hashes the decoded attribute value, not the HTML entity.
        self.assertIn(generate_seo._source_hash("run('a&b')"), block)
        self.assertIn("script-src 'self' 'wasm-unsafe-eval'", block)
        self.assertIn("script-src-attr 'unsafe-hashes'", block)
        self.assertNotIn("ld+json", block)
        self.assertEqual(block.count("sha256-"), 2)

    def test_pages_without_handlers_deny_inline_attributes(self) -> None:
        block = generate_seo.csp_block(
            "<!DOCTYPE html><html><head></head><body><script>1;</script></body></html>"
        )
        self.assertIn("script-src-attr 'none'", block)

    def test_runtime_built_handlers_keep_attribute_fallback(self) -> None:
        page = (
            "<!DOCTYPE html><html><head></head><body><script>"
            "el.innerHTML = '<button onclick=\"go()\">x</button>';"
            "</script></body></html>"
        )
        block = generate_seo.csp_block(page)
        self.assertIn("script-src-attr 'unsafe-inline'", block)
        self.assertIn(generate_seo._source_hash(
            "el.innerHTML = '<button onclick=\"go()\">x</button>';"
        ), block)

    def test_injection_is_idempotent_and_keeps_head_first(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            page = Path(directory) / "index.html"
            page.write_text(PAGE, encoding="utf-8")
            generate_seo.inject_csp(page)
            first = page.read_text(encoding="utf-8")
            generate_seo.inject_csp(page)
            second = page.read_text(encoding="utf-8")

        self.assertEqual(first, second)
        self.assertEqual(second.count(generate_seo.CSP_BEGIN), 1)
        self.assertTrue(
            second.startswith('<!DOCTYPE html>\n<html lang="en"><head>\n  <!-- CSP BEGIN'),
            "CSP policy must precede every inline script in the document",
        )


if __name__ == "__main__":
    unittest.main()
