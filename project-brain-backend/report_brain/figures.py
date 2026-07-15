"""
report_brain.figures — the FIGURES half of every report: pure SQL, never AI.

Fills rb_facts from the live Project Brain schema:
  * CAPEX figures        (capex_month_values / capex_plan_header)  -> DO + MoS
  * PMC discipline %      (s_curve / appendix2 weightages)         -> PMC table
  * Manpower averages     (from ingested DPR manpower atoms)       -> PMC manpower
  * Portfolio counts      (scheme_master status buckets)           -> Board agenda

Every block is independently guarded (missing table -> that metric is skipped,
never a 500) and matches both FY spellings. When the DB is absent (offline dev),
manpower averages are still computed from the ingested atoms so the PMC manpower
table renders in the gold-pair environment.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import mean


def _rows(conn, sql, params=()):
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception:
        conn.rollback() if conn else None
        return []


# ---- manpower averages from ingested DPR atoms (DB-independent) -------------
def manpower_average(manpower_atoms) -> list:
    """Average engaged strength per agency/category across the month's DPRs."""
    by_cat: dict[str, list[float]] = defaultdict(list)
    for a in manpower_atoms:
        a = a.to_json() if hasattr(a, "to_json") else a
        cat = a.get("extra", {}).get("category") or a.get("discipline") or "Total"
        for q in a.get("quantities", []):
            if q.get("value") is not None:
                by_cat[cat].append(float(q["value"]))
    return [{"category": cat, "average": round(mean(vals), 0), "days": len(vals)}
            for cat, vals in sorted(by_cat.items())]


# ---- CAPEX figures (DB) ----------------------------------------------------
def capex_figures(conn, project_scheme_id: int, fy_short: str, fy_long: str,
                  month_no: int) -> dict:
    rows = _rows(conn, """
        SELECT COALESCE(SUM(be_amount),0) be, COALESCE(SUM(re_amount),0) re,
               COALESCE(SUM(actual_amount),0) actual
        FROM capex_month_values mv
        JOIN capex_plan_rows pr ON pr.id = mv.plan_row_id
        JOIN capex_plan_header h ON h.id = pr.plan_id
        WHERE h.scheme_id = %s AND h.fy_year IN (%s,%s) AND mv.month_no <= %s
    """, (project_scheme_id, fy_short, fy_long, month_no))
    r = rows[0] if rows else {"be": 0, "re": 0, "actual": 0}
    return {"capex_be_ytd": float(r["be"]), "capex_re_ytd": float(r["re"]),
            "capex_actual_ytd": float(r["actual"])}


# ---- PMC discipline percentages (DB: s-curve/appendix2) --------------------
def pmc_discipline_pct(conn, scheme_id: int, month_iso: str) -> list[dict]:
    rows = _rows(conn, """
        SELECT COALESCE(a.activity_group, a.discipline, 'General') discipline,
               SUM(a.weightage) wt,
               SUM(a.weightage * COALESCE(a.overall_pct_target,0))/NULLIF(SUM(a.weightage),0) target_till,
               SUM(a.weightage * COALESCE(a.cumulative_pct,0))/NULLIF(SUM(a.weightage),0) cum_pct
        FROM appendix2_activities a
        JOIN packages p ON p.package_id = a.package_id
        WHERE p.scheme_id = %s AND COALESCE(a.is_deleted,false)=false
        GROUP BY 1 ORDER BY 1
    """, (scheme_id, ))
    out = []
    for r in rows:
        out.append({"discipline": r["discipline"],
                    "target_till_month": round(float(r["target_till"] or 0), 2),
                    "cumulative_pct": round(float(r["cum_pct"] or 0), 2)})
    return out


# ---- portfolio counts (DB: scheme_master) ----------------------------------
def portfolio_counts(conn) -> dict:
    rows = _rows(conn, """
        SELECT COALESCE(current_status,'') s,
               COUNT(*) n, COALESCE(SUM(COALESCE(total_cost_cr,gross_cost_cr,0)),0) cost
        FROM scheme_master WHERE COALESCE(is_deleted,false)=false GROUP BY 1
    """)
    return {"buckets": rows, "total": sum(r["n"] for r in rows)}
