#!/usr/bin/env python3
"""Sprint 0 — backup UPLOAD_DIR to UPLOAD_BACKUP_DIR (timestamped copy).

Usage:
  python scripts/backup_uploads.py
  UPLOAD_DIR=... UPLOAD_BACKUP_DIR=... python scripts/backup_uploads.py
"""
from __future__ import annotations

import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UPLOAD = ROOT / "uploads"
DEFAULT_BACKUP = ROOT / "uploads_backup"


def main() -> int:
    src = Path(os.environ.get("UPLOAD_DIR") or DEFAULT_UPLOAD)
    backup_root = Path(os.environ.get("UPLOAD_BACKUP_DIR") or DEFAULT_BACKUP)
    if not src.exists():
        print(f"UPLOAD_DIR missing: {src}", file=sys.stderr)
        return 1
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = backup_root / f"uploads-{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest, dirs_exist_ok=True)
    print(f"Backed up {src} → {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
