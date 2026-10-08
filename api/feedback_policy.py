"""Canonical feedback lifecycle shared by API storage and the admin CLI."""

FEEDBACK_STATUSES = (
    "received",
    "reviewing",
    "planned",
    "resolved",
    "closed",
    # Backward-compatible terminal values used before the expanded lifecycle.
    "completed",
    "rejected",
)

TERMINAL_STATUSES = frozenset({"resolved", "closed", "completed", "rejected"})
