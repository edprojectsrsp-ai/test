"""
Import friend's Project Brain data (staging DB `friend_brain`) into my
normalized t5 schema (`project_brain`).

Mapping overview
----------------
  friend.projects            -> scheme_master (+ mirror package) using an
                                explicit audited source-id mapping
  friend.plans               -> progress_plans
  friend.activities          -> plan_activities
  friend.monthly_plans       -> monthly_plan_entries
  friend.daily_actuals       -> daily_actuals
  friend.appendix2           -> appendix2_revisions + appendix2_items
  friend.billing_schedule    -> billing_schedules
  friend.plant_level_amr_*   -> plant_progress_monthly + CAPEX values/actuals
  (CPM / AI / PPE data intentionally NOT imported.)

Idempotent: rows created here carry extra_fields->>'src' = 'friend_import'
and are deleted (cascading) at the start of each run.

Usage:  python tools/import_friend_data.py
"""

from __future__ import annotations

import json
import os
import re
from datetime import date

import psycopg2
from psycopg2.extras import RealDictCursor

SRC_URL = os.getenv(
    "FRIEND_DB_URL",
    "postgresql://postgres:abc123@127.0.0.1:5432/friend_brain",
)
DST_URL = os.getenv(
    "PROJECT_BRAIN_DB_URL",
    os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:abc123@127.0.0.1:5432/project_brain",
    ),
)

MARK = json.dumps({"src": "friend_import"})

# Explicit friend project id -> (scheme_id, package_id or None = mirror package).
# The base database already contains these 77 projects under curated names. The
# remaining five source projects are genuinely new and are created below. An
# explicit map avoids false fuzzy matches such as CCTV -> SCADA and ZLD-1 ->
# ZLD-2, and prevents duplicate long-name schemes.
PROJECT_TARGETS = {
    7: (64, None),
    8: (74, 74),
    9: (70, None),
    10: (71, None),
    11: (73, None),
    13: (63, None),
    14: (66, None),
    15: (67, None),
    16: (68, None),
    17: (69, None),
    21: (74, 74),
    22: (74, 75),
    23: (74, 76),
    180: (1, None),
    182: (3, None),
    183: (4, None),
    184: (5, None),
    185: (6, None),
    186: (7, None),
    187: (8, None),
    188: (9, None),
    189: (10, None),
    190: (11, None),
    191: (12, None),
    192: (13, None),
    193: (14, None),
    194: (15, None),
    195: (16, None),
    196: (17, None),
    197: (18, None),
    198: (19, None),
    199: (20, None),
    200: (21, None),
    201: (22, None),
    202: (23, None),
    203: (24, None),
    204: (25, None),
    205: (26, None),
    206: (27, None),
    207: (28, None),
    208: (29, None),
    209: (30, None),
    210: (31, None),
    211: (32, None),
    212: (33, None),
    213: (34, None),
    214: (35, None),
    215: (36, None),
    216: (37, None),
    217: (38, None),
    218: (39, None),
    219: (40, None),
    220: (41, None),
    221: (42, None),
    222: (43, None),
    223: (44, None),
    224: (45, None),
    225: (46, None),
    226: (47, None),
    227: (48, None),
    228: (49, None),
    229: (50, None),
    230: (51, None),
    231: (52, None),
    232: (53, None),
    233: (54, None),
    234: (55, None),
    235: (56, None),
    236: (57, None),
    237: (58, None),
    238: (59, None),
    239: (60, None),
    240: (61, None),
    241: (2, None),
    243: (65, None),
    245: (72, None),
    246: (62, None),
}

MONTH_ABBR = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}

UOM_NORMALIZE = {
    "CUM": "CUM", "M3": "M3", "NOS": "NOS", "NO": "NOS", "EACH": "NOS",
    "MT": "MT", "TON": "TONS", "TONS": "TONS", "MTR": "RMT", "M": "RMT",
    "RM": "RM", "RMT": "RMT", "SQM": "SQM", "M2": "M2", "LS": "LS",
    "LOT": "LOT", "SET": "SET", "KM": "KM", "%": "%", "PERCENT": "%",
}


