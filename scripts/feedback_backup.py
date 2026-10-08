#!/usr/bin/env python3
"""WAL-safe, authenticated backup and verified restore for feedback SQLite."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


OPENSSL_MAGIC = b"Salted__"
SQLITE_MAGIC = b"SQLite format 3\x00"
ARCHIVE_MAGIC = b"VT-FEEDBACK-BACKUP\x00"
ARCHIVE_VERSION = 1
ARCHIVE_HEADER = ARCHIVE_MAGIC + bytes((ARCHIVE_VERSION,))
TAG_BYTES = 32
PBKDF2_ITERATIONS = 250_000
MAC_DOMAIN = b"virt-tools-feedback-backup-mac-v1\x00"


def _secure_create(path: Path) -> None:
    """Create an empty owner-only file before any sensitive bytes are written."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)


def _fsync_file(path: Path) -> None:
    with path.open("rb") as stream:
        os.fsync(stream.fileno())


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _passphrase() -> bytes:
    value = os.environ.get("VT_BACKUP_PASSPHRASE", "").encode("utf-8")
    if len(value) < 12:
        raise SystemExit(
            "VT_BACKUP_PASSPHRASE must contain at least 12 bytes for encrypted archives."
        )
    return value


def _integrity_check(path: Path) -> None:
    uri = f"file:{path.resolve()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise SystemExit(f"SQLite integrity check failed: {result!r}")
    finally:
        connection.close()


