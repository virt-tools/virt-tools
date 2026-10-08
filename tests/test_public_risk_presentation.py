import json
import re
import unittest
from pathlib import Path

from scripts import generate_seo
from scripts import generate_tool_catalog as catalog


ROOT = Path(__file__).resolve().parents[1]


def tool(slug: str, risk: str) -> dict:
    return {
        "slug": slug,
        "name": slug.replace("-", " ").title(),
        "description": "Test fixture.",
        "category": "Test",
        "subcategory": "Fixture",
        "icon": "🧪",
        "added": "2026-08-20T00:00:00Z",
        "tags": [],
        "aliases": [],
        "risk": risk,
        "maturity": "draft",
        "reviewedAt": None,
        "method": "Fixture method.",
        "sources": [],
        "testCases": [],
    }


class PublicRiskPresentationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.low = tool("low-fixture", "low")
        self.moderate = tool("moderate-fixture", "moderate")
        self.unknown_finance = tool("loan-fixture", "unknown")
        self.unknown_finance["category"] = "Finance"

    def test_browser_registry_omits_internal_risk(self) -> None:
        registry = catalog.render_browser_registry([self.low, self.moderate])
        payload = registry.split("window.VIRTUAL_TOOLS = ", 1)[1].rsplit(";", 1)[0]
        self.assertTrue(all("risk" not in entry for entry in json.loads(payload)))

    def test_public_metadata_uses_guidance_without_taxonomy(self) -> None:
        documents = catalog.metadata_documents([self.low, self.moderate, self.unknown_finance])
        low = json.loads(documents[self.low["slug"]])
        moderate = json.loads(documents[self.moderate["slug"]])
        unknown_finance = json.loads(documents[self.unknown_finance["slug"]])
        self.assertNotIn("risk", low)
        self.assertNotIn("risk", moderate)
        self.assertNotIn("guidance", low)
        self.assertRegex(moderate["guidance"], r"verify assumptions and important results")
        self.assertIsNone(re.search(r"\b(?:risk|moderate|high|critical)\b", moderate["guidance"], re.I))
        self.assertRegex(unknown_finance["guidance"], r"Financial estimate")
        self.assertNotIn("risk", unknown_finance)

    def test_seo_and_public_ui_omit_taxonomy(self) -> None:
        moderate_seo = generate_seo.tool_block("https://virt.tools", self.moderate)
        low_seo = generate_seo.tool_block("https://virt.tools", self.low)
        self.assertNotIn("vt:risk", moderate_seo)
        self.assertIn("vt:guidance", moderate_seo)
        self.assertNotIn("vt:guidance", low_seo)
        self.assertIn("vt:guidance", generate_seo.tool_block("https://virt.tools", self.unknown_finance))
        index = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "frontend" / "assets" / "app.js").read_text(encoding="utf-8")
        self.assertNotIn("risk-filter", index)
        self.assertNotIn("riskLabel", app)
        self.assertNotIn("metadata.risk", app)


if __name__ == "__main__":
    unittest.main()
