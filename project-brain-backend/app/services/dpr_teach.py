"""DPR teach-the-AI mapping helpers.

This stores two kinds of learned corrections:

1. Column mappings: "dayActual should come from column M, not L".
2. Activity mappings: "this DPR row should map to activity 123".

The read path must remain resilient even when the backing tables have not been
migrated yet, so upload/parse still works before the teaching feature is fully
deployed in the database.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError


def _col_letter(idx0: int) -> str:
    """Convert a zero-based column index to an Excel column label."""
    s, i = "", idx0 + 1
    while i > 0:
        i, m = divmod(i - 1, 26)
        s = chr(65 + m) + s
    return s


def cell_ref(col_index: Optional[int], src_row: Optional[int]) -> Optional[str]:
    if col_index is None or src_row is None:
        return None
    return f"{_col_letter(col_index)}{src_row}"


def norm_label(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _missing_table(exc: ProgrammingError, table: str) -> bool:
    return table in str(exc)


def load_column_map(db, dpr_format: str, scheme_id: Optional[int]) -> dict[str, int]:
    """Load effective field-to-column overrides for a DPR format."""
    try:
        rows = db.execute(
            text(
                "SELECT field, col_index, scheme_id FROM dpr_column_maps "
                "WHERE dpr_format = :f AND (scheme_id IS NULL OR scheme_id = :s) "
                "ORDER BY scheme_id NULLS FIRST"
            ),
            {"f": dpr_format, "s": scheme_id},
        ).mappings().all()
    except ProgrammingError as exc:
        db.rollback()
        if not _missing_table(exc, "dpr_column_maps"):
            raise
        return {}

    out: dict[str, int] = {}
    for row in rows:
        out[row["field"]] = row["col_index"]
    return out


def apply_column_overrides(
    activities: list[dict], overrides: dict[str, int], raw_rows: Optional[list[list]] = None
) -> None:
    """Apply taught source columns and keep provenance in sync."""
    from app.services.dpr_ingest import _cell, _f

    for activity in activities:
        colmap = activity.get("_colMap") or {}
        for field, new_col in overrides.items():
            colmap[field] = new_col
            src_row = activity.get("_srcRow")
            if raw_rows and src_row and 1 <= src_row <= len(raw_rows):
                activity[field] = _f(_cell(raw_rows[src_row - 1], new_col))
        activity["_colMap"] = colmap


def provenance(activity: dict) -> dict[str, Optional[str]]:
    """Return field-to-cell references like M14 for mapped fields."""
    colmap = activity.get("_colMap") or {}
    src_row = activity.get("_srcRow")
    return {field: cell_ref(col_index, src_row) for field, col_index in colmap.items()}


def save_column_map(
    db, dpr_format: str, scheme_id: Optional[int], field: str, col_index: int, by: Optional[str] = None
) -> None:
    try:
        db.execute(
            text(
                """
                INSERT INTO dpr_column_maps (dpr_format, scheme_id, field, col_index, updated_by)
                VALUES (:f, :s, :fld, :ci, :by)
                ON CONFLICT (dpr_format, scheme_id, field)
                DO UPDATE SET col_index = EXCLUDED.col_index, updated_by = EXCLUDED.updated_by,
                              updated_at = now()
                """
            ),
            {"f": dpr_format, "s": scheme_id, "fld": field, "ci": col_index, "by": by},
        )
        db.commit()
    except ProgrammingError as exc:
        db.rollback()
        if not _missing_table(exc, "dpr_column_maps"):
            raise


def load_activity_map(db, scheme_id: int) -> dict[str, int]:
    try:
        rows = db.execute(
            text("SELECT row_label, activity_id FROM dpr_activity_maps WHERE scheme_id = :s"),
            {"s": scheme_id},
        ).mappings().all()
    except ProgrammingError as exc:
        db.rollback()
        if not _missing_table(exc, "dpr_activity_maps"):
            raise
        return {}
    return {row["row_label"]: row["activity_id"] for row in rows}


def save_activity_map(db, scheme_id: int, row_label: str, activity_id: int, by: Optional[str] = None) -> None:
    try:
        db.execute(
            text(
                """
                INSERT INTO dpr_activity_maps (scheme_id, row_label, activity_id, updated_by)
                VALUES (:s, :lbl, :aid, :by)
                ON CONFLICT (scheme_id, row_label)
                DO UPDATE SET activity_id = EXCLUDED.activity_id, updated_by = EXCLUDED.updated_by,
                              updated_at = now()
                """
            ),
            {"s": scheme_id, "lbl": norm_label(row_label), "aid": activity_id, "by": by},
        )
        db.commit()
    except ProgrammingError as exc:
        db.rollback()
        if not _missing_table(exc, "dpr_activity_maps"):
            raise


def apply_activity_overrides(db, scheme_id: int, groups: list[dict], matches: list[dict]) -> list[dict]:
    """Force a learned mapping when one exists for the DPR row label."""
    learned = load_activity_map(db, scheme_id)
    for group, match in zip(groups, matches):
        label = norm_label(group.get("activity") or group.get("workType"))
        if label in learned:
            match["matchedActivityId"] = learned[label]
            match["confidence"] = 100.0
            match["learned"] = True
    return matches
