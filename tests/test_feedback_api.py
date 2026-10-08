from __future__ import annotations

import importlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "api"
sys.path.insert(0, str(API))


class FeedbackAPITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        os.environ["VT_FEEDBACK_DB"] = str(Path(cls.temp.name) / "feedback.db")
        os.environ["VT_FEEDBACK_POST_LIMIT"] = "10"
        os.environ["VT_FEEDBACK_LOOKUP_LIMIT"] = "60"
        global db, api
        db = importlib.import_module("db")
        api = importlib.import_module("app")
        api.app.config.update(TESTING=True)
        cls.client = api.app.test_client()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def post(
        self,
        body: bytes | str,
        content_type: str = "application/json",
        ip: str = "192.0.2.1",
    ):
        return self.client.post(
            "/api/feedback",
            data=body,
            content_type=content_type,
            environ_base={"REMOTE_ADDR": ip},
        )

    def test_submit_and_bearer_lookup(self) -> None:
        response = self.post(
            json.dumps(
                {"kind": "bug", "tool": "unit-converter", "message": "A useful report"}
            ),
            ip="192.0.2.10",
        )
        self.assertEqual(response.status_code, 201)
        feedback_id = response.get_json()["uuid"]
        lookup = self.client.get(
            f"/api/feedback/{feedback_id}",
            environ_base={"REMOTE_ADDR": "192.0.2.10"},
        )
        self.assertEqual(lookup.status_code, 200)
        self.assertEqual(lookup.get_json()["message"], "A useful report")
        self.assertEqual(lookup.headers["Cache-Control"], "no-store")

    def test_strict_schema_rejects_ambiguous_or_wrong_types(self) -> None:
        cases = (
            (b"[]", "body must be an object"),
            (b'{"message":"ok","extra":true}', "Unknown field"),
            (b'{"message":7}', "Message must be a string"),
            (b'{"message":"first","message":"second"}', "Duplicate JSON field"),
            (b'{"message":"ok","kind":"other"}', "Kind must be"),
            (b'{"message":NaN}', "Non-standard JSON number"),
        )
        for index, (body, expected) in enumerate(cases):
            with self.subTest(body=body):
                response = self.post(body, ip=f"192.0.2.{30 + index}")
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, response.get_json()["error"])

    def test_content_type_empty_and_limits(self) -> None:
        wrong_type = self.post("{}", "text/plain", "192.0.2.50")
        self.assertEqual(wrong_type.status_code, 400)
        self.assertIn("Content-Type", wrong_type.get_json()["error"])

        empty = self.post('{"message":"   "}', ip="192.0.2.51")
        self.assertEqual(empty.status_code, 400)
        self.assertIn("required", empty.get_json()["error"])

        long_tool = self.post(
            json.dumps({"message": "ok", "tool": "x" * (api.MAX_TOOL + 1)}),
            ip="192.0.2.52",
        )
        self.assertEqual(long_tool.status_code, 400)

        oversized = self.post(
            json.dumps({"message": "x" * (api.MAX_BODY_BYTES + 1)}),
            ip="192.0.2.53",
        )
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(oversized.content_type, "application/json")

    def test_rate_limit_uses_pseudonymous_storage(self) -> None:
        old_limit = api.POST_LIMIT
        api.POST_LIMIT = 2
        try:
            for expected in (201, 201, 429):
                response = self.post('{"message":"rate"}', ip="198.51.100.77")
                self.assertEqual(response.status_code, expected)
            self.assertIn("Retry-After", response.headers)
        finally:
            api.POST_LIMIT = old_limit

        connection = sqlite3.connect(db.DB_PATH)
        try:
            identities = [row[0] for row in connection.execute("SELECT identity FROM rate_limit")]
        finally:
            connection.close()
        self.assertTrue(identities)
        self.assertNotIn("198.51.100.77", identities)
        self.assertTrue(all(len(value) == 64 for value in identities))

    def test_rate_limit_secret_is_persistent_and_shared(self) -> None:
        first = db.get_or_create_rate_limit_secret()
        second = db.get_or_create_rate_limit_secret()
        self.assertEqual(first, second)
        self.assertEqual(first, api._rate_secret)
        self.assertEqual(len(first), 32)

    def test_retention_cleanup_is_bounded_and_preserves_recent_feedback(self) -> None:
        old_time = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
        recent_time = datetime.now(timezone.utc).isoformat()
        db.insert_feedback("00000000-0000-4000-8000-000000000001", "feedback", "", "old-1", old_time)
        db.insert_feedback("00000000-0000-4000-8000-000000000002", "feedback", "", "old-2", old_time)
        db.insert_feedback("00000000-0000-4000-8000-000000000003", "feedback", "", "recent", recent_time)
        self.assertEqual(db.cleanup_expired_feedback(365, batch_size=1), 1)
        self.assertEqual(db.cleanup_expired_feedback(365, batch_size=500), 1)
        self.assertIsNotNone(db.get_feedback("00000000-0000-4000-8000-000000000003"))

    def test_health_contracts_and_api_errors(self) -> None:
        with mock.patch.object(api, "_run_retention_cleanup") as cleanup:
            self.assertEqual(self.client.get("/api/live").status_code, 200)
            ready = self.client.get("/api/ready")
            cleanup.assert_not_called()
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.get_json()["check"], "readiness")
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        missing = self.client.get("/api/not-a-route")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.content_type, "application/json")

    def test_feedback_lifecycle_includes_legacy_terminal_values(self) -> None:
        policy = importlib.import_module("feedback_policy")
        expected = {
            "received", "reviewing", "planned", "resolved", "closed", "completed", "rejected"
        }
        self.assertEqual(set(policy.FEEDBACK_STATUSES), expected)
        source = (ROOT / "frontend" / "feedback" / "index.html").read_text(encoding="utf-8")
        for status in expected:
            self.assertIn(f'"{status}"', source)
        feedback_id = "00000000-0000-4000-8000-000000000004"
        db.insert_feedback(
            feedback_id,
            "feedback",
            "",
            "lifecycle",
            datetime.now(timezone.utc).isoformat(),
        )
        for status in policy.FEEDBACK_STATUSES:
            self.assertTrue(db.update_feedback(feedback_id, status, ""))
            self.assertEqual(db.get_feedback(feedback_id)["status"], status)
        with self.assertRaises(ValueError):
            db.update_feedback(feedback_id, "unknown", "")

    def test_uuid_format_is_canonical_v4(self) -> None:
        for value in (
            "not-a-uuid",
            "00000000-0000-0000-0000-000000000000",
            "{00000000-0000-4000-8000-000000000000}",
        ):
            response = self.client.get(
                f"/api/feedback/{value}",
                environ_base={"REMOTE_ADDR": "203.0.113.8"},
            )
            self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
