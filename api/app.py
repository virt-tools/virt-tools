"""Virtual Tools feedback API.

The public surface is deliberately small: anonymous submissions, bearer-style
UUID status lookups, and health probes.  Administrative access remains an
offline CLI so there is no internet-facing management endpoint.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sqlite3
import threading
import time
import uuid as uuidlib
from datetime import datetime, timezone
from typing import Any

from flask import Flask, Response, jsonify, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

import db
from feedback_policy import FEEDBACK_STATUSES


MAX_MESSAGE = 5_000
MAX_TOOL = 120
MAX_BODY_BYTES = 16 * 1024
ALLOWED_KINDS = {"feedback", "suggestion", "bug"}
ALLOWED_FIELDS = {"kind", "tool", "message"}
POST_LIMIT = max(1, int(os.environ.get("VT_FEEDBACK_POST_LIMIT", "10")))
LOOKUP_LIMIT = max(1, int(os.environ.get("VT_FEEDBACK_LOOKUP_LIMIT", "60")))
RATE_WINDOW_SECONDS = max(1, int(os.environ.get("VT_RATE_WINDOW_SECONDS", "60")))
RETENTION_DAYS = max(1, int(os.environ.get("VT_FEEDBACK_RETENTION_DAYS", "365")))
RETENTION_BATCH_SIZE = 500
RETENTION_INTERVAL_SECONDS = 6 * 60 * 60

app = Flask(__name__)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_BODY_BYTES,
    JSON_SORT_KEYS=True,
)

# The API is only reachable through the adjacent nginx service in the supplied
# Compose configurations. nginx replaces (rather than appends to) the forwarded
# address headers, so trusting exactly one hop cannot be influenced by a client.
if os.environ.get("VT_TRUST_PROXY", "1") == "1":
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

db.initialize()


def _load_rate_secret() -> bytes:
    """Load an orchestrator secret or atomically derive one in shared storage."""
    secret_file = os.environ.get("VT_RATE_LIMIT_SECRET_FILE", "")
    if secret_file:
        with open(secret_file, "rb") as stream:
            value = stream.read().strip()
        if len(value) < 32:
            raise RuntimeError("VT_RATE_LIMIT_SECRET_FILE must contain at least 32 bytes")
        return value
    configured = os.environ.get("VT_RATE_LIMIT_SECRET", "")
    if configured:
        if len(configured) < 32:
            raise RuntimeError("VT_RATE_LIMIT_SECRET must contain at least 32 characters")
        return configured.encode("utf-8")
    return db.get_or_create_rate_limit_secret()


_rate_secret = _load_rate_secret()
_retention_lock = threading.Lock()
_next_retention_cleanup = 0.0


def _run_retention_cleanup(*, force: bool = False) -> None:
    global _next_retention_cleanup
    now = time.monotonic()
    if not force and now < _next_retention_cleanup:
        return
    if not _retention_lock.acquire(blocking=False):
        return
    try:
        now = time.monotonic()
        if not force and now < _next_retention_cleanup:
            return
        removed = db.cleanup_expired_feedback(
            RETENTION_DAYS, batch_size=RETENTION_BATCH_SIZE
        )
        _next_retention_cleanup = now + RETENTION_INTERVAL_SECONDS
        if removed:
            app.logger.info("Expired %d feedback records under retention policy", removed)
    except sqlite3.Error:
        # Cleanup is bounded housekeeping. A transient lock must not take the
        # feedback endpoint down; readiness independently reports DB failures.
        _next_retention_cleanup = now + 60
        app.logger.warning("Feedback retention cleanup was deferred", exc_info=True)
    finally:
        _retention_lock.release()


_run_retention_cleanup(force=True)


class InvalidJSON(ValueError):
    """Raised when a request is not strict, interoperable JSON."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pairs_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidJSON(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def _reject_nonstandard_number(value: str) -> None:
    raise InvalidJSON(f"Non-standard JSON number: {value}")


