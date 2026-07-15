"""DPR API — Daily Progress Reports (t5 schema).

Maps to live t5 tables:
  daily_actuals        — activity-level quantity entries (one row per activity per date)
  field_observations   — geotagged site notes, issues, photos

Note: plan_activities.uom_id → uom_master.uom_code (no direct uom column).
      All date parameters use CAST(:param AS date) to avoid SQLAlchemy parsing
      the PostgreSQL :: cast after a bind param.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/dpr", tags=["DPR"])

# Shared UoM join fragment reused in multiple queries
_UOM_JOIN = "LEFT JOIN uom_master um ON um.uom_id = pa.uom_id"
_UOM_COL  = "COALESCE(um.uom_code, '') AS uom"


# ─────────────────────── Scheme → packages ───────────────────────────────────

@router.get("/scheme/{scheme_id}/packages")
def get_scheme_packages(scheme_id: int, db: Session = Depends(get_db)):
    """Return packages for a scheme with their locked-plan status."""
    rows = db.execute(text("""
        SELECT
            p.package_id,
            p.package_name,
            p.package_value_cr,
            p.planned_end_date,
            CASE WHEN pp.plan_id IS NOT NULL THEN TRUE ELSE FALSE END AS has_active_plan,
            pp.plan_name,
            pp.plan_id
        FROM packages p
        LEFT JOIN progress_plans pp
               ON pp.package_id = p.package_id
              AND pp.is_locked   = TRUE
              AND pp.is_current  = TRUE
        WHERE p.scheme_id = :s_id
          AND NOT p.is_deleted
        ORDER BY p.package_id
    """), {"s_id": scheme_id}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Plan activities list ────────────────────────────────

@router.get("/packages/{package_id}/activities")
def get_package_activities(package_id: int, db: Session = Depends(get_db)):
    """Return plan activities from the locked plan for this package."""
    rows = db.execute(text("""
        SELECT
            pa.activity_id,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.planned_start_date,
            pa.planned_finish_date,
            pa.weight_pct,
            pa.sort_order,
            pp.plan_id,
            pp.plan_name
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked  = TRUE
          AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Get actuals for a package ───────────────────────────

@router.get("/actuals/{package_id}")
def get_actuals(
    package_id: int,
    month: Optional[str] = Query(None, description="YYYY-MM"),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    db: Session = Depends(get_db),
):
    """List daily_actuals rows for a package, optionally filtered by date range."""
    if month and not date_from and not date_to:
        import calendar
        year, mon = (int(part) for part in month.split("-"))
        date_from = f"{year:04d}-{mon:02d}-01"
        date_to = f"{year:04d}-{mon:02d}-{calendar.monthrange(year, mon)[1]:02d}"
    rows = db.execute(text("""
        SELECT
            da.daily_actual_id,
            da.activity_id,
            da.actual_date,
            da.actual_qty,
            da.area_of_work,
            da.manpower_count,
            da.equipment_deployed,
            da.weather_conditions,
            da.remarks,
            da.entered_via,
            da.location_lat,
            da.location_lng,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.sort_order
        FROM daily_actuals da
        JOIN plan_activities  pa ON da.activity_id = pa.activity_id
        JOIN progress_plans   pp ON pa.plan_id      = pp.plan_id
        LEFT JOIN uom_master  um ON um.uom_id        = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND (:d_from IS NULL OR da.actual_date >= CAST(:d_from AS date))
          AND (:d_to   IS NULL OR da.actual_date <= CAST(:d_to   AS date))
        ORDER BY da.actual_date DESC, pa.sort_order
    """), {
        "pkg_id": package_id,
        "d_from": date_from,
        "d_to":   date_to,
    }).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Get actuals for one date ────────────────────────────

