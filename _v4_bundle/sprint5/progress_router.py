"""
Sprint 5 — S-Curve PREDICT
Endpoints under /api/v1/progress
"""
from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db import get_db  # adapt to your project's session provider

router = APIRouter(prefix="/api/v1/progress", tags=["progress"])


# ---------- SCHEMAS ----------
class MonthlyProgressIn(BaseModel):
    package_id: int
    month_date: date = Field(..., description="First day of the month (auto-coerced)")
    planned_progress_pct: float
    actual_progress_pct: float
    notes: Optional[str] = None


class MonthlyProgressOut(BaseModel):
    progress_id: int
    package_id: int
    month_date: date
    planned_progress_pct: float
    actual_progress_pct: float
    cumulative_planned_pct: float
    cumulative_actual_pct: float
    variance_pct: float
    risk_level: str


class SCurvePoint(BaseModel):
    month_date: date
    cumulative_planned_pct: float
    cumulative_actual_pct: Optional[float]
    is_forecast: bool = False


class SCurveResponse(BaseModel):
    package_id: int
    package_name: str
    scheme_name: str
    points: list[SCurvePoint]
    today_planned_pct: Optional[float]
    today_actual_pct: Optional[float]
    today_variance_pct: Optional[float]
    forecast_completion_date: Optional[date]
    forecast_method: Optional[str]
    forecast_confidence_pct: Optional[float]
    forecast_explainer: Optional[str]


# ---------- HELPERS ----------
def _to_month_start(d: date) -> date:
    return d.replace(day=1)


def _risk_from_variance(variance_pct: float) -> str:
    if variance_pct <= -10: return 'red'
    if variance_pct <= -3:  return 'amber'
    return 'green'


# ---------- ENDPOINTS ----------
@router.post("/monthly", response_model=MonthlyProgressOut)
def upsert_monthly_progress(payload: MonthlyProgressIn, db: Session = Depends(get_db)):
    """Upsert a monthly progress data point for a package."""
    m = _to_month_start(payload.month_date)
    # Compute cumulative totals from previous months
    prev = db.execute(text("""
        SELECT COALESCE(MAX(cumulative_planned_pct),0) AS pp,
               COALESCE(MAX(cumulative_actual_pct),0) AS pa
        FROM plant_progress_monthly
        WHERE package_id=:pid AND month_date < :m
    """), {"pid": payload.package_id, "m": m}).mappings().first()
    cum_p = float(prev['pp']) + payload.planned_progress_pct
    cum_a = float(prev['pa']) + payload.actual_progress_pct
    variance = payload.actual_progress_pct - payload.planned_progress_pct
    risk = _risk_from_variance(variance)

    row = db.execute(text("""
        INSERT INTO plant_progress_monthly
            (package_id, month_date, planned_progress_pct, actual_progress_pct,
             cumulative_planned_pct, cumulative_actual_pct, risk_level, notes)
        VALUES (:pid, :m, :pp, :pa, :cp, :ca, :rl::risk_level_enum, :n)
        ON CONFLICT (package_id, month_date) DO UPDATE SET
            planned_progress_pct=EXCLUDED.planned_progress_pct,
            actual_progress_pct=EXCLUDED.actual_progress_pct,
            cumulative_planned_pct=EXCLUDED.cumulative_planned_pct,
            cumulative_actual_pct=EXCLUDED.cumulative_actual_pct,
            risk_level=EXCLUDED.risk_level,
            notes=EXCLUDED.notes,
            computed_at=CURRENT_TIMESTAMP
        RETURNING progress_id, package_id, month_date, planned_progress_pct,
                  actual_progress_pct, cumulative_planned_pct, cumulative_actual_pct,
                  variance_pct, risk_level::text AS risk_level
    """), {"pid": payload.package_id, "m": m,
           "pp": payload.planned_progress_pct, "pa": payload.actual_progress_pct,
           "cp": cum_p, "ca": cum_a, "rl": risk, "n": payload.notes}).mappings().first()
    db.commit()
    return MonthlyProgressOut(**row)


