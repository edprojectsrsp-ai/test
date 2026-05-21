"""Sprint 7 — Risk heatmap router. Endpoints under /api/v1/risk"""
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db import get_db

router = APIRouter(prefix="/api/v1/risk", tags=["risk"])


@router.get("/heatmap")
def get_risk_heatmap(db: Session = Depends(get_db)):
    """Portfolio-wide risk heatmap. One row per package with worst-risk indicator."""
    rows = db.execute(text("""
        WITH worst_per_pkg AS (
            SELECT package_id,
                   MAX(CASE risk_level WHEN 'red' THEN 4 WHEN 'amber' THEN 3
                                       WHEN 'green' THEN 2 ELSE 1 END) AS rank
            FROM risk_indicators
            WHERE is_active=TRUE AND package_id IS NOT NULL
            GROUP BY package_id
        ),
        worst_per_scheme AS (
            SELECT scheme_id,
                   MAX(CASE risk_level WHEN 'red' THEN 4 WHEN 'amber' THEN 3
                                       WHEN 'green' THEN 2 ELSE 1 END) AS rank
            FROM risk_indicators
            WHERE is_active=TRUE AND scheme_id IS NOT NULL
            GROUP BY scheme_id
        )
        SELECT
            p.package_id, p.package_name, p.is_scheme_mirror,
            sm.scheme_id, sm.scheme_name, sm.scheme_code, sm.scheme_type,
            CASE GREATEST(COALESCE(wpp.rank,0), COALESCE(wps.rank,0))
                WHEN 4 THEN 'red' WHEN 3 THEN 'amber' WHEN 2 THEN 'green' ELSE 'unknown'
            END AS overall_risk,
            (SELECT array_agg(jsonb_build_object(
                'key', indicator_key, 'label', indicator_label,
                'level', risk_level::text, 'score', risk_score,
                'action', suggested_action) ORDER BY
                CASE risk_level WHEN 'red' THEN 1 WHEN 'amber' THEN 2 ELSE 3 END)
             FROM risk_indicators ri
             WHERE ri.is_active=TRUE
               AND (ri.package_id=p.package_id OR ri.scheme_id=sm.scheme_id)
            ) AS indicators
        FROM packages p
        JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
        LEFT JOIN worst_per_pkg wpp ON wpp.package_id=p.package_id
        LEFT JOIN worst_per_scheme wps ON wps.scheme_id=sm.scheme_id
        WHERE NOT p.is_deleted AND NOT sm.is_deleted
        ORDER BY GREATEST(COALESCE(wpp.rank,0), COALESCE(wps.rank,0)) DESC,
                 sm.scheme_name, p.package_no
    """)).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/summary")
def get_risk_summary(db: Session = Depends(get_db)):
    """Top-line risk counts across the portfolio."""
    summary = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE risk_level='red') AS red_count,
            COUNT(*) FILTER (WHERE risk_level='amber') AS amber_count,
            COUNT(*) FILTER (WHERE risk_level='green') AS green_count,
            COUNT(DISTINCT package_id) FILTER (WHERE risk_level IN ('red','amber') AND package_id IS NOT NULL) AS packages_at_risk,
            COUNT(DISTINCT scheme_id) FILTER (WHERE risk_level IN ('red','amber') AND scheme_id IS NOT NULL) AS schemes_at_risk
        FROM risk_indicators WHERE is_active=TRUE
    """)).mappings().first()
    by_rule = db.execute(text("""
        SELECT indicator_key, indicator_label,
            COUNT(*) FILTER (WHERE risk_level='red') AS red,
            COUNT(*) FILTER (WHERE risk_level='amber') AS amber
        FROM risk_indicators WHERE is_active=TRUE
        GROUP BY indicator_key, indicator_label
        ORDER BY (COUNT(*) FILTER (WHERE risk_level='red')) DESC
    """)).mappings().all()
    return {"summary": dict(summary), "by_rule": [dict(r) for r in by_rule]}


@router.get("/package/{package_id}")
def get_package_risks(package_id: int, db: Session = Depends(get_db)):
    """All active risk indicators for one package."""
    rows = db.execute(text("""
        SELECT ri.*, p.package_name, sm.scheme_name
        FROM risk_indicators ri
        LEFT JOIN packages p ON p.package_id=ri.package_id
        LEFT JOIN scheme_master sm ON sm.scheme_id=COALESCE(ri.scheme_id, p.scheme_id)
        WHERE ri.is_active=TRUE
          AND (ri.package_id=:pid OR
               ri.scheme_id=(SELECT scheme_id FROM packages WHERE package_id=:pid))
        ORDER BY CASE ri.risk_level WHEN 'red' THEN 1 WHEN 'amber' THEN 2 ELSE 3 END,
                 ri.computed_at DESC
    """), {"pid": package_id}).mappings().all()
    return {"indicators": [dict(r) for r in rows]}


@router.post("/acknowledge/{risk_id}")
def acknowledge_risk(risk_id: int, user_id: int, db: Session = Depends(get_db)):
    """Mark a risk as acknowledged."""
    db.execute(text("""
        UPDATE risk_indicators
        SET acknowledged_at=CURRENT_TIMESTAMP, acknowledged_by=:uid
        WHERE risk_id=:rid
    """), {"rid": risk_id, "uid": user_id})
    db.commit()
    return {"ok": True}