@router.get("/actuals/{package_id}/date/{actual_date}")
def get_actuals_for_date(
    package_id: int,
    actual_date: str,
    db: Session = Depends(get_db),
):
    """Return actuals + cumulative for a specific date (prefills entry form)."""
    rows = db.execute(text("""
        SELECT
            pa.activity_id,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.sort_order,
            COALESCE(da.actual_qty, 0)         AS actual_qty,
            COALESCE(da.manpower_count, 0)      AS manpower_count,
            COALESCE(da.weather_conditions, '') AS weather_conditions,
            COALESCE(da.area_of_work, '')       AS area_of_work,
            COALESCE(da.remarks, '')            AS remarks,
            COALESCE(
                (SELECT SUM(da2.actual_qty)
                 FROM daily_actuals da2
                 WHERE da2.activity_id = pa.activity_id
                   AND da2.actual_date < CAST(:the_date AS date)
                ), 0
            ) AS cumulative_before,
            COALESCE(
                (SELECT SUM(mpe.planned_qty)
                 FROM monthly_plan_entries mpe
                 WHERE mpe.activity_id = pa.activity_id
                   AND mpe.month_date = DATE_TRUNC('month', CAST(:the_date AS date))::date
                ), 0
            ) AS month_plan_qty
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id  = pa.uom_id
        LEFT JOIN daily_actuals da
               ON da.activity_id = pa.activity_id
              AND da.actual_date  = CAST(:the_date AS date)
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked  = TRUE
          AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id, "the_date": actual_date}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Upsert actuals ──────────────────────────────────────

class ActualEntry(BaseModel):
    activity_id: int
    actual_date: str
    actual_qty: float
    area_of_work: Optional[str] = None
    manpower_count: Optional[int] = None
    equipment_deployed: Optional[str] = None
    weather_conditions: Optional[str] = None
    remarks: Optional[str] = None
    entered_via: str = "web"
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None


class DailySubmission(BaseModel):
    package_id: int
    entries: List[ActualEntry]


@router.post("/actuals")
def upsert_actuals(payload: DailySubmission, db: Session = Depends(get_db)):
    """Upsert daily_actuals rows — one per (activity_id, actual_date).

    Sprint 2 — enforces Admin DPR backdate window (app_settings.daily_progress_backdate_days).
    """
    from datetime import date as _date, datetime as _dt, timedelta as _td
    try:
        from app.api.v1.admin_rbac import get_dpr_backdate_days
        backdate_days = get_dpr_backdate_days(db)
    except Exception:
        backdate_days = 7
    min_date = _date.today() - _td(days=backdate_days)
    max_date = _date.today()

    upserted = 0
    for e in payload.entries:
        try:
            act = _dt.strptime(str(e.actual_date)[:10], "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(422, f"Bad actual_date: {e.actual_date}")
        if act < min_date:
            raise HTTPException(
                422,
                f"Date {act.isoformat()} is older than allowed backdate window "
                f"({backdate_days} days). Change Admin → Settings → DPR backdate days.",
            )
        if act > max_date:
            raise HTTPException(422, f"Future dates are not allowed ({act.isoformat()})")
        db.execute(text("""
            INSERT INTO daily_actuals
                (activity_id, actual_date, actual_qty, area_of_work,
                 manpower_count, equipment_deployed, weather_conditions,
                 remarks, entered_via, location_lat, location_lng)
            VALUES
                (:act_id, CAST(:act_date AS date), :qty, :area,
                 :manpower, :equip, :weather,
                 :remarks, :via, :lat, :lng)
            ON CONFLICT (activity_id, actual_date) DO UPDATE SET
                actual_qty         = EXCLUDED.actual_qty,
                area_of_work       = COALESCE(EXCLUDED.area_of_work,       daily_actuals.area_of_work),
                manpower_count     = COALESCE(EXCLUDED.manpower_count,     daily_actuals.manpower_count),
                equipment_deployed = COALESCE(EXCLUDED.equipment_deployed, daily_actuals.equipment_deployed),
                weather_conditions = COALESCE(EXCLUDED.weather_conditions, daily_actuals.weather_conditions),
                remarks            = COALESCE(EXCLUDED.remarks,            daily_actuals.remarks),
                entered_via        = EXCLUDED.entered_via,
                updated_at         = CURRENT_TIMESTAMP
        """), {
            "act_id":   e.activity_id,
            "act_date": e.actual_date,
            "qty":      e.actual_qty,
            "area":     e.area_of_work,
            "manpower": e.manpower_count,
            "equip":    e.equipment_deployed,
            "weather":  e.weather_conditions,
            "remarks":  e.remarks,
            "via":      e.entered_via,
            "lat":      e.location_lat,
            "lng":      e.location_lng,
        })
        upserted += 1
    db.commit()
    return {"ok": True, "upserted": upserted}


# ─────────────────────── Monthly actuals summary ─────────────────────────────

@router.get("/summary/{package_id}")
def get_monthly_summary(
    package_id: int,
    month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    """Per-activity summary for a month: month_plan / month_actual / cumulative / progress_pct."""
    year, mon = month.split("-")
    month_start = f"{year}-{mon}-01"
    import calendar
    month_end = f"{year}-{mon}-{calendar.monthrange(int(year), int(mon))[1]:02d}"

    rows = db.execute(text("""
        SELECT
            pa.activity_id,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.actuals_till_last_fy,
            pa.sort_order,
            COALESCE(
                (SELECT SUM(mpe.planned_qty)
                 FROM monthly_plan_entries mpe
                 WHERE mpe.activity_id = pa.activity_id
                   AND mpe.month_date  = CAST(:m_start AS date)
                ), 0
            ) AS month_plan,
            COALESCE(
                (SELECT SUM(da.actual_qty)
                 FROM daily_actuals da
                 WHERE da.activity_id = pa.activity_id
                   AND DATE_TRUNC('month', da.actual_date) = CAST(:m_start AS date)
                ), 0
            ) AS month_actual,
            COALESCE(
                pa.actuals_till_last_fy + COALESCE(
                (SELECT SUM(da2.actual_qty)
                 FROM daily_actuals da2
                 WHERE da2.activity_id = pa.activity_id
                   AND da2.actual_date <= CAST(:m_end AS date)
                ), 0), 0
            ) AS cum_actual
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id  = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked  = TRUE
          AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id, "m_start": month_start, "m_end": month_end}).mappings().all()

    result = []
    for r in rows:
        d = dict(r)
        scope = float(d["scope_qty"] or 0)
        d["progress_pct"] = round(float(d["cum_actual"]) / scope * 100, 1) if scope > 0 else 0.0
        result.append(d)
    return result


