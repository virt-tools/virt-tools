import tempfile
import unittest
from pathlib import Path
from scripts.normalize_tool_design import normalize


class DesignNormalizerTests(unittest.TestCase):
    def test_quoted_markup_and_template_expressions_are_preserved(self):
        source = '''<html><head><title>Example</title></head><body><main><h1>Example</h1>
<textarea id="xml" placeholder="<root>value</root>"></textarea>
<input id="example" placeholder="a > b">
<script>const html = `<input aria-label="${name}">`;</script>
</main><script src="/assets/app.js"></script></body></html>'''
        with tempfile.TemporaryDirectory() as directory:
            page = Path(directory) / 'index.html'
            page.write_text(source)
            self.assertTrue(normalize(page))
            output = page.read_text()
            self.assertIn('placeholder="<root>value</root>" aria-label=', output)
            self.assertIn('placeholder="a > b" aria-label=', output)
            self.assertIn('aria-label="${name}"', output)
            self.assertNotIn('>>', output)
            self.assertFalse(normalize(page))


if __name__ == '__main__':
    unittest.main()
