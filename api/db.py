"""SQLite storage for the Virtual Tools feedback service."""

from __future__ import annotations

import os
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone

from feedback_policy import FEEDBACK_STATUSES


DB_PATH = os.environ.get("VT_FEEDBACK_DB", "/data/feedback.db")
BUSY_TIMEOUT_MS = max(1_000, int(os.environ.get("VT_SQLITE_BUSY_TIMEOUT_MS", "10000")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback (
    uuid        TEXT PRIMARY KEY,
    kind        TEXT,
    tool        TEXT,
    message     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'received',
    reply       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS rate_limit (
    identity       TEXT NOT NULL,
    scope          TEXT NOT NULL,
    window_start   INTEGER NOT NULL,
    request_count  INTEGER NOT NULL,
    PRIMARY KEY (identity, scope, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_window_idx ON rate_limit(window_start);
CREATE TABLE IF NOT EXISTS service_metadata (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback(created_at);
"""


def connect() -> sqlite3.Connection:
    """Open a configured connection without mutating the schema."""
    conn = sqlite3.connect(DB_PATH, timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def initialize() -> None:
    """Create storage once at process startup and enable WAL safely."""
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def insert_feedback(uuid: str, kind: str, tool: str, message: str, created_at: str) -> None:
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO feedback (uuid, kind, tool, message, status, created_at) "
            "VALUES (?, ?, ?, ?, 'received', ?)",
            (uuid, kind, tool, message, created_at),
        )
        conn.commit()
    finally:
        conn.close()


def get_feedback(uuid: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM feedback WHERE uuid = ?", (uuid,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_feedback() -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute("SELECT * FROM feedback ORDER BY created_at DESC").fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def update_feedback(uuid: str, status: str, reply: str) -> bool:
    if status not in FEEDBACK_STATUSES:
        raise ValueError(f"Unsupported feedback status: {status}")
    conn = connect()
    try:
        cursor = conn.execute(
            "UPDATE feedback SET status = ?, reply = ?, updated_at = ? WHERE uuid = ?",
            (status, reply, _now(), uuid),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def consume_rate_limit(
    identity: str,
    scope: str,
    limit: int,
    window_seconds: int,
    now: int | None = None,
) -> tuple[bool, int]:
    """Atomically count a pseudonymous client token in a fixed time window."""
    current = int(time.time()) if now is None else now
    window_start = current - (current % window_seconds)
    retry_after = max(1, window_start + window_seconds - current)
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT request_count FROM rate_limit "
            "WHERE identity = ? AND scope = ? AND window_start = ?",
            (identity, scope, window_start),
        ).fetchone()
        count = int(row[0]) + 1 if row else 1
        if row:
            conn.execute(
                "UPDATE rate_limit SET request_count = ? "
                "WHERE identity = ? AND scope = ? AND window_start = ?",
                (count, identity, scope, window_start),
            )
        else:
            conn.execute(
                "INSERT INTO rate_limit(identity, scope, window_start, request_count) "
                "VALUES (?, ?, ?, ?)",
                (identity, scope, window_start, count),
            )
        # Retain at most one hour of opaque counters. No IP address is stored.
        conn.execute("DELETE FROM rate_limit WHERE window_start <= ?", (window_start - 3600,))
        conn.commit()
        return count <= limit, retry_after
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_or_create_rate_limit_secret() -> bytes:
    """Return one persistent secret shared by every worker using this database."""
    candidate = secrets.token_hex(32)
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "INSERT OR IGNORE INTO service_metadata(key, value) VALUES (?, ?)",
            ("rate_limit_hmac_secret_v1", candidate),
        )
        row = conn.execute(
            "SELECT value FROM service_metadata WHERE key = ?",
            ("rate_limit_hmac_secret_v1",),
        ).fetchone()
        conn.commit()
        if not row or len(row[0]) != 64:
            raise sqlite3.DatabaseError("Stored rate-limit secret is invalid")
        return bytes.fromhex(row[0])
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def cleanup_expired_feedback(
    retention_days: int,
    *,
    batch_size: int = 500,
    now: datetime | None = None,
) -> int:
    """Delete at most one bounded batch older than the retention cutoff."""
    if retention_days < 1:
        raise ValueError("retention_days must be positive")
    if not 1 <= batch_size <= 5_000:
        raise ValueError("batch_size must be between 1 and 5000")
    current = now or datetime.now(timezone.utc)
    cutoff = (current - timedelta(days=retention_days)).isoformat()
    conn = connect()
    try:
        cursor = conn.execute(
            "DELETE FROM feedback WHERE uuid IN ("
            "SELECT uuid FROM feedback WHERE created_at < ? "
            "ORDER BY created_at LIMIT ?)",
            (cutoff, batch_size),
        )
        conn.commit()
        return max(0, cursor.rowcount)
    finally:
        conn.close()


def check_ready() -> None:
    """Verify that the database can be read and acquire a write transaction."""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("SELECT 1 FROM feedback LIMIT 1").fetchone()
        conn.rollback()
    finally:
        conn.close()


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
