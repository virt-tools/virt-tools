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
