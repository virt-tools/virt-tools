#!/usr/bin/env python3
"""Offline admin tool for Virtual Tools feedback.

Run inside the api container so it reads the same SQLite volume:

    docker compose exec api python /app/scripts/manage_feedback.py list
    docker compose exec api python /app/scripts/manage_feedback.py show <uuid>
    docker compose exec api python /app/scripts/manage_feedback.py reply <uuid> --status completed --text "Done!"

This is intentionally a CLI, not a web endpoint — the admin surface is never
exposed to the public internet. Only the developer with host/docker access can
review submissions.
"""
import argparse
import os
import sys

# Allow running both from the repo root (db lives in ../api) and from inside the
# container (db lives in the parent of scripts/). Both candidates are harmless if absent.
_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (os.path.join(_HERE, "..", "api"), os.path.join(_HERE, "..")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import db  # noqa: E402

STATUS = {"received", "completed", "rejected"}


def cmd_list(_args):
    rows = db.list_feedback()
    if not rows:
        print("No feedback yet.")
        return
    print("%-36s  %-10s  %-11s  %s" % ("UUID", "STATUS", "KIND", "MESSAGE"))
    print("-" * 80)
    for r in rows:
        msg = (r["message"] or "").replace("\n", " ")[:40]
        print("%-36s  %-10s  %-11s  %s" % (r["uuid"], r["status"], r["kind"], msg))


def cmd_show(args):
    row = db.get_feedback(args.uuid)
    if not row:
        print("Not found:", args.uuid)
        sys.exit(1)
    for k, v in row.items():
        print("%-12s: %s" % (k, v))


def cmd_reply(args):
    if args.status not in STATUS:
        print("Invalid status. Choose from:", ", ".join(sorted(STATUS)))
        sys.exit(1)
    ok = db.update_feedback(args.uuid, args.status, args.text or "")
    if not ok:
        print("Not found:", args.uuid)
        sys.exit(1)
    print("Updated", args.uuid, "->", args.status)


def main():
    p = argparse.ArgumentParser(description="Manage Virtual Tools feedback.")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List all feedback.").set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="Show one feedback entry.")
    s.add_argument("uuid")
    s.set_defaults(func=cmd_show)

    r = sub.add_parser("reply", help="Set status and/or reply for a feedback entry.")
    r.add_argument("uuid")
    r.add_argument("--status", required=True, choices=sorted(STATUS))
    r.add_argument("--text", default="", help="Reply text shown to the user.")
    r.set_defaults(func=cmd_reply)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()