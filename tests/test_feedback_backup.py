from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from feedback_backup import ARCHIVE_HEADER, backup, restore  # noqa: E402


def make_database(path: Path, value: str) -> None:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE feedback (message TEXT NOT NULL)")
    connection.execute("INSERT INTO feedback VALUES (?)", (value,))
    connection.commit()
    connection.close()


def read_database(path: Path) -> str:
    connection = sqlite3.connect(path)
    try:
        return connection.execute("SELECT message FROM feedback").fetchone()[0]
    finally:
        connection.close()


class FeedbackBackupTest(unittest.TestCase):
    PASSPHRASE = "correct horse battery staple"

    def setUp(self) -> None:
        self.old_passphrase = os.environ.get("VT_BACKUP_PASSPHRASE")

    def tearDown(self) -> None:
        if self.old_passphrase is None:
            os.environ.pop("VT_BACKUP_PASSPHRASE", None)
        else:
            os.environ["VT_BACKUP_PASSPHRASE"] = self.old_passphrase

    def test_plain_restore_requires_explicit_permission(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, restored = root / "source.db", root / "archive.db", root / "restored.db"
            make_database(source, "preserved")
            backup(source, archive, encrypt=False)
            with self.assertRaisesRegex(SystemExit, "--allow-plain"):
                restore(archive, restored, force=True)
            restore(archive, restored, force=True, allow_plain=True)
            self.assertEqual(read_database(restored), "preserved")
            self.assertEqual(archive.stat().st_mode & 0o777, 0o600)

    def test_authenticated_encrypted_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, restored = root / "source.db", root / "archive.enc", root / "restored.db"
            make_database(source, "encrypted")
            os.environ["VT_BACKUP_PASSPHRASE"] = self.PASSPHRASE
            backup(source, archive, encrypt=True)
            self.assertTrue(archive.read_bytes().startswith(ARCHIVE_HEADER))
            self.assertNotIn(b"encrypted", archive.read_bytes())
            restore(archive, restored, force=True)
            self.assertEqual(read_database(restored), "encrypted")

    def test_tamper_is_rejected_before_decryption(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, restored = root / "source.db", root / "archive.enc", root / "restored.db"
            make_database(source, "tamper-test")
            os.environ["VT_BACKUP_PASSPHRASE"] = self.PASSPHRASE
            backup(source, archive, encrypt=True)
            contents = bytearray(archive.read_bytes())
            contents[len(ARCHIVE_HEADER) + 24] ^= 0x01
            archive.write_bytes(contents)
            with self.assertRaisesRegex(SystemExit, "authentication failed"):
                restore(archive, restored, force=True)
            self.assertFalse(restored.exists())

    def test_authentication_failure_leaves_existing_destination_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, destination = root / "source.db", root / "archive.enc", root / "live.db"
            make_database(source, "candidate")
            make_database(destination, "original")
            before = destination.read_bytes()
            os.environ["VT_BACKUP_PASSPHRASE"] = self.PASSPHRASE
            backup(source, archive, encrypt=True)
            contents = bytearray(archive.read_bytes())
            contents[-1] ^= 0x01
            archive.write_bytes(contents)
            with self.assertRaisesRegex(SystemExit, "authentication failed"):
                restore(archive, destination, force=True)
            self.assertEqual(destination.read_bytes(), before)
            self.assertEqual(read_database(destination), "original")
            self.assertFalse(list(root.glob("live.db.pre-restore-*.db")))

    def test_wrong_passphrase_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, restored = root / "source.db", root / "archive.enc", root / "restored.db"
            make_database(source, "wrong-passphrase-test")
            os.environ["VT_BACKUP_PASSPHRASE"] = self.PASSPHRASE
            backup(source, archive, encrypt=True)
            os.environ["VT_BACKUP_PASSPHRASE"] = "a completely different passphrase"
            with self.assertRaisesRegex(SystemExit, "authentication failed"):
                restore(archive, restored, force=True)
            self.assertFalse(restored.exists())

    def test_existing_destination_gets_pre_restore_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, destination = root / "source.db", root / "archive.db", root / "live.db"
            make_database(source, "new")
            make_database(destination, "old")
            backup(source, archive, encrypt=False)
            rollback = restore(archive, destination, force=True, allow_plain=True)
            self.assertIsNotNone(rollback)
            self.assertEqual(read_database(destination), "new")
            self.assertEqual(read_database(rollback), "old")
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertEqual(rollback.stat().st_mode & 0o777, 0o600)

    def test_restore_replaces_wal_database_and_clears_stale_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, archive, destination = root / "source.db", root / "archive.db", root / "live.db"
            make_database(source, "replacement")
            live = sqlite3.connect(destination)
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("PRAGMA wal_autocheckpoint=0")
            live.execute("CREATE TABLE feedback (message TEXT NOT NULL)")
            live.execute("INSERT INTO feedback VALUES ('wal-original')")
            live.commit()
            self.assertTrue(Path(str(destination) + "-wal").exists())
            backup(source, archive, encrypt=False)
            try:
                rollback = restore(archive, destination, force=True, allow_plain=True)
            finally:
                live.close()
            self.assertEqual(read_database(destination), "replacement")
            self.assertEqual(read_database(rollback), "wal-original")
            self.assertFalse(Path(str(destination) + "-wal").exists())
            self.assertFalse(Path(str(destination) + "-shm").exists())


if __name__ == "__main__":
    unittest.main()