def dt(v):
    """Friend DB stores dates as text ('' for null). -> date or None."""
    if v is None or isinstance(v, date):
        return v
    v = str(v).strip()
    if not v:
        return None
    from datetime import datetime
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%y", "%d-%b-%Y"):
        try:
            return datetime.strptime(v[:10], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(v).date()
    except ValueError:
        return None


def month_to_date(s: str):
    """'Apr-24' -> date(2024, 4, 1)"""
    if not s:
        return None
    m = re.match(r"([A-Za-z]{3})-(\d{2,4})", s.strip())
    if not m:
        return None
    mon = MONTH_ABBR.get(m.group(1).title())
    if not mon:
        return None
    yr = int(m.group(2))
    if yr < 100:
        yr += 2000
    return date(yr, mon, 1)


def source_bool(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "t", "yes", "y"}


def main():
    src = psycopg2.connect(SRC_URL)
    dst = psycopg2.connect(DST_URL)
    s = src.cursor(cursor_factory=RealDictCursor)
    d = dst.cursor(cursor_factory=RealDictCursor)

    # -------------------------------------------------------- resync sequences
    for tbl, col in [("scheme_master", "scheme_id"), ("packages", "package_id"),
                     ("progress_plans", "plan_id"), ("plan_activities", "activity_id"),
                     ("monthly_plan_entries", "monthly_entry_id"),
                     ("daily_actuals", "daily_actual_id"),
                     ("appendix2_revisions", "revision_id"),
                     ("appendix2_items", "item_id"),
                     ("billing_schedules", "billing_schedule_id"),
                     ("uom_master", "uom_id")]:
        d.execute(f"""SELECT setval(pg_get_serial_sequence('{tbl}', '{col}'),
                      COALESCE((SELECT MAX({col}) FROM {tbl}), 1))""")
    dst.commit()

    # ------------------------------------------------------------------ wipe
    print("== cleaning previous friend_import rows ==")
    for sql in [
        "DELETE FROM progress_plans WHERE extra_fields->>'src' = 'friend_import'",
        "DELETE FROM billing_schedules WHERE extra_fields->>'src' = 'friend_import'",
        "DELETE FROM appendix2_revisions WHERE extra_fields->>'src' = 'friend_import'",
        """DELETE FROM capex_plan_rows
             WHERE is_imported = 1
               AND scheme_id IN (
                   SELECT scheme_id FROM scheme_master
                   WHERE extra_fields->>'src' = 'friend_import'
               )""",
        "DELETE FROM scheme_master WHERE extra_fields->>'src' = 'friend_import'",
    ]:
        d.execute(sql)
        print(f"   {d.rowcount:5d}  {sql.split('FROM ')[1].split(' ')[0]}")

    d.execute("""
        UPDATE progress_plans
        SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE is_current = TRUE
          AND (
              extra_fields->>'seed_tag' = 'COB7_SCURVE_TEST_SEED'
              OR plan_name LIKE '%AUTOTEST_APPX2%'
              OR plan_name LIKE '%COB7_APPX2_SEED%'
          )
    """)
    print(f"   {d.rowcount:5d}  synthetic COB-7 plans deactivated")
    d.execute("""
        DELETE FROM billing_schedules
        WHERE package_id = 74
          AND extra_fields = '{}'::jsonb
          AND description IN (
              'Mobilisation & Site Setup',
              'Civil Foundation Works',
              'Structural Steel Erection (50%)',
              'Structural Steel Erection (100%)',
              'Equipment Supply & Installation',
              'Testing, Commissioning & Handover'
          )
    """)
    print(f"   {d.rowcount:5d}  synthetic billing milestones removed")
    d.execute("""
        DELETE FROM plant_progress_monthly
        WHERE package_id = 1
          AND month_date = DATE '2024-01-01'
          AND planned_progress_pct = 10
          AND actual_progress_pct = 8
          AND COALESCE(notes, '') = ''
    """)
    print(f"   {d.rowcount:5d}  synthetic progress points removed")
    dst.commit()

    # ------------------------------------------------- scheme / package maps
    d.execute("""SELECT package_id, scheme_id, package_no FROM packages
                 WHERE NOT is_deleted ORDER BY scheme_id, package_no""")
    pkg_by_scheme: dict[int, int] = {}
    for r in d.fetchall():
        pkg_by_scheme.setdefault(r["scheme_id"], r["package_id"])

    s.execute("SELECT * FROM projects ORDER BY id")
    fr_projects = s.fetchall()

    proj_scheme: dict[int, int] = {}   # friend project id -> my scheme_id
    proj_pkg: dict[int, int] = {}      # friend project id -> my package_id
    created = matched = 0

    for p in fr_projects:
        ptype = "corporate" if "corporate" in (p["project_type"] or "").lower() else "plant"
        target = PROJECT_TARGETS.get(p["id"])

        if target is None:
            source_meta = json.dumps({
                "src": "friend_import",
                "friend_project_ids": [p["id"]],
                "friend_unique_ids": [p["unique_id"]],
            })
            d.execute("""
                INSERT INTO scheme_master
                    (scheme_code, scheme_name, scheme_type, current_status,
                     estimated_cost_cr, planned_start_date,
                     planned_completion_date, extra_fields)
                VALUES (%s, %s, %s, 'ongoing', %s, %s, %s, %s::jsonb)
                RETURNING scheme_id
            """, (
                p["unique_id"], p["project_name"].strip(), ptype,
                p.get("master_gross_cost") or p.get("stage2_cost") or p.get("stage1_cost"),
                dt(p.get("effective_date")),
                dt(p.get("schedule_completion"))
                or dt(p.get("master_schedule_completion_date"))
                or dt(p.get("master_expected_completion_date")),
                source_meta,
            ))
            sid = d.fetchone()["scheme_id"]
            # scheme_master has an AFTER INSERT trigger that auto-creates the
            # mirror package — adopt it instead of inserting a duplicate.
            d.execute("""
                UPDATE packages SET executing_agency=%s,
                       package_status='in_progress', extra_fields=%s::jsonb
                WHERE scheme_id=%s AND package_no=1
                RETURNING package_id
            """, (p["contractor_name"], source_meta, sid))
            row = d.fetchone()
            if row is None:
                d.execute("""
                    INSERT INTO packages
                        (scheme_id, package_no, package_name, package_status,
                         executing_agency, is_scheme_mirror, extra_fields)
                    VALUES (%s, 1, 'Main Package', 'in_progress', %s, TRUE, %s::jsonb)
                    RETURNING package_id
                """, (sid, p["contractor_name"], source_meta))
                row = d.fetchone()
            pkg = row["package_id"]
            pkg_by_scheme[sid] = pkg
            created += 1
            proj_scheme[p["id"]], proj_pkg[p["id"]] = sid, pkg
        else:
            sid, pkg = target
            pkg = pkg or pkg_by_scheme.get(sid)
            if pkg is None:
                d.execute("""
                    INSERT INTO packages (scheme_id, package_no, package_name,
                        package_status, is_scheme_mirror, extra_fields)
                    VALUES (%s, 1, 'Main Package', 'in_progress', TRUE, %s::jsonb)
                    RETURNING package_id
                """, (sid, MARK))
                pkg = d.fetchone()["package_id"]
                pkg_by_scheme[sid] = pkg
            matched += 1
            proj_scheme[p["id"]], proj_pkg[p["id"]] = sid, pkg

    print(f"== projects mapped: {matched} matched, {created} created ==")

    source_refs: dict[int, dict[str, list]] = {}
    package_refs: dict[int, dict[str, list]] = {}
    for p in fr_projects:
        sid = proj_scheme[p["id"]]
        pkg = proj_pkg[p["id"]]
        source_refs.setdefault(sid, {"ids": [], "uids": []})["ids"].append(p["id"])
        source_refs[sid]["uids"].append(p["unique_id"])
        package_refs.setdefault(pkg, {"ids": [], "uids": []})["ids"].append(p["id"])
        package_refs[pkg]["uids"].append(p["unique_id"])

    for sid, refs in source_refs.items():
        d.execute("""
            UPDATE scheme_master
            SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
                || jsonb_build_object(
                    'friend_project_ids', %s::jsonb,
                    'friend_unique_ids', %s::jsonb
                )
            WHERE scheme_id = %s
        """, (json.dumps(refs["ids"]), json.dumps(refs["uids"]), sid))
    for pkg, refs in package_refs.items():
        d.execute("""
            UPDATE packages
            SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
                || jsonb_build_object(
                    'friend_project_ids', %s::jsonb,
                    'friend_unique_ids', %s::jsonb
                )
            WHERE package_id = %s
        """, (json.dumps(refs["ids"]), json.dumps(refs["uids"]), pkg))
    dst.commit()

    # -------------------------------------------- enrich masters (NULLs only)
    def num(v):
        try:
            f = float(str(v).replace(",", "").strip())
            return f if f >= 0 else None
        except (TypeError, ValueError):
            return None

    enriched = 0
    for p in fr_projects:
        sid, pkg = proj_scheme.get(p["id"]), proj_pkg.get(p["id"])
        if not sid:
            continue
        completion = (dt(p["schedule_completion"])
                      or dt(p.get("master_schedule_completion_date"))
                      or dt(p.get("master_expected_completion_date")))
        cost = num(p.get("master_gross_cost")) or num(p.get("stage2_cost")) or num(p.get("stage1_cost"))
        ptype = "corporate" if "corporate" in (p["project_type"] or "").lower() else "plant"
        d.execute("""
            UPDATE scheme_master SET
                scheme_type            = %s,
                planned_completion_date = COALESCE(planned_completion_date, %s),
                estimated_cost_cr       = COALESCE(estimated_cost_cr, %s),
                planned_start_date      = COALESCE(planned_start_date, %s)
            WHERE scheme_id = %s
        """, (ptype, completion, cost, dt(p.get("effective_date")), sid))
        if pkg:
            d.execute("""
                UPDATE packages SET
                    planned_end_date   = COALESCE(planned_end_date, %s),
                    planned_start_date = COALESCE(planned_start_date, %s),
                    executing_agency   = COALESCE(executing_agency, %s),
                    project_manager_name = COALESCE(project_manager_name, %s)
                WHERE package_id = %s
            """, (completion, dt(p.get("effective_date")),
                  (p.get("contractor_name") or p.get("master_executing_agency") or None),
                  p.get("project_manager_name") or None, pkg))
        enriched += 1
    print(f"== master data enriched for {enriched} schemes (NULL fields only) ==")
    dst.commit()

    # ------------------------------------------------------------- UOM cache
    d.execute("SELECT uom_id, uom_code FROM uom_master")
    uoms = {r["uom_code"].upper(): r["uom_id"] for r in d.fetchall()}

    def uom_id(raw):
        if not raw:
            return None
        code = re.sub(r"[.\s]", "", raw).upper()
        code = UOM_NORMALIZE.get(code, code)[:20]
        if code not in uoms:
            d.execute("""INSERT INTO uom_master (uom_code, uom_name, is_active)
                         VALUES (%s, %s, TRUE) RETURNING uom_id""", (code, raw.strip()))
            uoms[code] = d.fetchone()["uom_id"]
        return uoms[code]

    # ------------------------------------------------- plans + activities
    s.execute("SELECT * FROM plans ORDER BY id")
    fr_plans = s.fetchall()
    plan_map: dict[int, int] = {}       # friend plan id -> my plan_id
    default_plan: dict[int, int] = {}   # friend project id -> my plan_id
    latest_plan_id = {}
    for fp in fr_plans:
        latest_plan_id[fp["project_id"]] = max(
            fp["id"], latest_plan_id.get(fp["project_id"], fp["id"])
        )

    plan_packages = sorted({proj_pkg[fp["project_id"]] for fp in fr_plans
                            if fp["project_id"] in proj_pkg})
    if plan_packages:
        d.execute("""
            UPDATE progress_plans
            SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE package_id = ANY(%s)
        """, (plan_packages,))

    for fp in fr_plans:
        pkg = proj_pkg.get(fp["project_id"])
        if not pkg:
            continue
        d.execute("""
            INSERT INTO progress_plans
                (package_id, plan_name, plan_type, financial_year, plan_version,
                 is_current, is_locked, extra_fields)
            VALUES (%s, %s, 'execution', %s, %s, %s, %s, %s::jsonb)
            RETURNING plan_id
        """, (
            pkg, fp["plan_name"], fp["financial_year"], fp["plan_version"],
            fp["id"] == latest_plan_id[fp["project_id"]],
            source_bool(fp.get("is_locked")), MARK,
        ))
        plan_map[fp["id"]] = d.fetchone()["plan_id"]
        if fp["id"] == latest_plan_id[fp["project_id"]]:
            default_plan[fp["project_id"]] = plan_map[fp["id"]]

    # friend activities: keyed by (project, plan_name-ish). Their monthly rows
    # reference (project_id, activity_type, plan_type, plan_name).
    fr_plan_lookup = {}   # (project_id, plan_version_or_name) -> my plan_id
    source_plan_lookup = {}
    for fp in fr_plans:
        mine = plan_map.get(fp["id"])
        if mine:
            fr_plan_lookup[(fp["project_id"], (fp["plan_name"] or "").strip())] = mine
            fr_plan_lookup[(fp["project_id"], (fp["plan_version"] or "").strip())] = mine
            source_plan_lookup[(fp["project_id"], (fp["plan_name"] or "").strip())] = fp["id"]

    s.execute("""
        SELECT a.project_id, a.activity_type, p.id AS plan_id,
               COALESCE(SUM(da.actual_qty), 0) AS actual_qty
        FROM activities a
        JOIN plans p ON p.project_id = a.project_id AND p.plan_name = a.plan_name
        LEFT JOIN daily_actuals da ON da.activity_id = a.id
        GROUP BY a.project_id, a.activity_type, p.id
    """)
    source_actuals_by_plan = {
        (row["project_id"], (row["activity_type"] or "").strip(), row["plan_id"]):
            float(row["actual_qty"] or 0)
        for row in s.fetchall()
    }

    def plan_for(project_id, plan_name, plan_type):
        for key in [(project_id, (plan_name or "").strip()),
                    (project_id, (plan_type or "").strip())]:
            if key in fr_plan_lookup:
                return fr_plan_lookup[key]
        if project_id in default_plan:
            return default_plan[project_id]
        pkg = proj_pkg.get(project_id)
        if not pkg:
            return None
        d.execute("""
            INSERT INTO progress_plans (package_id, plan_name, plan_type,
                is_current, is_locked, extra_fields)
            VALUES (%s, 'Imported Plan', 'execution', TRUE, TRUE, %s::jsonb)
            RETURNING plan_id
        """, (pkg, MARK))
        default_plan[project_id] = d.fetchone()["plan_id"]
        return default_plan[project_id]

    s.execute("SELECT * FROM activities ORDER BY id")
    fr_acts = s.fetchall()
    act_map: dict[int, int] = {}                       # friend act id -> mine
    act_by_key: dict[tuple, int] = {}                  # (proj, act_type) -> mine
    n_act = 0
    for i, fa in enumerate(fr_acts):
        my_plan = plan_for(fa["project_id"], fa.get("plan_name"), fa.get("plan_type"))
        if not my_plan:
            continue
        full = (fa["activity_type"] or "Activity").strip()
        if "->" in full:
            cat, name = [x.strip() for x in full.split("->", 1)]
        else:
            cat, name = None, full
        source_plan_id = source_plan_lookup.get(
            (fa["project_id"], (fa.get("plan_name") or "").strip())
        )
        # Keep the source snapshot exact.  Earlier-plan actuals remain in their
        # own archived/imported plan; folding them into the latest plan changes
        # the friend's weighted physical-progress figures.
        carry_forward = float(fa["actuals_till_last_fy"] or 0)
        d.execute("""
            INSERT INTO plan_activities
                (plan_id, activity_name, activity_category, uom_id, scope_qty,
                 weight_pct, planned_start_date, planned_finish_date,
                 actuals_till_last_fy, expected_finish_date, sort_order,
                 extra_fields)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
            RETURNING activity_id
        """, (my_plan, name[:255], cat, uom_id(fa["uom"]), fa["scope_qty"],
              min(float(fa["weight_percent"] or 0), 999.99),
              dt(fa["start_date"]), dt(fa["finish_date"]),
              carry_forward, dt(fa["expected_finish"]), i, MARK))
        aid = d.fetchone()["activity_id"]
        act_map[fa["id"]] = aid
        act_by_key[(fa["project_id"], full)] = aid
        act_by_key.setdefault((fa["project_id"], full,
                               (fa.get("plan_name") or "").strip()), aid)
        n_act += 1
    print(f"== plan_activities imported: {n_act} ==")
    dst.commit()

    # ------------------------------------------------------- monthly plans
    s.execute("SELECT * FROM monthly_plans")
    n_m = miss_m = 0
    for mp in s.fetchall():
        aid = (act_by_key.get((mp["project_id"], (mp["activity_type"] or "").strip(),
                               (mp.get("plan_name") or "").strip()))
               or act_by_key.get((mp["project_id"], (mp["activity_type"] or "").strip())))
        md = month_to_date(mp["month"])
        if not aid or not md:
            miss_m += 1
            continue
        d.execute("""
            INSERT INTO monthly_plan_entries (activity_id, month_date, planned_qty, row_type)
            VALUES (%s, %s, %s, 'plan')
            ON CONFLICT (activity_id, month_date, row_type)
            DO UPDATE SET planned_qty = monthly_plan_entries.planned_qty + EXCLUDED.planned_qty
        """, (aid, md, mp["planned_qty"] or 0))
        n_m += 1
    print(f"== monthly_plan_entries: {n_m} imported, {miss_m} unmatched ==")

    # -------------------------------------------------------- daily actuals
    s.execute("SELECT * FROM daily_actuals")
    n_da = miss_da = 0
    for da in s.fetchall():
        aid = act_map.get(da["activity_id"])
        if not aid or not da["actual_date"]:
            miss_da += 1
            continue
        d.execute("""
            INSERT INTO daily_actuals (activity_id, actual_date, actual_qty,
                                       area_of_work, remarks, entered_via)
            VALUES (%s,%s,%s,%s,%s,'web')
            ON CONFLICT (activity_id, actual_date) DO NOTHING
        """, (aid, dt(da["actual_date"]), da["actual_qty"] or 0,
              da["area_of_work"], da["remarks"]))
        n_da += 1
    print(f"== daily_actuals: {n_da} imported, {miss_da} unmatched ==")
    dst.commit()

    # ------------------------------------------------------------ appendix2
    s.execute("SELECT * FROM appendix2 ORDER BY project_id, id")
    rows = s.fetchall()
    by_proj: dict[int, list] = {}
    for r in rows:
        by_proj.setdefault(r["project_id"], []).append(r)

    n_a2 = 0
    appendix_item_map: dict[int, int] = {}
    for pid, items in by_proj.items():
        sid, pkg = proj_scheme.get(pid), proj_pkg.get(pid)
        if not sid:
            continue
        d.execute("""SELECT COALESCE(MAX(revision_no), 0) + 1 AS n
                     FROM appendix2_revisions WHERE scheme_id=%s
                       AND package_id IS NOT DISTINCT FROM %s""", (sid, pkg))
        rev_no = d.fetchone()["n"]
        d.execute("""UPDATE appendix2_revisions SET is_current = FALSE
                     WHERE scheme_id=%s AND package_id IS NOT DISTINCT FROM %s""",
                  (sid, pkg))
        d.execute("""
            INSERT INTO appendix2_revisions (scheme_id, package_id, revision_label,
                revision_no, is_current, is_locked, source, description, extra_fields)
            VALUES (%s,%s,%s,%s,TRUE,TRUE,'imported','Imported schedule', %s::jsonb)
            RETURNING revision_id
        """, (sid, pkg, f"R{rev_no}", rev_no, MARK))
        rev = d.fetchone()["revision_id"]

        cat_ids: dict[str, int] = {}
        for i, it in enumerate(items):
            cat = (it["category"] or "General").strip()
            if cat not in cat_ids:
                d.execute("""
                    INSERT INTO appendix2_items (revision_id, is_category, item_name,
                        category, sort_order, source, extra_fields)
                    VALUES (%s, TRUE, %s, %s, %s, 'imported', %s::jsonb)
                    RETURNING item_id
                """, (rev, cat[:300], cat[:120], i * 100, MARK))
                cat_ids[cat] = d.fetchone()["item_id"]
            comm = float(it["commencement_months"] or 0)
            comp = max(float(it["completion_months"] or 0), comm)
            d.execute("""
                INSERT INTO appendix2_items (revision_id, parent_item_id, is_category,
                    s_no, category, item_name, commencement_months, completion_months,
                    schedule_start, schedule_finish, sort_order, source, extra_fields)
                VALUES (%s,%s,FALSE,%s,%s,%s,%s,%s,%s,%s,%s,'imported',%s::jsonb)
                RETURNING item_id
            """, (rev, cat_ids[cat], str(it["s_no"] or "")[:20], cat[:120],
                  (it["item"] or "Item")[:300], comm, comp,
                  dt(it["schedule_start"]), dt(it["schedule_finish"]), i * 100 + 1, MARK))
            appendix_item_map[it["id"]] = d.fetchone()["item_id"]
            n_a2 += 1
    print(f"== appendix2_items imported: {n_a2} across {len(by_proj)} projects ==")
    dst.commit()

    # -------------------------------------------------------------- billing
    s.execute("SELECT * FROM billing_schedule ORDER BY project_id, milestone_no, id")
    n_b = 0
    next_no: dict[int, int] = {}
    for b in s.fetchall():
        pkg = proj_pkg.get(b["project_id"])
        if not pkg:
            continue
        if pkg not in next_no:
            d.execute("""SELECT COALESCE(MAX(milestone_no),0) AS n
                         FROM billing_schedules WHERE package_id=%s""", (pkg,))
            next_no[pkg] = d.fetchone()["n"]
        next_no[pkg] += 1
        extra = json.loads(MARK)
        extra.update({
            "milestone_type": b.get("milestone_type"),
            "weightage_percent": float(b["weightage_percent"]) if b.get("weightage_percent") else None,
            "clearances": {
                "manufacturing": b.get("manufacturing_clearance"),
                "inspection": b.get("inspection_clearance"),
                "dispatch": b.get("dispatch_clearance"),
                "approval": b.get("approval_clearance"),
                "site_receipt": b.get("site_receipt_clearance"),
            },
        })
        d.execute("""
            INSERT INTO billing_schedules (package_id, milestone_no, description,
                scheduled_amount_cr, scheduled_date, actual_amount_cr,
                actual_billed_date, payment_received_date, is_billed, is_paid,
                appendix2_item_id, remarks, extra_fields)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
        """, (pkg, next_no[pkg], b["description"] or f"Milestone {next_no[pkg]}",
              b["scheduled_amount"] or 0, dt(b["scheduled_date"]),
              b["billed_amount"] or None, dt(b["billed_date"]), dt(b["received_date"]),
              bool(dt(b["billed_date"])), bool(dt(b["received_date"])),
              appendix_item_map.get(b.get("appendix2_id")), b["remarks"], json.dumps(extra)))
        n_b += 1
    print(f"== billing_schedules imported: {n_b} ==")
    dst.commit()

    # ----------------------------------------- plant progress + CAPEX history
    s.execute("""
        SELECT d.*,
               (SELECT MAX(m.updated_at)
                  FROM plant_level_amr_monthly m
                 WHERE m.project_id = d.project_id) AS snapshot_at
        FROM plant_level_amr_details d
        ORDER BY d.project_id
    """)
    plant_details = s.fetchall()
    capex_row_by_project: dict[int, int] = {}
    n_progress = n_capex_values = 0

    for detail in plant_details:
        project_id = detail["project_id"]
        sid, pkg = proj_scheme.get(project_id), proj_pkg.get(project_id)
        if not sid or not pkg:
            continue

        physical_progress = num(detail.get("physical_progress"))
        if physical_progress is not None:
            snapshot_at = detail.get("snapshot_at")
            snapshot_month = date(
                snapshot_at.year if snapshot_at else 2026,
                snapshot_at.month if snapshot_at else 5,
                1,
            )
            d.execute("""
                INSERT INTO plant_progress_monthly (
                    package_id, month_date, planned_progress_pct,
                    actual_progress_pct, cumulative_planned_pct,
                    cumulative_actual_pct, risk_level, notes
                ) VALUES (%s, %s, 0, %s, 0, %s, 'unknown', %s)
                ON CONFLICT (package_id, month_date) DO UPDATE SET
                    actual_progress_pct = EXCLUDED.actual_progress_pct,
                    cumulative_actual_pct = EXCLUDED.cumulative_actual_pct,
                    notes = EXCLUDED.notes,
                    computed_at = CURRENT_TIMESTAMP
            """, (
                pkg, snapshot_month, min(physical_progress, 100),
                min(physical_progress, 100),
                f"friend_import physical snapshot; source project {project_id}",
            ))
            n_progress += 1

        d.execute("""
            SELECT r.id
            FROM capex_plan_rows r
            JOIN capex_plan_header h ON h.id = r.plan_id
            WHERE r.scheme_id = %s AND r.row_level = 'Item'
            ORDER BY h.is_effective DESC, h.id DESC, r.id DESC
            LIMIT 1
        """, (sid,))
        capex_row = d.fetchone()
        if capex_row is None:
            continue

        row_id = capex_row["id"]
        capex_row_by_project[project_id] = row_id
        d.execute("""
            INSERT INTO capex_plan_values (
                plan_row_id, gross_cost, cumulative_exp_till_last_fy, be_fy, re_fy
            ) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (plan_row_id) DO UPDATE SET
                gross_cost = EXCLUDED.gross_cost,
                cumulative_exp_till_last_fy = EXCLUDED.cumulative_exp_till_last_fy,
                be_fy = EXCLUDED.be_fy,
                re_fy = EXCLUDED.re_fy
        """, (
            row_id,
            num(detail.get("gross_cost")) or 0,
            num(detail.get("capex_till_last_fy")) or 0,
            num(detail.get("be_amount")) or 0,
            num(detail.get("re_amount")) or 0,
        ))
        n_capex_values += 1

    s.execute("SELECT * FROM plant_level_amr_monthly ORDER BY project_id, id")
    n_capex_months = n_capex_actuals = skipped_capex_months = 0
    for monthly in s.fetchall():
        row_id = capex_row_by_project.get(monthly["project_id"])
        month_date = month_to_date(monthly["month"])
        if not row_id or not month_date:
            skipped_capex_months += 1
            continue

        fy_year = monthly["financial_year"] or f"{month_date.year}-{str(month_date.year + 1)[-2:]}"
        fy_match = re.match(r"^(\d{4})-(\d{4})$", fy_year)
        if fy_match:
            fy_year = f"{fy_match.group(1)}-{fy_match.group(2)[-2:]}"
        d.execute("""
            INSERT INTO capex_month_values (
                plan_row_id, month_no, be_amount, re_amount, actual_amount
            ) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (plan_row_id, month_no) DO UPDATE SET
                be_amount = EXCLUDED.be_amount,
                re_amount = EXCLUDED.re_amount,
                actual_amount = EXCLUDED.actual_amount
        """, (
            row_id, month_date.month, monthly["be_cr"] or 0,
            monthly["re_cr"] or 0, monthly["actual_cr"] or 0,
        ))
        n_capex_months += 1

        d.execute("""
            INSERT INTO capex_actuals (
                plan_row_id, month_no, fy_year, amount, created_by, updated_by
            ) VALUES (%s, %s, %s, %s, 'friend_import', 'friend_import')
            ON CONFLICT (plan_row_id, month_no) DO UPDATE SET
                fy_year = EXCLUDED.fy_year,
                amount = EXCLUDED.amount,
                updated_by = 'friend_import',
                updated_at = CURRENT_TIMESTAMP
        """, (row_id, month_date.month, fy_year, monthly["actual_cr"] or 0))
        n_capex_actuals += 1

    print(
        "== plant data: "
        f"{n_progress} physical snapshots, {n_capex_values} CAPEX rows, "
        f"{n_capex_months} monthly values/actuals, {skipped_capex_months} orphan rows skipped =="
    )
    dst.commit()

    # ---------------------------------------- authoritative CAPEX plan sheet
    # The source dashboard derives project cost from the effective CAPEX sheet,
    # not from projects.stage*_cost. Importing it also fills corporate monthly
    # BE/RE/actual values which do not exist in plant_level_amr_monthly.
    s.execute("""
        SELECT financial_year, rows_json
        FROM capex_plans
        ORDER BY effective DESC, updated_at DESC
        LIMIT 1
    """)
    capex_plan = s.fetchone()
    capex_rows = json.loads(capex_plan["rows_json"] or "[]") if capex_plan else []
    source_capex_parent = {}
    for parent in capex_rows:
        for child_id in parent.get("children") or []:
            source_capex_parent[child_id] = parent.get("row_id")
    projects_with_children = {
        p["parent_project_id"] for p in fr_projects if p.get("parent_project_id")
    }

    capex_values = 0
    capex_months = 0
    source_cost_by_scheme: dict[int, float] = {}
    fy_year = re.sub(r"^FY\s*", "", (capex_plan or {}).get("financial_year", ""))
    fy_match = re.match(r"^(\d{4})-(\d{4})$", fy_year)
    if fy_match:
        fy_year = f"{fy_match.group(1)}-{fy_match.group(2)[-2:]}"

    d.execute("""
        SELECT id FROM capex_plan_header
        WHERE fy_year = %s
        ORDER BY is_effective DESC, id DESC
        LIMIT 1
    """, (fy_year,))
    target_plan = d.fetchone()
    if not target_plan:
        raise RuntimeError(f"No CAPEX plan header for {fy_year}")
    target_plan_id = target_plan["id"]
    d.execute("DELETE FROM capex_plan_rows WHERE plan_id = %s", (target_plan_id,))

    capex_row_map = {}
    for display_order, source_row in enumerate(capex_rows):
        values = source_row.get("values") or {}
        source_id = source_row.get("row_id")
        parent_id = capex_row_map.get(source_capex_parent.get(source_id))
        project_id = source_row.get("source_project_id")
        scheme_id = proj_scheme.get(project_id)
        d.execute("""
            INSERT INTO capex_plan_rows (
                plan_id, parent_row_id, scheme_id, row_name, row_level,
                indent_level, display_order, is_imported
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 1)
            RETURNING id
        """, (
            target_plan_id, parent_id, scheme_id,
            values.get("CAPEX Plan (FY)") or f"Row {source_id}",
            source_row.get("level") or "Item",
            int(source_row.get("indent") or 0), display_order,
        ))
        row_id = d.fetchone()["id"]
        capex_row_map[source_id] = row_id

        d.execute("""
            INSERT INTO capex_plan_values (
                plan_row_id, gross_cost, cumulative_exp_till_last_fy, be_fy, re_fy
            ) VALUES (%s, %s, %s, %s, %s)
        """, (
            row_id,
            num(values.get("Gross Cost")) or 0,
            num(values.get("Cummulative Expenditure till Last FY")) or 0,
            num(values.get("BE (FY)")) or 0,
            num(values.get("RE (FY)")) or 0,
        ))
        capex_values += 1

        month_cells = {}
        for key, raw_value in values.items():
            match = re.match(r"^([A-Za-z]{3})-(\d{2}) (BE|RE|Actual)$", key)
            if not match:
                continue
            month_no = MONTH_ABBR.get(match.group(1).title())
            if not month_no:
                continue
            month_cells.setdefault(month_no, {"BE": 0, "RE": 0, "Actual": 0})[
                match.group(3)
            ] = num(raw_value) or 0

        for month_no, cell in month_cells.items():
            d.execute("""
                INSERT INTO capex_month_values (
                    plan_row_id, month_no, be_amount, re_amount, actual_amount
                ) VALUES (%s, %s, %s, %s, %s)
            """, (row_id, month_no, cell["BE"], cell["RE"], cell["Actual"]))
            d.execute("""
                INSERT INTO capex_actuals (
                    plan_row_id, month_no, fy_year, amount, created_by, updated_by
                ) VALUES (%s, %s, %s, %s, 'friend_import', 'friend_import')
            """, (row_id, month_no, fy_year, cell["Actual"]))
            capex_months += 1

        # Friend dashboard counts leaf projects and uses numeric CAPEX gross cost.
        if (source_row.get("level") == "Item" and project_id in proj_scheme
                and project_id not in projects_with_children):
            sid = proj_scheme[project_id]
            source_cost_by_scheme[sid] = (
                source_cost_by_scheme.get(sid, 0) + (num(values.get("Gross Cost")) or 0)
            )

    for sid, gross_cost in source_cost_by_scheme.items():
        d.execute("""
            UPDATE scheme_master
            SET estimated_cost_cr = %s, updated_at = CURRENT_TIMESTAMP
            WHERE scheme_id = %s
        """, (gross_cost, sid))

    print(
        "== effective CAPEX plan: "
        f"{capex_values} hierarchy rows, {capex_months} monthly rows, "
        f"{len(source_cost_by_scheme)} scheme costs reconciled =="
    )
    dst.commit()

    # CPM import intentionally omitted (user decision: keep own CPM data).

    src.close()
    dst.close()
    print("DONE")


if __name__ == "__main__":
    main()
