import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_tool_curation import render_redirect_config


class PassphraseRedirectTest(unittest.TestCase):
    def test_legacy_urls_redirect_directly_to_diceware_in_the_same_language(self):
        data_dir = ROOT / "data"
        policy = json.loads((data_dir / "tool-curation.json").read_text(encoding="utf-8"))
        rules = render_redirect_config(policy["redirects"], policy, data_dir).splitlines()
        for prefix in ("", "/de", "/es"):
            target = f"{prefix}/tools/diceware-passphrase/"
            for ending in ("", "/", "/index.html"):
                source = f"{prefix}/tools/passphrase-generator{ending}"
                with self.subTest(source=source):
                    self.assertIn(f"location = {source} {{ return 301 {target}; }}", rules)

        self.assertFalse((ROOT / "frontend/tools/passphrase-generator/index.html").exists())
