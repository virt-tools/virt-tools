"""Exercise the scheduler wrapper without invoking an agent or production tools."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MaintenanceRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.scripts = self.root / "scripts"
        self.scripts.mkdir()
        self.state = self.root / "runtime" / "maintenance"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        shutil.copy(ROOT / "scripts/run_feedback_maintenance.sh", self.scripts)
        for mode in ("prompt", "preflight"):
            (self.scripts / f"feedback-maintenance-{mode}.txt").write_text(mode)
        self.stub("docker", "exit 0\n")
        self.stub("git", "printf ' M existing-user-file\\n'\n")
        self.stub("codex", '''
printf '%s\\n' "$@" >"$VT_MAINTENANCE_RUN_DIR/args.txt"
cat >"$VT_MAINTENANCE_RUN_DIR/prompt.txt"
while [ "$#" -gt 0 ]; do
    if [ "$1" = --output-last-message ]; then
        shift
        printf 'test summary\\n' >"$1"
    fi
    shift
done
printf '{"test":true}\\n'
exit "${VT_TEST_EXIT:-0}"
''')
        self.env = dict(os.environ, PATH=f"{self.bin}:/usr/bin:/bin")

    def stub(self, name, source):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + source)
        path.chmod(0o700)

    def run_wrapper(self, *args):
        return subprocess.run(
            ["/bin/bash", str(self.scripts / "run_feedback_maintenance.sh"), *args],
            env=self.env, text=True, capture_output=True, timeout=10,
        )

    def test_run_uses_approval_review_and_private_logs(self):
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        run = Path((self.state / "latest-run.txt").read_text().strip())
        self.assertEqual((run / "prompt.txt").read_text(), "prompt")
        args = (run / "args.txt").read_text()
        self.assertIn("--approve-for-me", args)
        self.assertNotIn("bypass", args)
        self.assertIn("--cd", args)
        self.assertEqual((run / "exit-code.txt").read_text(), "0\n")
        self.assertIn("existing-user-file", (run / "worktree-before.txt").read_text())
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual((run / "events.jsonl").stat().st_mode & 0o777, 0o600)

    def test_preflight_has_separate_prompt_and_pointer(self):
        result = self.run_wrapper("preflight")
        self.assertEqual(result.returncode, 0, result.stderr)
        run = Path((self.state / "latest-preflight.txt").read_text().strip())
        self.assertEqual((run / "prompt.txt").read_text(), "preflight")
        self.assertFalse((self.state / "latest-run.txt").exists())

    def test_failed_agent_exit_is_propagated(self):
        self.env["VT_TEST_EXIT"] = "7"
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 7)
        run = Path((self.state / "latest-run.txt").read_text().strip())
        self.assertEqual((run / "exit-code.txt").read_text(), "7\n")

    def test_pause_prevents_invocation(self):
        self.state.mkdir(parents=True)
        (self.state / "PAUSED").touch()
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0)
        self.assertIn("paused", result.stdout)
        self.assertFalse((self.state / "latest-run.txt").exists())

    def test_overlapping_invocation_is_skipped(self):
        import fcntl
        self.state.mkdir(parents=True)
        with (self.state / "run.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_wrapper()
        self.assertEqual(result.returncode, 0)
        self.assertIn("already running", result.stdout)
        self.assertFalse((self.state / "latest-run.txt").exists())

    def test_invalid_mode_is_rejected(self):
        self.assertEqual(self.run_wrapper("unknown").returncode, 2)
        self.assertFalse(self.state.exists())


if __name__ == "__main__":
    unittest.main()