def _strict_json_object() -> dict[str, Any]:
    if not request.is_json:
        raise InvalidJSON("Content-Type must be application/json.")
    raw = request.get_data(cache=False)
    if not raw:
        raise InvalidJSON("A JSON object is required.")
    try:
        data = json.loads(
            raw,
            object_pairs_hook=_pairs_without_duplicates,
            parse_constant=_reject_nonstandard_number,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidJSON("Malformed JSON.") from exc
    if not isinstance(data, dict):
        raise InvalidJSON("The JSON body must be an object.")
    unknown = sorted(set(data) - ALLOWED_FIELDS)
    if unknown:
        raise InvalidJSON("Unknown field(s): " + ", ".join(unknown))
    return data


def _clean_text(data: dict[str, Any], field: str, *, default: str | None = None) -> str:
    if field not in data:
        if default is not None:
            return default
        raise InvalidJSON(f"{field.capitalize()} is required.")
    value = data[field]
    if not isinstance(value, str):
        raise InvalidJSON(f"{field.capitalize()} must be a string.")
    value = value.strip()
    if any(ord(char) < 32 and char not in "\n\r\t" for char in value):
        raise InvalidJSON(f"{field.capitalize()} contains unsupported control characters.")
    return value


def _rate_identity() -> str:
    address = request.remote_addr or "unknown"
    return hmac.new(_rate_secret, address.encode("utf-8"), hashlib.sha256).hexdigest()


def _enforce_rate_limit(scope: str, limit: int) -> Response | None:
    allowed, retry_after = db.consume_rate_limit(
        _rate_identity(), scope, limit, RATE_WINDOW_SECONDS, int(time.time())
    )
    if allowed:
        return None
    response = jsonify(error="Too many requests. Please try again later.")
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


@app.after_request
def api_response_headers(response: Response) -> Response:
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


@app.before_request
def periodic_retention_cleanup() -> None:
    # Liveness is deliberately process-only, and readiness has its own bounded
    # database transaction. Retention housekeeping belongs only to feedback
    # traffic so health probes cannot inherit a locked-database delay.
    if request.path == "/api/feedback" or request.path.startswith("/api/feedback/"):
        _run_retention_cleanup()


@app.post("/api/feedback")
def submit() -> tuple[Response, int] | Response:
    limited = _enforce_rate_limit("submit", POST_LIMIT)
    if limited is not None:
        return limited

    try:
        data = _strict_json_object()
        kind = _clean_text(data, "kind", default="feedback")
        tool = _clean_text(data, "tool", default="")
        message = _clean_text(data, "message")
    except InvalidJSON as exc:
        return jsonify(error=str(exc)), 400

    if kind not in ALLOWED_KINDS:
        return jsonify(error="Kind must be feedback, suggestion, or bug."), 400
    if len(tool) > MAX_TOOL:
        return jsonify(error=f"Tool is too long (max {MAX_TOOL} characters)."), 400
    if not message:
        return jsonify(error="Message is required."), 400
    if len(message) > MAX_MESSAGE:
        return jsonify(error=f"Message is too long (max {MAX_MESSAGE} characters)."), 400

    feedback_id = str(uuidlib.uuid4())
    db.insert_feedback(feedback_id, kind, tool, message, _now())
    return jsonify(uuid=feedback_id), 201


@app.get("/api/feedback/<feedback_id>")
def status(feedback_id: str) -> tuple[Response, int] | Response:
    limited = _enforce_rate_limit("lookup", LOOKUP_LIMIT)
    if limited is not None:
        return limited

    try:
        parsed = uuidlib.UUID(feedback_id)
        if parsed.version != 4 or str(parsed) != feedback_id.lower():
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        return jsonify(error="Invalid feedback id."), 400

    row = db.get_feedback(feedback_id.lower())
    if not row:
        return jsonify(error="No feedback found for that id."), 404
    if row.get("status") not in FEEDBACK_STATUSES:
        app.logger.error("Feedback record has an unsupported lifecycle status")
        return jsonify(error="Feedback status is temporarily unavailable."), 503
    return jsonify(row)


@app.get("/api/live")
def liveness() -> Response:
    return jsonify(ok=True, check="liveness")


@app.get("/api/ready")
def readiness() -> tuple[Response, int] | Response:
    try:
        db.check_ready()
    except sqlite3.Error:
        app.logger.exception("Feedback database readiness check failed")
        return jsonify(ok=False, check="readiness"), 503
    return jsonify(ok=True, check="readiness")


@app.get("/api/health")
def health() -> tuple[Response, int] | Response:
    """Backward-compatible, database-aware health endpoint."""
    return readiness()


@app.errorhandler(HTTPException)
def http_error(exc: HTTPException) -> tuple[Response, int]:
    if request.path.startswith("/api/"):
        return jsonify(error=exc.description), exc.code or 500
    return exc


@app.errorhandler(sqlite3.Error)
def database_error(exc: sqlite3.Error) -> tuple[Response, int]:
    app.logger.exception("Feedback database operation failed", exc_info=exc)
    return jsonify(error="Feedback storage is temporarily unavailable."), 503


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # Development convenience only. Containers invoke Gunicorn instead.
    app.run(host="127.0.0.1", port=8000)
