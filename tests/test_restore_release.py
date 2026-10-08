"""Test release preservation without touching Docker or a real feedback database."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RestoreReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        (self.root / "runtime/edge").mkdir(parents=True)
        (self.root / "runtime/edge/active-slot").write_text("green\n")
        shutil.copy(ROOT / "scripts/restore_feedback.sh", self.root / "scripts")
        self.archive = self.root / "test-archive"
        self.archive.write_bytes(b"fixture only; fake Docker does not restore it")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls.jsonl"
        docker = self.bin / "docker"
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["VT_TEST_LOG"], "a") as log:
    log.write(json.dumps({"args":args,"tag":os.environ.get("VT_IMAGE_TAG")}) + "\\n")
if args[0] == "inspect":
    print(os.environ.get("VT_TEST_IMAGE", "virt-tools-api:release-active-test"))
elif "ps" in args:
    print("a" * 64)
elif "stop" in args and "virt-tools-green" in args and os.environ.get("VT_TEST_STOP_FAIL"):
    sys.exit(9)
elif "run" in args:
    sys.stdin.buffer.read()
    sys.exit(int(os.environ.get("VT_TEST_RESTORE_EXIT", "0")))
''')
        docker.chmod(0o700)
        self.env = dict(os.environ, PATH=f"{self.bin}:/usr/bin:/bin", VT_TEST_LOG=str(self.log))

    def run_restore(self):
        result = subprocess.run(
            ["sh", str(self.root / "scripts/restore_feedback.sh"), "--yes",
             "--allow-plain", str(self.archive)],
            env=self.env, capture_output=True, text=True, timeout=10,
        )
        self.calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result

    def assert_existing_releases_restarted(self):
        starts = [c["args"] for c in self.calls if "start" in c["args"]]
        self.assertEqual(len(starts), 2)
        self.assertTrue(any("virt-tools-blue" in c for c in starts))
        self.assertTrue(any("virt-tools-green" in c for c in starts))
        self.assertFalse(any("up" in c["args"] for c in self.calls))

    def test_active_image_is_used_and_existing_containers_are_started(self):
        result = self.run_restore()
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(c for c in self.calls if "run" in c["args"])
        self.assertEqual(run["tag"], "release-active-test")
        self.assert_existing_releases_restarted()

    def test_restore_failure_still_restarts_existing_containers(self):
        self.env["VT_TEST_RESTORE_EXIT"] = "7"
        self.assertEqual(self.run_restore().returncode, 7)
        self.assert_existing_releases_restarted()

    def test_partial_stop_failure_still_restarts_existing_containers(self):
        self.env["VT_TEST_STOP_FAIL"] = "1"
        self.assertEqual(self.run_restore().returncode, 9)
        self.assertFalse(any("run" in c["args"] for c in self.calls))
        self.assert_existing_releases_restarted()

    def test_unexpected_image_fails_before_stopping_writers(self):
        self.env["VT_TEST_IMAGE"] = "unexpected/image:latest"
        self.assertNotEqual(self.run_restore().returncode, 0)
        self.assertFalse(any("stop" in c["args"] for c in self.calls))

    def test_standard_compose_preserves_release_too(self):
        (self.root / "runtime/edge/active-slot").unlink()
        result = self.run_restore()
        self.assertEqual(result.returncode, 0, result.stderr)
        starts = [c["args"] for c in self.calls if "start" in c["args"]]
        self.assertEqual(len(starts), 1)
        self.assertFalse(any("up" in c["args"] for c in self.calls))


if __name__ == "__main__":
    unittest.main()
