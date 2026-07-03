"""SQLite storage for the Virtual Tools feedback service.

A single table holds anonymous feedback submissions. The solo developer reviews
them offline via scripts/manage_feedback.py (setting status + reply); end users
look up their own submission by UUID through the read-only API.
"""
import os
import sqlite3

DB_PATH = os.environ.get("VT_FEEDBACK_DB", "/data/feedback.db")

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
"""


def connect() -> sqlite3.Connection:
    """Open a connection, ensuring the schema and data directory exist."""
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.executescript(SCHEMA)
    return conn


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
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_feedback(uuid: str, status: str, reply: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute(
            "UPDATE feedback SET status = ?, reply = ?, updated_at = ? WHERE uuid = ?",
            (status, reply, _now(), uuid),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()