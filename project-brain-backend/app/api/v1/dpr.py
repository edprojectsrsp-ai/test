"""DPR API — both legacy single-entry and Sprint 14a multi-entry endpoints.

Old endpoints (kept untouched):
    GET  /dpr/{scheme_id}           — last 30 days, one per date
    POST /dpr/{scheme_id}           — upsert today's DPR

New v2 endpoints (Sprint 14a):
    GET  /dpr/v2/{scheme_id}              — list entries (last 30 days, with photos)
    POST /dpr/v2/{scheme_id}              — multipart create (fields + photo files)
    GET  /dpr/v2/{scheme_id}/areas        — distinct area names for autocomplete
    DELETE /dpr/v2/entry/{entry_id}       — remove an entry (cascades photos)
    DELETE /dpr/v2/photo/{photo_id}       — remove one photo from an entry
"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.dpr import DPREntry, DPREntryV2, DPRPhoto

router = APIRouter(prefix="/dpr", tags=["DPR"])

# Same env var the main app uses to mount /uploads; falls back to /tmp.
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/project_brain/uploads")
DPR_SUBDIR = "dpr"

ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic"}
MAX_PHOTO_BYTES = 10 * 1024 * 1024  # 10 MB hard cap per file


# ===========================================================================
# Legacy endpoints — DO NOT change behavior
# ===========================================================================
class DPRCreate(BaseModel):
    report_date: date
    weather: str
    manpower: int
    work_done: str
    issues: str


@router.get("/{scheme_id}")
def get_dprs(scheme_id: int, db: Session = Depends(get_db)):
    """Legacy: last 30 daily reports, one per date."""
    return (
        db.query(DPREntry)
        .filter(DPREntry.scheme_id == scheme_id)
        .order_by(DPREntry.report_date.desc())
        .limit(30)
        .all()
    )


@router.post("/{scheme_id}")
def create_or_update_dpr(scheme_id: int, dpr: DPRCreate, db: Session = Depends(get_db)):
    """Legacy: upsert one DPR per (scheme, date)."""
    existing = (
        db.query(DPREntry)
        .filter(
            DPREntry.scheme_id == scheme_id,
            DPREntry.report_date == dpr.report_date,
        )
        .first()
    )

    if existing:
        existing.weather = dpr.weather
        existing.manpower = dpr.manpower
        existing.work_done = dpr.work_done
        existing.issues = dpr.issues
        db.commit()
        db.refresh(existing)
        return existing

    new_dpr = DPREntry(scheme_id=scheme_id, **dpr.model_dump())
    db.add(new_dpr)
    db.commit()
    db.refresh(new_dpr)
    return new_dpr


# ===========================================================================
# Sprint 14a — multi-entry v2 endpoints
# ===========================================================================
def _serialize_entry(entry: DPREntryV2) -> dict:
    """Render an entry plus its photo URLs (relative to /uploads mount)."""
    return {
        "id": entry.id,
        "scheme_id": entry.scheme_id,
        "report_date": entry.report_date.isoformat() if entry.report_date else None,
        "area_name": entry.area_name,
        "gps_lat": entry.gps_lat,
        "gps_lng": entry.gps_lng,
        "gps_accuracy_m": entry.gps_accuracy_m,
        "work_done": entry.work_done,
        "issues": entry.issues,
        "weather": entry.weather,
        "manpower": entry.manpower,
        "created_by": entry.created_by,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "photos": [
            {
                "id": p.id,
                "url": f"/uploads/{p.file_path}",
                "captured_at": p.captured_at.isoformat() if p.captured_at else None,
            }
            for p in entry.photos
        ],
    }


def _safe_photo_name(original: Optional[str]) -> str:
    """Generate a collision-proof filename, preserving extension if sensible."""
    ext = ""
    if original:
        suffix = Path(original).suffix.lower()
        if suffix in {".jpg", ".jpeg", ".png", ".webp", ".heic"}:
            ext = suffix
    if not ext:
        ext = ".jpg"
    return f"{uuid.uuid4().hex}{ext}"


@router.get("/v2/{scheme_id}")
def list_v2_entries(scheme_id: int, db: Session = Depends(get_db)):
    """List the last 30 days of multi-entry DPRs for one scheme."""
    entries: List[DPREntryV2] = (
        db.query(DPREntryV2)
        .filter(DPREntryV2.scheme_id == scheme_id)
        .order_by(desc(DPREntryV2.report_date), desc(DPREntryV2.id))
        .limit(200)  # generous cap; ~6 entries/day × 30 days
        .all()
    )
    return [_serialize_entry(e) for e in entries]


@router.get("/v2/{scheme_id}/areas")
def list_v2_areas(scheme_id: int, db: Session = Depends(get_db)):
    """Distinct non-empty area names for this scheme (for autocomplete)."""
    rows = (
        db.query(DPREntryV2.area_name)
        .filter(
            DPREntryV2.scheme_id == scheme_id,
            DPREntryV2.area_name.isnot(None),
            DPREntryV2.area_name != "",
        )
        .distinct()
        .all()
    )
    # Return as a flat sorted list of strings.
    return sorted({r[0] for r in rows if r[0]})


@router.post("/v2/{scheme_id}")
async def create_v2_entry(
    scheme_id: int,
    report_date: date = Form(...),
    gps_lat: float = Form(...),
    gps_lng: float = Form(...),
    gps_accuracy_m: Optional[float] = Form(None),
    area_name: Optional[str] = Form(None),
    work_done: Optional[str] = Form(None),
    issues: Optional[str] = Form(None),
    weather: str = Form("Clear"),
    manpower: int = Form(0),
    created_by: Optional[str] = Form(None),
    photos: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Create one DPR entry (with zero-or-more photo files)."""
    # GPS sanity — server-side mirror of the frontend's "required" rule.
    if not (-90.0 <= gps_lat <= 90.0) or not (-180.0 <= gps_lng <= 180.0):
        raise HTTPException(status_code=400, detail="GPS coordinates out of range")

    entry = DPREntryV2(
        scheme_id=scheme_id,
        report_date=report_date,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
        gps_accuracy_m=gps_accuracy_m,
        area_name=(area_name or "").strip() or None,
        work_done=work_done,
        issues=issues,
        weather=weather or "Clear",
        manpower=manpower or 0,
        created_by=created_by,
    )
    db.add(entry)
    db.flush()  # we need entry.id for the photo paths

    if photos:
        ym = report_date.strftime("%Y-%m")
        target_dir = Path(UPLOAD_DIR) / DPR_SUBDIR / str(scheme_id) / ym
        target_dir.mkdir(parents=True, exist_ok=True)

        for upload in photos:
            if not upload or not upload.filename:
                continue
            content_type = (upload.content_type or "").lower()
            if content_type and content_type not in ALLOWED_PHOTO_MIME:
                # Soft-skip unknown types rather than aborting the whole entry —
                # the rest of the data is still worth saving.
                continue

            data = await upload.read()
            if not data:
                continue
            if len(data) > MAX_PHOTO_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Photo {upload.filename} exceeds 10 MB limit",
                )

            fname = _safe_photo_name(upload.filename)
            (target_dir / fname).write_bytes(data)

            rel = f"{DPR_SUBDIR}/{scheme_id}/{ym}/{fname}"
            db.add(DPRPhoto(dpr_entry_id=entry.id, file_path=rel))

    db.commit()
    db.refresh(entry)
    return _serialize_entry(entry)


@router.delete("/v2/entry/{entry_id}")
def delete_v2_entry(entry_id: int, db: Session = Depends(get_db)):
    """Hard-delete an entry. Photos cascade via DB; we also unlink the files."""
    entry = db.query(DPREntryV2).filter(DPREntryV2.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Best-effort file cleanup before the DB cascade nukes the rows.
    for p in list(entry.photos):
        try:
            (Path(UPLOAD_DIR) / p.file_path).unlink(missing_ok=True)
        except Exception:
            pass

    db.delete(entry)
    db.commit()
    return {"ok": True, "deleted_id": entry_id}


@router.delete("/v2/photo/{photo_id}")
def delete_v2_photo(photo_id: int, db: Session = Depends(get_db)):
    """Remove a single photo without deleting its parent entry."""
    photo = db.query(DPRPhoto).filter(DPRPhoto.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        (Path(UPLOAD_DIR) / photo.file_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(photo)
    db.commit()
    return {"ok": True, "deleted_id": photo_id}
