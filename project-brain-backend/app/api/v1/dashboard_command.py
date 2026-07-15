"""Command Dashboard aggregator — one call powers the entire executive dashboard.

GET /api/v1/dashboard/command?fy=2026-27

Design rules:
  * Every data block is fetched in its own guarded section — a missing table or
    empty pipeline degrades that block to a safe default instead of a 500.
  * Raw SQL via SQLAlchemy text() against the live 81-table schema (t5 names:
    scheme_master.scheme_id, capex_month_values.month_no, progress plan tables).
  * FY formats differ across tables ('2026-2027' progress vs '2026-27' CAPEX);
    both spellings are matched.
Response shape mirrors frontend `CmdSummary` in lib/furnace/gridApi.ts.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/dashboard", tags=["Dashboard Command"])

FY_MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]


def _fy_variants(fy: str) -> tuple[str, str, int]:
    """Return ('2026-27', '2026-2027', 2026) from either spelling."""
    fy = (fy or "").strip()
    start = int(fy[:4]) if len(fy) >= 4 and fy[:4].isdigit() else date.today().year
    short = f"{start}-{str(start + 1)[-2:]}"
    long = f"{start}-{start + 1}"
    return short, long, start


def _month_label(month_no: int, start_year: int) -> str:
    yr = start_year if month_no <= 9 else start_year + 1
    return f"{FY_MONTH_NAMES[month_no - 1]}-{str(yr)[-2:]}"


def _rows(db: Session, sql: str, **params):
    try:
        return db.execute(text(sql), params).mappings().all()
    except Exception:
        db.rollback()
        return []


def _scalar(db: Session, sql: str, default=0, **params):
    try:
        value = db.execute(text(sql), params).scalar()
        return default if value is None else value
    except Exception:
        db.rollback()
        return default


@router.get("/command")
def command_summary(fy: str = "2026-27", db: Session = Depends(get_db)):
    fy_short, fy_long, start_year = _fy_variants(fy)

    # ---- portfolio & scheme split -------------------------------------------
    scheme_rows = _rows(db, """
        SELECT s.scheme_id, s.scheme_name,
               COALESCE(s.scheme_type::text,'Corporate AMR')  AS scheme_type,
               COALESCE(s.current_status::text,'')            AS current_status,
               COALESCE(s.anticipated_cost_cr, s.sanctioned_cost_cr, s.estimated_cost_cr, 0) AS cost_cr,
               s.planned_completion_date AS schedule_completion_date,
               s.planned_completion_date AS expected_completion_date,
               s.created_at::date AS registration_date,
               s.planned_start_date AS fy_start_date
        FROM scheme_master s
        WHERE COALESCE(s.is_deleted, FALSE) = FALSE
    """)
    corp = [r for r in scheme_rows if str(r["scheme_type"]).startswith("Corp")]
    plant = [r for r in scheme_rows if not str(r["scheme_type"]).startswith("Corp")]
    total_cost = float(sum(r["cost_cr"] or 0 for r in scheme_rows))

    def _status_bucket(row) -> str:
        status = str(row["current_status"] or "").lower()
        if "complete" in status:
            return "done"
        sched, expected = row["schedule_completion_date"], row["expected_completion_date"]
        if sched and expected:
            months = (expected.year - sched.year) * 12 + (expected.month - sched.month)
            if months > 12:
                return "hot"
            if months > 0:
                return "warn"
        return "ok"

    buckets = {"ok": [], "warn": [], "hot": [], "done": []}
    for row in scheme_rows:
        buckets[_status_bucket(row)].append(row)

    status_rows = [
        {"label": "On Time",           "count": len(buckets["ok"]),   "cost": float(sum(r["cost_cr"] or 0 for r in buckets["ok"])),   "tone": "ok"},
        {"label": "Delay < 1 Year",    "count": len(buckets["warn"]), "cost": float(sum(r["cost_cr"] or 0 for r in buckets["warn"])), "tone": "warn"},
        {"label": "Delay > 1 Year",    "count": len(buckets["hot"]),  "cost": float(sum(r["cost_cr"] or 0 for r in buckets["hot"])),  "tone": "hot"},
        {"label": "Completed this FY", "count": len(buckets["done"]), "cost": float(sum(r["cost_cr"] or 0 for r in buckets["done"])), "tone": "done"},
    ]

    # ---- CAPEX trend: BE/RE/Actual per month with contributors ----------------
    trend_rows = _rows(db, """
        SELECT mv.month_no,
               SUM(COALESCE(mv.be_amount,0))     AS be,
               SUM(COALESCE(mv.re_amount,0))     AS re,
               SUM(COALESCE(mv.actual_amount,0)) AS actual
        FROM capex_month_values mv
        JOIN capex_plan_rows  pr ON pr.id = mv.plan_row_id
        JOIN capex_plan_header h ON h.id = pr.plan_id
        WHERE h.fy_year IN (:short, :long)
        GROUP BY mv.month_no ORDER BY mv.month_no
    """, short=fy_short, long=fy_long)
    by_month = {int(r["month_no"]): r for r in trend_rows}

    contrib_rows = _rows(db, """
        SELECT mv.month_no, pr.row_name,
               SUM(COALESCE(mv.be_amount,0))     AS plan,
               SUM(COALESCE(mv.actual_amount,0)) AS actual
        FROM capex_month_values mv
        JOIN capex_plan_rows  pr ON pr.id = mv.plan_row_id
        JOIN capex_plan_header h ON h.id = pr.plan_id
        WHERE h.fy_year IN (:short, :long)
          AND pr.row_level IN ('Item','Package')
        GROUP BY mv.month_no, pr.row_name
    """, short=fy_short, long=fy_long)
    contrib: dict[int, list] = {}
    for row in contrib_rows:
        contrib.setdefault(int(row["month_no"]), []).append(row)

    trend = []
    for month_no in range(1, 13):
        base = by_month.get(month_no)
        month_contrib = sorted(contrib.get(month_no, []), key=lambda r: -(r["plan"] or 0))
        trend.append({
            "month": _month_label(month_no, start_year),
            "be": float(base["be"]) if base else 0.0,
            "re": float(base["re"]) if base else 0.0,
            "actual": float(base["actual"]) if base else 0.0,
            "planProjects": [{"name": r["row_name"], "amount": float(r["plan"] or 0)} for r in month_contrib[:3] if (r["plan"] or 0) > 0],
            "actualProjects": [{"name": r["row_name"], "amount": float(r["actual"] or 0)} for r in sorted(month_contrib, key=lambda r: -(r["actual"] or 0))[:3] if (r["actual"] or 0) > 0],
        })

    be_total = sum(t["be"] for t in trend)
    re_total = sum(t["re"] for t in trend)
    actual_total = sum(t["actual"] for t in trend)
    re_effective = bool(_scalar(db, """
        SELECT 1 FROM capex_plan_header
        WHERE fy_year IN (:short,:long) AND plan_type='RE' AND COALESCE(is_effective,FALSE)=TRUE LIMIT 1
    """, default=0, short=fy_short, long=fy_long))

    # ---- scheme drill-downs (top by cost, capped for payload) ------------------
    schemes_out = []
    top = sorted(scheme_rows, key=lambda r: -(r["cost_cr"] or 0))[:8]
    for row in top:
        sid = row["scheme_id"]
        milestones = [{
            "label": m["activity_name"], "parent": m["parent"] or "Appendix-2",
            "start": str(m["start_d"] or ""), "finish": str(m["finish_d"] or ""),
            "expectedFinish": str(m["expected_d"] or m["finish_d"] or ""),
            "weight": float(m["weight"] or 0),
        } for m in _rows(db, """
            SELECT a.activity_name,
                   COALESCE(a.activity_category, 'Appendix-2') AS parent,
                   a.planned_start_date  AS start_d,
                   a.planned_finish_date AS finish_d,
                   COALESCE(a.expected_finish_date, a.planned_finish_date) AS expected_d,
                   COALESCE(a.weight_pct, 0) AS weight
            FROM plan_activities a
            JOIN progress_plans pp ON pp.plan_id = a.plan_id
            JOIN packages p ON p.package_id = pp.package_id
            WHERE p.scheme_id = :sid AND COALESCE(a.is_deleted, FALSE) = FALSE
            ORDER BY COALESCE(a.weight_pct, 0) DESC LIMIT 8
        """, sid=sid)]

        curve = [{
            "month": _month_label(((c["m"].month - 4) % 12) + 1, start_year),
            "cumPlan": float(c["cp"] or 0),
            "cumActual": (None if c["ca"] is None else float(c["ca"])),
        } for c in _rows(db, """
            SELECT sc.month_date AS m,
                   sc.cumulative_planned_pct AS cp,
                   sc.cumulative_actual_pct  AS ca
            FROM s_curve_points sc
            JOIN packages p ON p.package_id = sc.package_id
            WHERE p.scheme_id = :sid
            ORDER BY sc.month_date LIMIT 12
        """, sid=sid)]

        achievement = float(_scalar(db, """
            SELECT MAX(cumulative_actual_pct) FROM s_curve_points sc
            JOIN packages p ON p.package_id = sc.package_id WHERE p.scheme_id = :sid
        """, default=0, sid=sid) or 0)

        remarks = [{"month": _month_label(((r["m"].month - 4) % 12) + 1, start_year), "text": r["remark"]}
                   for r in _rows(db, """
            SELECT month_date AS m, remark FROM monthly_remarks
            WHERE scheme_id = :sid AND remark IS NOT NULL ORDER BY month_date DESC LIMIT 6
        """, sid=sid)]

        dpr = [{"category": d["category"], "plan": 100.0, "actual": float(d["pct"] or 0)}
               for d in _rows(db, """
            SELECT COALESCE(activity_group,'General') AS category,
                   AVG(COALESCE(physical_pct_complete,0)) AS pct
            FROM dpr_activities da JOIN packages p ON p.package_id = da.package_id
            WHERE p.scheme_id = :sid GROUP BY 1 ORDER BY 2 DESC LIMIT 6
        """, sid=sid)]

        bucket = _status_bucket(row)
        schemes_out.append({
            "scheme_id": sid, "name": row["scheme_name"], "type": row["scheme_type"],
            "cost": float(row["cost_cr"] or 0), "achievement": achievement,
            "status": {"ok": "On Time", "warn": "Delay < 1 Yr", "hot": "Delay > 1 Yr", "done": "Completed"}[bucket],
            "registration": str(row["registration_date"] or ""),
            "fyStart": str(row["fy_start_date"] or f"{start_year}-04-01"),
            "scheduleFinish": str(row["schedule_completion_date"] or ""),
            "expectedFinish": str(row["expected_completion_date"] or row["schedule_completion_date"] or ""),
            "milestones": milestones, "curve": curve, "remarks": remarks, "dpr": dpr,
        })

    return {
        "fy": fy_short,
        "totalCost": total_cost,
        "be": be_total, "re": re_total, "actual": actual_total,
        "effectivePlanType": "RE" if re_effective else "BE",
        "corp": {"n": len(corp), "cost": float(sum(r["cost_cr"] or 0 for r in corp))},
        "plant": {"n": len(plant), "cost": float(sum(r["cost_cr"] or 0 for r in plant))},
        "completed": {"n": len(buckets["done"]), "cost": status_rows[3]["cost"]},
        "scheduledThisFy": {
            "n": int(_scalar(db, """SELECT COUNT(*) FROM scheme_master
                WHERE COALESCE(is_deleted,FALSE)=FALSE
                  AND planned_completion_date BETWEEN make_date(:y,4,1) AND make_date(:y2,3,31)""",
                default=0, y=start_year, y2=start_year + 1)),
            "cost": float(_scalar(db, """SELECT COALESCE(SUM(COALESCE(anticipated_cost_cr,sanctioned_cost_cr,estimated_cost_cr,0)),0) FROM scheme_master
                WHERE COALESCE(is_deleted,FALSE)=FALSE
                  AND planned_completion_date BETWEEN make_date(:y,4,1) AND make_date(:y2,3,31)""",
                default=0, y=start_year, y2=start_year + 1)),
        },
        "upcoming": {
            "n": int(_scalar(db, """SELECT COUNT(*) FROM scheme_master
                WHERE COALESCE(is_deleted,FALSE)=FALSE AND planned_start_date > make_date(:y2,3,31)""",
                default=0, y2=start_year + 1)),
            "cost": float(_scalar(db, """SELECT COALESCE(SUM(COALESCE(anticipated_cost_cr,sanctioned_cost_cr,estimated_cost_cr,0)),0) FROM scheme_master
                WHERE COALESCE(is_deleted,FALSE)=FALSE AND planned_start_date > make_date(:y2,3,31)""",
                default=0, y2=start_year + 1)),
        },
        "statusRows": status_rows,
        "trend": trend,
        "schemes": schemes_out,
    }
