from __future__ import annotations

import subprocess
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class OperationScriptTest(unittest.TestCase):
    def test_admin_cli_exposes_the_complete_feedback_lifecycle(self) -> None:
        result = subprocess.run(
            ["python3", str(ROOT / "scripts" / "manage_feedback.py"), "reply", "--help"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        for status in (
            "received", "reviewing", "planned", "resolved", "closed", "completed", "rejected"
        ):
            self.assertIn(status, result.stdout)

    def test_plain_restore_requires_a_separate_explicit_flag(self) -> None:
        script = ROOT / "scripts" / "restore_feedback.sh"
        result = subprocess.run(
            ["sh", str(script), "--yes"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--yes [--allow-plain] ARCHIVE", result.stderr)

        source = script.read_text(encoding="utf-8")
        self.assertIn('if [ "${1:-}" = "--allow-plain" ]', source)
        self.assertIn('if [ "$allow_plain" -eq 1 ]', source)
        self.assertIn("--force <\"$archive\"", source)

    def test_public_edge_restores_api_headers_and_dynamic_dns(self) -> None:
        edge = (ROOT / "deploy" / "blue-green" / "edge.conf").read_text(encoding="utf-8")
        deploy = (ROOT / "scripts" / "deploy_blue_green.sh").read_text(encoding="utf-8")
        standard = (ROOT / "nginx" / "nginx.conf").read_text(encoding="utf-8")
        for marker in (
            'add_header Cache-Control "no-store" always',
            'add_header Pragma "no-cache" always',
            'add_header X-Content-Type-Options "nosniff" always',
            'add_header Referrer-Policy "no-referrer" always',
            "proxy_hide_header Server",
        ):
            self.assertIn(marker, edge)
        self.assertIn("resolver 127.0.0.11 valid=10s ipv6=off", edge)
        self.assertIn("server virt-tools-$candidate-api:8000 resolve", deploy)
        self.assertIn("server virt-tools-$candidate-web:8080 resolve", deploy)
        self.assertIn("server api:8000 resolve", standard)
        self.assertIn("probe_edge", deploy)
        self.assertIn("the previous upstream was restored", deploy)
        self.assertIn("Retrying stable edge once", deploy)
        self.assertIn("migrate <blue|green>", deploy)
        self.assertIn("Migration failed; the legacy web container was restarted", deploy)
        self.assertIn('docker start "$legacy_web"', deploy)
        self.assertIn('docker compose -f "$standard_compose" down', deploy)
        self.assertIn('docker volume inspect "$feedback_volume"', deploy)
        self.assertIn("set_real_ip_from host.docker.internal", edge)
        self.assertIn("set_real_ip_from host.docker.internal", standard)

    def test_clipboard_read_policy_matches_shipped_paste_control(self) -> None:
        headers = (ROOT / "nginx" / "security-headers.conf").read_text(encoding="utf-8")
        tool = (
            ROOT / "frontend" / "tools" / "zero-width-steganography" / "index.html"
        ).read_text(encoding="utf-8")
        self.assertIn("navigator.clipboard.readText()", tool)
        self.assertIn("clipboard-read=(self)", headers)

    def test_backup_and_restore_are_blue_green_aware(self) -> None:
        backup = (ROOT / "scripts" / "backup_feedback.sh").read_text(encoding="utf-8")
        restore = (ROOT / "scripts" / "restore_feedback.sh").read_text(encoding="utf-8")
        self.assertIn('slot_state="$root/runtime/edge/active-slot"', backup)
        self.assertIn('slot_state="$root/runtime/edge/active-slot"', restore)
        self.assertIn("virt-tools-$active_slot", backup)
        self.assertIn("slot_compose_command blue stop api", restore)
        self.assertIn("slot_compose_command green stop api", restore)
        self.assertIn('exec 9>"$deploy_runtime/deploy.lock"', restore)

    def test_enforced_csp_does_not_allow_javascript_eval(self) -> None:
        headers = (ROOT / "nginx" / "security-headers.conf").read_text(encoding="utf-8")
        self.assertNotIn(" 'unsafe-eval'", headers)
        self.assertIn("'wasm-unsafe-eval'", headers)

    def test_service_worker_retains_background_cache_updates(self) -> None:
        worker = (ROOT / "frontend" / "service-worker.js").read_text(encoding="utf-8")
        dockerfile = (ROOT / "nginx" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("event.waitUntil(update", worker)
        self.assertIn("return cache.put(request, clone)", worker)
        for shell_path in (
            "/build/frontend/index.html",
            "/build/frontend/privacy/index.html",
            "/build/frontend/manifest.webmanifest",
            "/build/frontend/favicon.svg",
        ):
            self.assertIn(shell_path, dockerfile)

    def test_zero_downtime_wrapper_probes_home_and_readiness(self) -> None:
        source = (ROOT / "scripts" / "test_zero_downtime_deploy.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('"$deploy" deploy "$@"', source)
        self.assertIn('"$base_url/api/ready"', source)
        self.assertIn('"$base_url/"', source)
        self.assertIn("failures=$((failures + 1))", source)

    def test_runtime_finalizer_removes_only_canonical_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "frontend" / "assets"
            metadata = assets / "tool-meta"
            tools = root / "frontend" / "tools" / "public-tool"
            metadata.mkdir(parents=True)
            tools.mkdir(parents=True)
            (tools / "index.html").write_text("<!doctype html>", encoding="utf-8")
            public = [{"slug": "public-tool"}]
            (assets / "tools.js").write_text(
                "/* generated */\nwindow.VIRTUAL_TOOLS = " + json.dumps(public) + ";\n",
                encoding="utf-8",
            )
            (metadata / "public-tool.json").write_text("{}\n", encoding="utf-8")
            (assets / "tool-catalog.json").write_text("{}\n", encoding="utf-8")
            (assets / "tool-catalog.schema.json").write_text("{}\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "python3",
                    str(ROOT / "scripts" / "prune_deploy_tree.py"),
                    str(root),
                    "--finalize-assets",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((assets / "tool-catalog.json").exists())
            self.assertFalse((assets / "tool-catalog.schema.json").exists())
            self.assertTrue((assets / "tools.js").is_file())
            self.assertTrue((metadata / "public-tool.json").is_file())


if __name__ == "__main__":
    unittest.main()