@router.get("/s-curve/{package_id}", response_model=SCurveResponse)
def get_s_curve(package_id: int, db: Session = Depends(get_db)):
    """Return S-curve data + linear regression forecast."""
    pkg = db.execute(text("""
        SELECT p.package_id, p.package_name, sm.scheme_name
        FROM packages p JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
        WHERE p.package_id=:pid AND NOT p.is_deleted
    """), {"pid": package_id}).mappings().first()
    if not pkg:
        raise HTTPException(404, "Package not found")

    rows = db.execute(text("""
        SELECT month_date, cumulative_planned_pct, cumulative_actual_pct,
               planned_progress_pct, actual_progress_pct
        FROM plant_progress_monthly
        WHERE package_id=:pid ORDER BY month_date
    """), {"pid": package_id}).mappings().all()

    points = [SCurvePoint(
        month_date=r['month_date'],
        cumulative_planned_pct=float(r['cumulative_planned_pct']),
        cumulative_actual_pct=float(r['cumulative_actual_pct']) if r['cumulative_actual_pct'] is not None else None,
        is_forecast=False,
    ) for r in rows]

    # Today's status
    today = date.today()
    today_planned, today_actual, today_var = None, None, None
    if rows:
        latest = rows[-1]
        today_planned = float(latest['cumulative_planned_pct'])
        today_actual = float(latest['cumulative_actual_pct']) if latest['cumulative_actual_pct'] is not None else None
        if today_actual is not None:
            today_var = today_actual - today_planned

    # Linear regression forecast on cumulative actuals → 100%
    forecast_date, method, confidence, explainer = None, None, None, None
    actual_rows = [r for r in rows if r['cumulative_actual_pct'] is not None]
    if len(actual_rows) >= 3:
        # x = month ordinal (relative), y = cumulative actual %
        x0 = actual_rows[0]['month_date'].toordinal()
        xs = [r['month_date'].toordinal() - x0 for r in actual_rows]
        ys = [float(r['cumulative_actual_pct']) for r in actual_rows]
        n = len(xs)
        mean_x, mean_y = sum(xs)/n, sum(ys)/n
        num = sum((xs[i]-mean_x)*(ys[i]-mean_y) for i in range(n))
        den = sum((xs[i]-mean_x)**2 for i in range(n))
        if den > 0:
            slope = num / den
            intercept = mean_y - slope*mean_x
            # Solve slope*x + intercept = 100
            if slope > 0:
                x_at_100 = (100 - intercept) / slope
                forecast_date = date.fromordinal(int(x0 + x_at_100))
                method = 'linear_regression'
                # Crude R² as confidence proxy
                ss_res = sum((ys[i] - (slope*xs[i]+intercept))**2 for i in range(n))
                ss_tot = sum((ys[i]-mean_y)**2 for i in range(n))
                r_sq = 1 - (ss_res/ss_tot) if ss_tot > 0 else 0
                confidence = round(max(0, min(100, r_sq*100)), 1)
                ahead_behind = "ahead" if today_var and today_var > 0 else "behind"
                pct_str = f"{abs(today_var):.1f}" if today_var is not None else "0"
                explainer = (f"Based on last {n} months of progress (slope={slope:.2f}%/day). "
                             f"Currently {ahead_behind} schedule by {pct_str}%. "
                             f"R²={r_sq:.2f}.")
                # Append forecast tail points
                if rows:
                    last_month = rows[-1]['month_date']
                    last_cum_a = float(rows[-1]['cumulative_actual_pct'] or 0)
                    cur = last_month
                    cur_cum = last_cum_a
                    days_per_step = 30
                    while cur < forecast_date and cur_cum < 100:
                        cur = cur + timedelta(days=days_per_step)
                        cur_cum = min(100, slope * (cur.toordinal() - x0) + intercept)
                        # planned cum at this point (extrapolate linearly from last planned)
                        last_planned = float(rows[-1]['cumulative_planned_pct'])
                        points.append(SCurvePoint(
                            month_date=cur.replace(day=1),
                            cumulative_planned_pct=last_planned,
                            cumulative_actual_pct=round(cur_cum, 2),
                            is_forecast=True,
                        ))

                # Persist forecast snapshot
                db.execute(text("""
                    UPDATE forecast_snapshots SET is_current=FALSE WHERE package_id=:pid
                """), {"pid": package_id})
                db.execute(text("""
                    INSERT INTO forecast_snapshots(package_id, snapshot_date,
                        forecast_method, forecast_completion_date, confidence_pct,
                        forecast_progress_pct, input_actual_pct, input_planned_pct,
                        days_observed, explainer, is_current,
                        model_params)
                    VALUES (:pid, :sd, 'linear_regression'::forecast_method_enum, :fd, :c,
                            :fp, :ia, :ip, :n, :e, TRUE,
                            :mp::jsonb)
                """), {
                    "pid": package_id, "sd": today, "fd": forecast_date, "c": confidence,
                    "fp": today_actual, "ia": today_actual, "ip": today_planned,
                    "n": (actual_rows[-1]['month_date'] - actual_rows[0]['month_date']).days,
                    "e": explainer,
                    "mp": '{"slope":%.4f,"intercept":%.4f}' % (slope, intercept),
                })
                db.commit()

    return SCurveResponse(
        package_id=pkg['package_id'], package_name=pkg['package_name'],
        scheme_name=pkg['scheme_name'], points=points,
        today_planned_pct=today_planned, today_actual_pct=today_actual,
        today_variance_pct=today_var,
        forecast_completion_date=forecast_date, forecast_method=method,
        forecast_confidence_pct=confidence, forecast_explainer=explainer,
    )


@router.get("/heatmap")
def get_progress_heatmap(db: Session = Depends(get_db)):
    """Portfolio-wide heatmap: latest progress + risk per package."""
    rows = db.execute(text("""
        SELECT * FROM v_package_health
        WHERE NOT (is_scheme_mirror=TRUE AND latest_progress_month IS NULL)
        ORDER BY CASE latest_risk WHEN 'red' THEN 1 WHEN 'amber' THEN 2 WHEN 'green' THEN 3 ELSE 4 END,
                 variance_pct ASC NULLS LAST
    """)).mappings().all()
    return {"packages": [dict(r) for r in rows]}