# ─────────────────── Physical + financial progress summary ──────────────────

@router.get("/progress-summary/{package_id}")
def get_progress_summary(
    package_id: int,
    month: str = Query(..., description="Report month YYYY-MM"),
    db: Session = Depends(get_db),
):
    """DPR board summary: per-activity physical progress (for-the-month /
    current-FY / cumulative, plan vs actual, qty + %) with a weighted overall
    row, plus the scheme's CAPEX financial summary for the same period."""
    import calendar
    from datetime import date as _date

    year, mon = int(month[:4]), int(month[5:7])
    m_start = _date(year, mon, 1)
    m_end = _date(year, mon, calendar.monthrange(year, mon)[1])
    # Indian FY: Apr..Mar
    fy_start = _date(year if mon >= 4 else year - 1, 4, 1)
    fy_label = f"{fy_start.year}-{str(fy_start.year + 1)[2:]}"
    # capex_month_values / capex_actuals store CALENDAR month numbers
    # (Apr=4 .. Mar=3); FY-elapsed months therefore wrap at Dec.
    fy_order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
    fy_months_elapsed = fy_order[: fy_order.index(mon) + 1]

    rows = db.execute(text("""
        SELECT
            pa.activity_id, pa.activity_name, pa.activity_category,
            COALESCE(um.uom_code, '') AS uom,
            COALESCE(pa.scope_qty, 0)            AS scope,
            COALESCE(pa.weight_pct, 0)           AS weight_pct,
            COALESCE(pa.actuals_till_last_fy, 0) AS last_fy_actual,
            COALESCE((SELECT SUM(mpe.planned_qty) FROM monthly_plan_entries mpe
                      WHERE mpe.activity_id = pa.activity_id
                        AND mpe.month_date = CAST(:m_start AS date)), 0)      AS ftm_plan,
            COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                      WHERE da.activity_id = pa.activity_id
                        AND da.actual_date BETWEEN CAST(:m_start AS date)
                                               AND CAST(:m_end AS date)), 0)  AS ftm_actual,
            COALESCE((SELECT SUM(mpe.planned_qty) FROM monthly_plan_entries mpe
                      WHERE mpe.activity_id = pa.activity_id
                        AND mpe.month_date BETWEEN CAST(:fy_start AS date)
                                               AND CAST(:m_start AS date)), 0) AS fy_plan,
            COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                      WHERE da.activity_id = pa.activity_id
                        AND da.actual_date BETWEEN CAST(:fy_start AS date)
                                               AND CAST(:m_end AS date)), 0)   AS fy_actual
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked = TRUE AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id, "m_start": m_start, "m_end": m_end,
           "fy_start": fy_start}).mappings().all()

    physical = []
    tot_w = sum(float(r["weight_pct"]) for r in rows) or float(len(rows)) or 1.0
    overall = {k: 0.0 for k in ("last_fy", "ftm_plan", "ftm_actual",
                                "fy_plan", "fy_actual", "cum_plan", "cum_actual")}
    for r in rows:
        scope = float(r["scope"])
        w = float(r["weight_pct"]) or (tot_w / len(rows) if rows else 1.0)
        cum_plan = float(r["last_fy_actual"]) + float(r["fy_plan"])
        cum_actual = float(r["last_fy_actual"]) + float(r["fy_actual"])
        pcts = {
            "last_fy_pct":   (float(r["last_fy_actual"]) / scope * 100) if scope else 0,
            "ftm_plan_pct":  (float(r["ftm_plan"])   / scope * 100) if scope else 0,
            "ftm_actual_pct": (float(r["ftm_actual"]) / scope * 100) if scope else 0,
            "fy_plan_pct":   (float(r["fy_plan"])    / scope * 100) if scope else 0,
            "fy_actual_pct": (float(r["fy_actual"])  / scope * 100) if scope else 0,
            "cum_plan_pct":  (cum_plan   / scope * 100) if scope else 0,
            "cum_actual_pct": (cum_actual / scope * 100) if scope else 0,
        }
        physical.append({
            "activity_id": r["activity_id"],
            "activity_name": r["activity_name"],
            "category": r["activity_category"],
            "uom": r["uom"], "scope": scope,
            "last_fy_actual": float(r["last_fy_actual"]),
            "ftm_plan": float(r["ftm_plan"]), "ftm_actual": float(r["ftm_actual"]),
            "fy_plan": float(r["fy_plan"]), "fy_actual": float(r["fy_actual"]),
            "cum_plan": cum_plan, "cum_actual": cum_actual,
            **{k: round(v, 1) for k, v in pcts.items()},
        })
        share = w / tot_w
        overall["last_fy"]    += pcts["last_fy_pct"] * share
        overall["ftm_plan"]   += pcts["ftm_plan_pct"] * share
        overall["ftm_actual"] += pcts["ftm_actual_pct"] * share
        overall["fy_plan"]    += pcts["fy_plan_pct"] * share
        overall["fy_actual"]  += pcts["fy_actual_pct"] * share
        overall["cum_plan"]   += pcts["cum_plan_pct"] * share
        overall["cum_actual"] += pcts["cum_actual_pct"] * share

    # ── financial: scheme CAPEX rows from the effective plan of this FY ─────
    fin_rows = db.execute(text("""
        SELECT
            cpr.row_name,
            COALESCE(cpv.gross_cost, 0)                   AS budget,
            COALESCE(cpv.cumulative_exp_till_last_fy, 0)  AS exp_last_fy,
            COALESCE(cpv.be_fy, 0)                        AS be_fy,
            COALESCE(cpv.re_fy, 0)                        AS re_fy,
            COALESCE((SELECT SUM(CASE WHEN cph.plan_type = 'RE'
                                      THEN cmv.re_amount ELSE cmv.be_amount END)
                      FROM capex_month_values cmv
                      WHERE cmv.plan_row_id = cpr.id
                        AND cmv.month_no = ANY(:fy_months)), 0) AS fy_plan_till_date,
            COALESCE((SELECT SUM(ca.amount) FROM capex_actuals ca
                      WHERE ca.plan_row_id = cpr.id
                        AND ca.month_no = ANY(:fy_months)), 0)  AS fy_actual_till_date
        FROM capex_plan_rows cpr
        JOIN capex_plan_header cph ON cph.id = cpr.plan_id
        LEFT JOIN capex_plan_values cpv ON cpv.plan_row_id = cpr.id
        WHERE cpr.scheme_id = (SELECT scheme_id FROM packages
                               WHERE package_id = :pkg_id)
          AND cph.fy_year = :fy_label
          AND (cph.is_effective = 1 OR NOT EXISTS (
                SELECT 1 FROM capex_plan_header h2
                WHERE h2.fy_year = :fy_label AND h2.is_effective = 1))
        ORDER BY cpr.display_order
    """), {"pkg_id": package_id, "fy_months": fy_months_elapsed,
           "fy_label": fy_label}).mappings().all()

    financial = []
    for f in fin_rows:
        budget = float(f["budget"])
        cum_plan_cr = float(f["exp_last_fy"]) + float(f["fy_plan_till_date"])
        cum_actual_cr = float(f["exp_last_fy"]) + float(f["fy_actual_till_date"])
        financial.append({
            "row_name": f["row_name"], "budget": budget,
            "fy_plan": float(f["fy_plan_till_date"]),
            "fy_actual": float(f["fy_actual_till_date"]),
            "cum_plan": cum_plan_cr, "cum_actual": cum_actual_cr,
            "fy_plan_pct":   round(float(f["fy_plan_till_date"]) / budget * 100, 1) if budget else 0,
            "fy_actual_pct": round(float(f["fy_actual_till_date"]) / budget * 100, 1) if budget else 0,
            "cum_plan_pct":  round(cum_plan_cr / budget * 100, 1) if budget else 0,
            "cum_actual_pct": round(cum_actual_cr / budget * 100, 1) if budget else 0,
        })

    return {
        "month": month, "fy_label": fy_label,
        "physical": physical,
        "overall": {k: round(v, 1) for k, v in overall.items()},
        "financial": financial,
    }


# ─────────────────────── Field observations ──────────────────────────────────

class ObservationCreate(BaseModel):
    package_id: int
    activity_id: Optional[int] = None
    observation_type: str = "note"
    title: Optional[str] = None
    description: str
    severity: Optional[str] = None
    weather: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    location_label: Optional[str] = None
    observed_by: int = 1


@router.post("/observations")
def create_observation(payload: ObservationCreate, db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO field_observations
            (package_id, activity_id, observation_type, title, description,
             severity, weather, location_lat, location_lng, location_label,
             observed_by)
        VALUES
            (:pkg_id, :act_id, :obs_type, :title, :desc,
             :severity, :weather, :lat, :lng, :label, :obs_by)
        RETURNING observation_id
    """), {
        "pkg_id":   payload.package_id,
        "act_id":   payload.activity_id,
        "obs_type": payload.observation_type,
        "title":    payload.title,
        "desc":     payload.description,
        "severity": payload.severity,
        "weather":  payload.weather,
        "lat":      payload.location_lat,
        "lng":      payload.location_lng,
        "label":    payload.location_label,
        "obs_by":   payload.observed_by,
    }).mappings().first()
    db.commit()
    return {"ok": True, "observation_id": row["observation_id"]}


