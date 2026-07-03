"""Virtual Tools — feedback API.

A tiny Flask service that accepts anonymous feedback and lets end users look up
the status of their submission by UUID. There is intentionally no public
list/admin endpoint — the developer reviews submissions offline via
scripts/manage_feedback.py so the admin surface is never exposed to the internet.

Endpoints:
    POST /api/feedback            {kind, tool, message}  -> {uuid}
    GET  /api/feedback/<uuid>     -> {uuid, kind, tool, message, status, reply, created_at, updated_at}
    GET  /api/health              -> {ok: true}
"""
import uuid as uuidlib
from datetime import datetime, timezone

from flask import Flask, jsonify, request

import db

app = Flask(__name__)

MAX_MESSAGE = 5000
ALLOWED_KINDS = {"feedback", "suggestion", "bug"}
ALLOWED_STATUS = {"received", "completed", "rejected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.post("/api/feedback")
def submit():
    data = request.get_json(silent=True) or {}
    kind = (data.get("kind") or "feedback").strip()
    tool = (data.get("tool") or "").strip()[:120]
    message = (data.get("message") or "").strip()

    if not message:
        return jsonify(error="Message is required."), 400
    if len(message) > MAX_MESSAGE:
        return jsonify(error="Message is too long (max %d characters)." % MAX_MESSAGE), 400
    if kind not in ALLOWED_KINDS:
        kind = "feedback"

    feedback_id = str(uuidlib.uuid4())
    db.insert_feedback(feedback_id, kind, tool, message, _now())
    return jsonify(uuid=feedback_id), 201


@app.get("/api/feedback/<feedback_id>")
def status(feedback_id: str):
    try:
        uuidlib.UUID(feedback_id)
    except (ValueError, TypeError):
        return jsonify(error="Invalid feedback id."), 400

    row = db.get_feedback(feedback_id)
    if not row:
        return jsonify(error="No feedback found for that id."), 404
    return jsonify(row)


@app.get("/api/health")
def health():
    return jsonify(ok=True)


if __name__ == "__main__":
    # Bound to the container network; nginx proxies public traffic to here.
    app.run(host="0.0.0.0", port=8000)