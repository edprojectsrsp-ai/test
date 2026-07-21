"""DPR-2 — teach-the-AI mapping: learned column + activity maps, cell provenance.

Two things the user can correct, and the system remembers:

  1. COLUMN mapping — "the day-actual value should come from column M, not L".
     Stored per DPR format (template-global) with an optional per-scheme
     override. Applied when reading each activity's fields so the extracted
     value, and the CELL it names, both move to the taught column.

  2. ACTIVITY mapping — "this DPR row is really activity #123". Stored per
     scheme keyed by the normalised row label, so the next upload auto-matches
     what you corrected instead of re-guessing.

Cell provenance: with the parser's _srcRow + _colMap, each value carries the
exact source cell (e.g. "M14"). If the AI took the wrong column, the UI shows
which cell it read and the user re-points it; the correction is saved as a
column map and reused.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from sqlalchemy import text


def _col_letter(idx0: int) -> str:
    """0-based column index → Excel letter (0→A, 12→M)."""
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


# ───────────────────────────── column maps

def load_column_map(db, dpr_format: str, scheme_id: Optional[int]) -> dict[str, int]:
    """Effective field→col_index overrides: template-global first, per-scheme on top."""
    rows = db.execute(text(
        "SELECT field, col_index, scheme_id FROM dpr_column_maps "
        "WHERE dpr_format = :f AND (scheme_id IS NULL OR scheme_id = :s) "
        "ORDER BY scheme_id NULLS FIRST"),
        {"f": dpr_format, "s": scheme_id}).mappings().all()
    out: dict[str, int] = {}
    for r in rows:               # per-scheme rows come last → win
        out[r["field"]] = r["col_index"]
    return out


def apply_column_overrides(activities: list[dict], overrides: dict[str, int],
                           raw_rows: Optional[list[list]] = None) -> None:
    """Re-read overridden fields from the taught column and update _colMap so
    provenance reflects the correction. raw_rows (0-based grid) lets us pull the
    new value; without it we only relabel the cell reference."""
    from app.services.dpr_ingest import _f, _cell
    for a in activities:
        colmap = a.get("_colMap") or {}
        for field, new_col in overrides.items():
            colmap[field] = new_col
            src_row = a.get("_srcRow")
            if raw_rows and src_row and 1 <= src_row <= len(raw_rows):
                a[field] = _f(_cell(raw_rows[src_row - 1], new_col))
        a["_colMap"] = colmap


def provenance(activity: dict) -> dict[str, Optional[str]]:
    """field → 'M14' style cell reference for every mapped field."""
    colmap = activity.get("_colMap") or {}
    src = activity.get("_srcRow")
    return {field: cell_ref(ci, src) for field, ci in colmap.items()}


def save_column_map(db, dpr_format: str, scheme_id: Optional[int],
                    field: str, col_index: int, by: Optional[str] = None) -> None:
    db.execute(text("""
        INSERT INTO dpr_column_maps (dpr_format, scheme_id, field, col_index, updated_by)
        VALUES (:f, :s, :fld, :ci, :by)
        ON CONFLICT (dpr_format, scheme_id, field)
        DO UPDATE SET col_index = EXCLUDED.col_index, updated_by = EXCLUDED.updated_by,
                      updated_at = now()
    """), {"f": dpr_format, "s": scheme_id, "fld": field, "ci": col_index, "by": by})
    db.commit()


# ───────────────────────────── activity maps

def load_activity_map(db, scheme_id: int) -> dict[str, int]:
    rows = db.execute(text(
        "SELECT row_label, activity_id FROM dpr_activity_maps WHERE scheme_id = :s"),
        {"s": scheme_id}).mappings().all()
    return {r["row_label"]: r["activity_id"] for r in rows}


def save_activity_map(db, scheme_id: int, row_label: str,
                      activity_id: int, by: Optional[str] = None) -> None:
    db.execute(text("""
        INSERT INTO dpr_activity_maps (scheme_id, row_label, activity_id, updated_by)
        VALUES (:s, :lbl, :aid, :by)
        ON CONFLICT (scheme_id, row_label)
        DO UPDATE SET activity_id = EXCLUDED.activity_id, updated_by = EXCLUDED.updated_by,
                      updated_at = now()
    """), {"s": scheme_id, "lbl": norm_label(row_label), "aid": activity_id, "by": by})
    db.commit()


def apply_activity_overrides(db, scheme_id: int, groups: list[dict],
                             matches: list[dict]) -> list[dict]:
    """Where a learned mapping exists for a row's label, force that match with
    confidence 'learned' — overriding the fuzzy matcher."""
    learned = load_activity_map(db, scheme_id)
    for g, m in zip(groups, matches):
        lbl = norm_label(g.get("activity") or g.get("workType"))
        if lbl in learned:
            m["matchedActivityId"] = learned[lbl]
            m["confidence"] = "learned"
            m["learned"] = True
    return matches
