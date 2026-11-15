import unittest

from scripts import i18n_lib


def units_of(markup: str) -> list[str]:
    root, _ = i18n_lib.parse(markup)
    return i18n_lib.units(i18n_lib.extract_units(root))


class AttributeExtractionTests(unittest.TestCase):
    def test_placeholder_inside_a_labelled_control_is_a_unit(self):
        """A <label> swallows its control's text, not its attribute copy."""
        markup = (
            '<html><body><main>'
            '<label>Custom input names'
            '<textarea placeholder="Comma-separated safe names"></textarea></label>'
            '<label>File<input type="file" aria-label="Choose a WAV file"></label>'
            '</main></body></html>'
        )
        units = units_of(markup)
        self.assertIn("Custom input names", units)
        self.assertIn("Comma-separated safe names", units)
        self.assertIn("Choose a WAV file", units)

    def test_title_attribute_inside_a_paragraph_is_a_unit(self):
        markup = (
            '<html><body><main>'
            '<p>Press <a href="#" title="Open the reference">this link</a> first.</p>'
            '</main></body></html>'
        )
        units = units_of(markup)
        self.assertIn("Open the reference", units)
        self.assertIn("this link", units)


class NestedAttributeRenderTests(unittest.TestCase):
    def test_attribute_inside_a_translated_block_is_applied(self):
        """A block unit carries its markup, so its attributes must still render."""
        markup = (
            '<html><body><main><table><thead><tr>'
            '<th scope="col"><span aria-label="Actions">Actions</span></th>'
            '</tr></thead></table></main></body></html>'
        )
        block = '<span aria-label="Actions">Actions</span>'
        mapping = {block: '<span aria-label="Actions">Aktionen</span>', "Actions": "Aktionen"}
        rendered, applied, unused = i18n_lib.render(markup, mapping)
        self.assertIn('aria-label="Aktionen"', rendered)
        self.assertIn(">Aktionen<", rendered)
        self.assertFalse(unused)


class JsEscapeTests(unittest.TestCase):
    def test_unicode_escapes_decode_to_the_character(self):
        """`\u00b2` is a superscript two, not the text "u00b2"."""
        body = "W/(m" + chr(92) + "u00b2" + chr(92) + "u00b7K) " + chr(92) + "x41"
        self.assertEqual(i18n_lib.js_unescape(body), "W/(m\u00b2\u00b7K) A".replace("\\u00b2", "\u00b2").replace("\\u00b7", "\u00b7"))
        self.assertEqual(i18n_lib.js_unescape(chr(92) + "u2014"), "\u2014")

    def test_a_broken_escape_is_left_alone(self):
        self.assertEqual(i18n_lib.js_unescape(chr(92) + "u12"), "u12")


class EscapingTests(unittest.TestCase):
    def test_escaped_markup_in_text_survives_a_round_trip(self):
        """`&lt;table&gt;` shown as code must not become a real element."""
        source = '<html><body><p>adds <code>&lt;table class="data-table"&gt;</code>.</p></body></html>'
        root, _ = i18n_lib.parse(source)
        rendered = "".join(i18n_lib.serialize(child) for child in root.children)
        self.assertIn("&lt;table", rendered)
        self.assertNotIn("<table", rendered)
        unit = next(iter(i18n_lib.extract_units(root)["html"]))
        self.assertIn("&lt;table", unit)

    def test_a_js_literal_that_holds_half_a_tag_is_not_repaired(self):
        """Translation must not close tags the page splits across literals."""
        source = (
            '<html><body><main><div id="x"></div></main>'
            '<script>el.innerHTML = "<span class=\'k\'>values</span> <span class=\'v\'>" + n + "</span>";</script>'
            '</body></html>'
        )
        rendered, applied, unused = i18n_lib.render(source, {"values": "valores"})
        self.assertIn('"<span class=\'k\'>valores</span> <span class=\'v\'>" + n + "</span>"', rendered)
        self.assertFalse(unused)


class CodeFragmentTests(unittest.TestCase):
    def test_literal_fragments_of_a_string_expression_are_not_units(self):
        """Translating these would rewrite the page's arithmetic."""
        self.assertFalse(i18n_lib.looks_prose_literal(', ]/.test(s)?`'))
        self.assertFalse(i18n_lib.looks_prose_literal(", ]/.test(v)?'"))
        self.assertFalse(i18n_lib.looks_prose_literal('${r.toLocaleString(undefined,{maximumFractionDigits:8})}'))
        self.assertFalse(i18n_lib.looks_prose_literal(').replace(/ /g,'))

    def test_real_copy_still_extracts_after_the_density_test(self):
        for text in (
            "Enter values to calculate.",
            "All calculations run locally in your browser — nothing leaves your device.",
            "Result (m/s)",
            "Enter a specific gravity such as 1.050.",
            "must be a whole number from 1 to 64.",
        ):
            self.assertTrue(i18n_lib.looks_prose_literal(text), text)


if __name__ == "__main__":
    unittest.main()