@router.get("/observations/{package_id}")
def get_observations(
    package_id: int,
    limit: int = Query(50),
    db: Session = Depends(get_db),
):
    rows = db.execute(text("""
        SELECT
            fo.observation_id,
            fo.package_id,
            fo.activity_id,
            fo.observation_type,
            fo.title,
            fo.description,
            fo.severity,
            fo.weather,
            fo.location_lat,
            fo.location_lng,
            fo.location_label,
            fo.photo_urls,
            fo.is_resolved,
            fo.observed_at,
            pa.activity_name
        FROM field_observations fo
        LEFT JOIN plan_activities pa ON fo.activity_id = pa.activity_id
        WHERE fo.package_id = :pkg_id
          AND NOT fo.is_deleted
        ORDER BY fo.observed_at DESC
        LIMIT :lim
    """), {"pkg_id": package_id, "lim": limit}).mappings().all()
    return [dict(r) for r in rows]


# ── Sprint 7 · productivity + anomaly QC ─────────────────────────────────────

@router.get("/qc/{package_id}")
def dpr_qc(
    package_id: int,
    days: int = Query(30, ge=7, le=180),
    db: Session = Depends(get_db),
):
    """Productivity (qty/man-day) and anomaly flags for recent DPR entries.

    Anomalies:
      · zero_qty_with_manpower  — crew present, no progress
      · spike_vs_median         — daily qty > 3× rolling median for activity
      · over_scope              — cum actual exceeds scope by >5%
      · negative_or_null        — bad qty
    """
    from datetime import date as _date, timedelta

    since = _date.today() - timedelta(days=days)
    rows = db.execute(text(f"""
        SELECT
            da.daily_actual_id,
            da.activity_id,
            pa.activity_name,
            {_UOM_COL},
            pa.scope_qty,
            da.actual_date,
            da.actual_qty,
            COALESCE(da.manpower_count, 0) AS manpower_count,
            da.equipment_deployed,
            da.area_of_work,
            da.remarks,
            COALESCE((
                SELECT SUM(x.actual_qty) FROM daily_actuals x
                WHERE x.activity_id = da.activity_id
            ), 0) AS cum_actual
        FROM daily_actuals da
        JOIN plan_activities pa ON pa.activity_id = da.activity_id
        JOIN progress_plans pp ON pp.plan_id = pa.plan_id
        {_UOM_JOIN}
        WHERE pp.package_id = :pid
          AND da.actual_date >= CAST(:since AS date)
        ORDER BY da.actual_date DESC, pa.activity_name
    """), {"pid": package_id, "since": since.isoformat()}).mappings().all()

    # per-activity qty series for median
    by_act: dict[int, list[float]] = {}
    for r in rows:
        by_act.setdefault(int(r["activity_id"]), []).append(float(r["actual_qty"] or 0))

    def median(vals: list[float]) -> float:
        if not vals:
            return 0.0
        s = sorted(vals)
        n = len(s)
        mid = n // 2
        return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0

    medians = {aid: median(vs) for aid, vs in by_act.items()}

    anomalies = []
    productivity = []
    total_qty = 0.0
    total_man = 0
    for r in rows:
        qty = float(r["actual_qty"] or 0)
        man = int(r["manpower_count"] or 0)
        scope = float(r["scope_qty"] or 0)
        cum = float(r["cum_actual"] or 0)
        total_qty += qty
        total_man += man
        prod = (qty / man) if man > 0 else None
        productivity.append({
            "daily_actual_id": r["daily_actual_id"],
            "activity_id": r["activity_id"],
            "activity_name": r["activity_name"],
            "date": r["actual_date"].isoformat() if r["actual_date"] else None,
            "qty": qty,
            "manpower": man,
            "qty_per_man_day": round(prod, 4) if prod is not None else None,
            "equipment": r["equipment_deployed"],
            "uom": r["uom"],
        })
        flags = []
        if qty == 0 and man > 0:
            flags.append("zero_qty_with_manpower")
        if qty < 0:
            flags.append("negative_or_null")
        med = medians.get(int(r["activity_id"]), 0)
        if med > 0 and qty > 3 * med:
            flags.append("spike_vs_median")
        if scope > 0 and cum > scope * 1.05:
            flags.append("over_scope")
        if flags:
            anomalies.append({
                "daily_actual_id": r["daily_actual_id"],
                "activity_id": r["activity_id"],
                "activity_name": r["activity_name"],
                "date": r["actual_date"].isoformat() if r["actual_date"] else None,
                "qty": qty,
                "manpower": man,
                "cum_actual": cum,
                "scope_qty": scope,
                "median_qty": round(med, 4),
                "flags": flags,
                "remarks": r["remarks"],
            })

    return {
        "package_id": package_id,
        "window_days": days,
        "since": since.isoformat(),
        "entries": len(rows),
        "summary": {
            "total_qty": round(total_qty, 4),
            "total_man_days": total_man,
            "overall_qty_per_man_day": round(total_qty / total_man, 4) if total_man else None,
            "anomaly_count": len(anomalies),
        },
        "productivity": productivity[:200],
        "anomalies": anomalies[:100],
    }
