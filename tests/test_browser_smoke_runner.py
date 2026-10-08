"""Test local browser startup, failure reporting, and cleanup without a browser."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class BrowserSmokeRunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        shutil.copy(ROOT / "scripts/run_browser_smoke.sh", self.root / "scripts")
        self.env = dict(
            os.environ,
            PATH=f"{self.bin}:/usr/bin:/bin",
            RUNNER_TEMP=str(self.root),
            STUB_STATE=str(self.root),
            STUB_MODE="success",
        )
        self.stub("python3", '''
printf '%s\\n' "$$" >"$STUB_STATE/server.pid"
echo 'test server diagnostic'
if [ "$STUB_MODE" = startup_failure ]; then exit 19; fi
exec /bin/sleep 60
''')
        self.stub("curl", '''
attempt=0
if [ -f "$STUB_STATE/attempts" ]; then read -r attempt <"$STUB_STATE/attempts"; fi
attempt=$((attempt + 1))
printf '%s\\n' "$attempt" >"$STUB_STATE/attempts"
case "$STUB_MODE" in startup_failure|timeout) exit 7 ;; esac
[ "$attempt" -ge 4 ]
''')
        self.stub("sleep", 'exec /bin/sleep 0.01\n')
        self.stub("node", '''
read -r attempt <"$STUB_STATE/attempts"
if [ "$attempt" -lt 4 ]; then exit 91; fi
printf '%s\\n' "$1" >>"$STUB_STATE/suites"
if [ "$STUB_MODE" = browser_failure ] && [ "$1" = tests/browser_smoke.mjs ]; then exit 17; fi
if [ "$STUB_MODE" = ui_failure ] && [ "$1" = tests/ui_smoke.mjs ]; then exit 23; fi
''')

    def stub(self, name, source):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + source, encoding="utf-8")
        path.chmod(0o700)

    def run_smoke(self, mode="success"):
        self.env["STUB_MODE"] = mode
        result = subprocess.run(
            ["bash", str(self.root / "scripts/run_browser_smoke.sh")],
            cwd=self.root,
            env=self.env,
            text=True,
            capture_output=True,
            timeout=10,
        )
        pid = int((self.root / "server.pid").read_text())
        with self.assertRaises(ProcessLookupError, msg="test server was not reaped"):
            os.kill(pid, 0)
        return result

    def test_waits_for_readiness_then_runs_both_suites(self):
        result = self.run_smoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "attempts").read_text().strip(), "4")
        self.assertEqual(
            (self.root / "suites").read_text().splitlines(),
            ["tests/browser_smoke.mjs", "tests/ui_smoke.mjs", "tests/unit_converter.test.cjs", "tests/tool_correctness.mjs"],
        )

    def test_startup_failure_prints_log_without_running_tests(self):
        result = self.run_smoke("startup_failure")
        self.assertEqual(result.returncode, 1)
        self.assertIn("exited before becoming ready", result.stderr)
        self.assertIn("test server diagnostic", result.stderr)
        self.assertFalse((self.root / "suites").exists())

    def test_readiness_timeout_is_bounded_and_prints_log(self):
        result = self.run_smoke("timeout")
        self.assertEqual(result.returncode, 1)
        self.assertIn("did not become ready after 60 attempts", result.stderr)
        self.assertIn("test server diagnostic", result.stderr)
        self.assertEqual((self.root / "attempts").read_text().strip(), "60")
        self.assertFalse((self.root / "suites").exists())

    def test_browser_failure_preserves_status_and_prints_log(self):
        result = self.run_smoke("browser_failure")
        self.assertEqual(result.returncode, 17)
        self.assertIn("test server diagnostic", result.stderr)
        self.assertEqual(
            (self.root / "suites").read_text().splitlines(),
            ["tests/browser_smoke.mjs"],
        )

    def test_ui_failure_preserves_status_and_prints_log(self):
        result = self.run_smoke("ui_failure")
        self.assertEqual(result.returncode, 23)
        self.assertIn("test server diagnostic", result.stderr)

if __name__ == "__main__":
    unittest.main()