def _openssl(args: list[str], passphrase: bytes) -> None:
    try:
        subprocess.run(
            ["openssl", "enc", *args, "-pass", "stdin"],
            input=passphrase + b"\n",
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError as exc:
        raise SystemExit("OpenSSL is required for encrypted backups.") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit("OpenSSL encryption/decryption failed.") from exc


def _mac_key(passphrase: bytes, salt: bytes) -> bytes:
    # The domain-prefixed salt is distinct from OpenSSL's encryption KDF input,
    # so encryption and authentication never reuse derived key material.
    return hashlib.pbkdf2_hmac(
        "sha256", passphrase, MAC_DOMAIN + salt, PBKDF2_ITERATIONS, dklen=32
    )


def _sqlite_snapshot(
    source: Path, destination: Path, *, destination_precreated: bool = False
) -> None:
    if not destination_precreated:
        _secure_create(destination)
    source_db = sqlite3.connect(source, timeout=10)
    destination_db = sqlite3.connect(destination)
    try:
        source_db.backup(destination_db)
    finally:
        destination_db.close()
        source_db.close()
    os.chmod(destination, 0o600)
    _integrity_check(destination)
    _fsync_file(destination)
    _fsync_directory(destination.parent)


def _checkpoint_and_remove_sidecars(destination: Path) -> None:
    """Checkpoint the stopped database, then remove stale WAL bookkeeping."""
    connection = sqlite3.connect(destination, timeout=30)
    try:
        result = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if result and int(result[0]) != 0:
            raise SystemExit(f"Could not checkpoint the stopped database: {result!r}")
    finally:
        connection.close()
    for suffix in ("-wal", "-shm"):
        destination.with_name(destination.name + suffix).unlink(missing_ok=True)
    _fsync_directory(destination.parent)


def _write_authenticated_envelope(
    openssl_payload: Path, output: Path, passphrase: bytes
) -> None:
    with openssl_payload.open("rb") as source:
        prefix = source.read(16)
    if len(prefix) != 16 or not prefix.startswith(OPENSSL_MAGIC):
        raise SystemExit("OpenSSL did not produce the expected salted payload.")
    salt = prefix[8:16]
    authenticator = hmac.new(_mac_key(passphrase, salt), digestmod=hashlib.sha256)
    authenticator.update(ARCHIVE_HEADER)
    with output.open("wb") as destination, openssl_payload.open("rb") as source:
        destination.write(ARCHIVE_HEADER)
        while chunk := source.read(1024 * 1024):
            authenticator.update(chunk)
            destination.write(chunk)
        destination.write(authenticator.digest())


def _verify_and_extract_envelope(
    archive: Path, openssl_payload: Path, passphrase: bytes
) -> None:
    size = archive.stat().st_size
    payload_size = size - len(ARCHIVE_HEADER) - TAG_BYTES
    if payload_size < 32:
        raise SystemExit("Encrypted backup envelope is truncated.")

    with archive.open("rb") as source:
        header = source.read(len(ARCHIVE_HEADER))
        if not header.startswith(ARCHIVE_MAGIC):
            raise SystemExit("Unknown backup archive format.")
        if header != ARCHIVE_HEADER:
            raise SystemExit("Unsupported encrypted backup envelope version.")
        prefix = source.read(16)
        if len(prefix) != 16 or not prefix.startswith(OPENSSL_MAGIC):
            raise SystemExit("Encrypted backup payload is malformed.")
        salt = prefix[8:16]
        authenticator = hmac.new(_mac_key(passphrase, salt), digestmod=hashlib.sha256)
        authenticator.update(header)
        authenticator.update(prefix)

        remaining = payload_size - len(prefix)
        with openssl_payload.open("wb") as destination:
            destination.write(prefix)
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise SystemExit("Encrypted backup envelope is truncated.")
                remaining -= len(chunk)
                authenticator.update(chunk)
                destination.write(chunk)
        expected = source.read(TAG_BYTES)
        if len(expected) != TAG_BYTES or source.read(1):
            raise SystemExit("Encrypted backup envelope has an invalid length.")

    if not hmac.compare_digest(authenticator.digest(), expected):
        # A wrong passphrase and a modified archive are intentionally
        # indistinguishable, and decryption is never attempted before this check.
        openssl_payload.unlink(missing_ok=True)
        raise SystemExit("Encrypted backup authentication failed.")


def backup(source: Path, output: Path, encrypt: bool) -> None:
    if not source.is_file():
        raise SystemExit(f"Database does not exist: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="vt-feedback-backup-") as temp_dir:
        snapshot = Path(temp_dir) / "feedback.db"
        # sqlite3_backup captures a consistent snapshot while WAL-mode readers
        # and writers remain active.
        _sqlite_snapshot(source, snapshot)

        temporary_output = output.with_name(output.name + ".partial")
        try:
            temporary_output.unlink(missing_ok=True)
            _secure_create(temporary_output)
            if encrypt:
                passphrase = _passphrase()
                payload = Path(temp_dir) / "encrypted-payload"
                _secure_create(payload)
                _openssl(
                    [
                        "-aes-256-cbc",
                        "-pbkdf2",
                        "-iter",
                        str(PBKDF2_ITERATIONS),
                        "-salt",
                        "-in",
                        str(snapshot),
                        "-out",
                        str(payload),
                    ],
                    passphrase,
                )
                _write_authenticated_envelope(payload, temporary_output, passphrase)
            else:
                shutil.copyfile(snapshot, temporary_output)
            os.chmod(temporary_output, 0o600)
            _fsync_file(temporary_output)
            os.replace(temporary_output, output)
            _fsync_directory(output.parent)
        finally:
            temporary_output.unlink(missing_ok=True)
    print(f"Verified backup written to {output}")


def _rollback_path(destination: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = destination.with_name(f"{destination.name}.pre-restore-{timestamp}.db")
    suffix = 1
    while candidate.exists():
        candidate = destination.with_name(
            f"{destination.name}.pre-restore-{timestamp}-{suffix}.db"
        )
        suffix += 1
    return candidate


def restore(
    archive: Path,
    destination: Path,
    force: bool,
    *,
    allow_plain: bool = False,
) -> Path | None:
    if not force:
        raise SystemExit("Restore requires --force; the destination database will be replaced.")
    from_stdin = str(archive) == "-"
    if not from_stdin and not archive.is_file():
        raise SystemExit(f"Backup does not exist: {archive}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() or (destination.exists() and not destination.is_file()):
        raise SystemExit("Restore destination must be a regular file path.")
    had_destination = destination.is_file()

    rollback: Path | None = None
    with tempfile.TemporaryDirectory(prefix="vt-feedback-restore-") as temp_dir:
        if from_stdin:
            archive = Path(temp_dir) / "archive"
            _secure_create(archive)
            with archive.open("wb") as stream:
                shutil.copyfileobj(sys.stdin.buffer, stream)
            if not archive.stat().st_size:
                raise SystemExit("No backup data was received on standard input.")

        snapshot = Path(temp_dir) / "feedback.db"
        payload = Path(temp_dir) / "encrypted-payload"
        with archive.open("rb") as stream:
            prefix = stream.read(max(len(ARCHIVE_HEADER), len(SQLITE_MAGIC)))

        if prefix.startswith(ARCHIVE_MAGIC):
            passphrase = _passphrase()
            _secure_create(payload)
            _verify_and_extract_envelope(archive, payload, passphrase)
            _secure_create(snapshot)
            _openssl(
                [
                    "-d",
                    "-aes-256-cbc",
                    "-pbkdf2",
                    "-iter",
                    str(PBKDF2_ITERATIONS),
                    "-in",
                    str(payload),
                    "-out",
                    str(snapshot),
                ],
                passphrase,
            )
        elif prefix.startswith(OPENSSL_MAGIC):
            raise SystemExit(
                "Unauthenticated legacy encrypted backups are not accepted; "
                "restore them with a trusted older release, then create a new authenticated backup."
            )
        elif prefix.startswith(SQLITE_MAGIC):
            if not allow_plain:
                raise SystemExit("Plain SQLite restore requires --allow-plain.")
            _secure_create(snapshot)
            shutil.copyfile(archive, snapshot)
        else:
            raise SystemExit("Unknown backup archive format.")

        # Validate and authenticate fully before taking the rollback snapshot or
        # opening the destination for replacement.
        _integrity_check(snapshot)
        if had_destination:
            rollback = _rollback_path(destination)
            _sqlite_snapshot(destination, rollback)
            print(f"Pre-restore rollback snapshot written to {rollback}")

        replacement = destination.with_name(
            f".{destination.name}.restore-{os.getpid()}-{secrets.token_hex(8)}"
        )
        _secure_create(replacement)
        try:
            _sqlite_snapshot(snapshot, replacement, destination_precreated=True)
            _integrity_check(replacement)
            if had_destination:
                _checkpoint_and_remove_sidecars(destination)
            os.replace(replacement, destination)
            _fsync_directory(destination.parent)
        finally:
            replacement.unlink(missing_ok=True)
        _integrity_check(destination)
    print(f"Verified restore completed at {destination}")
    return rollback


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup_parser = subparsers.add_parser("backup")
    backup_parser.add_argument("source", type=Path)
    backup_parser.add_argument("output", type=Path)
    backup_parser.add_argument("--encrypt", action="store_true")

    restore_parser = subparsers.add_parser("restore")
    restore_parser.add_argument("archive", type=Path)
    restore_parser.add_argument("destination", type=Path)
    restore_parser.add_argument("--force", action="store_true")
    restore_parser.add_argument(
        "--allow-plain", action="store_true", help="explicitly permit a raw SQLite archive"
    )

    args = parser.parse_args()
    if args.command == "backup":
        backup(args.source, args.output, args.encrypt)
    else:
        restore(
            args.archive,
            args.destination,
            args.force,
            allow_plain=args.allow_plain,
        )


if __name__ == "__main__":
    main()
