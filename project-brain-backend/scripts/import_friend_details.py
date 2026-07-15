"""Import approval / contract detail fields from the friend's DB export into
the t5 tables (stage1_approvals, stage2_approvals, contracts).

Why: the RSP_FULL_SEED that created scheme_master/packages/plans never carried
over the friend's per-project detail columns (stage1_date/stage2_date/loa_date/
effective_date/schedule_completion/costs), so the PMC and physical-financial
reports showed "-" for approval/award/completion. This script parses the
`projects` COPY block of project_brain_export.sql and fills the t5 homes using
the friend_project_ids mapping stored in extra_fields.

Friend's report logic (report_routes.py):
    Date of approval  = projects.stage2_date
    Date of award     = projects.effective_date (contract effective date)
Homes here:
    stage2_approvals.sanction_date   <- stage2_date       (per scheme, parent row)
    stage1_approvals.sanction_date   <- stage1_date
    contracts.effective_date/loa_date/schedule_completion <- per package

Idempotent: rows tagged extra_fields.source='friend_import' are replaced on
re-run; hand-entered rows are left alone.

Run:  .venv/Scripts/python.exe scripts/import_friend_details.py
"""

from __future__ import annotations

import io
import json
import os
import sys
from datetime import datetime

import psycopg2

EXPORT = os.path.join(os.path.dirname(__file__), "..", "..",
                      "Friend project", "Project Brain", "project_brain_export.sql")
NULL = "\\" + "N"
TAG = json.dumps({"source": "friend_import"})


def parse_export(path):
    cols, rows = None, {}
    with io.open(path, encoding="utf-8") as f:
        in_copy = False
        for line in f:
            if line.startswith("COPY public.projects "):
                cols = line.split("(")[1].split(")")[0].split(", ")
                in_copy = True
                continue
            if in_copy:
                if line.strip() == "\\.":
                    break
                parts = line.rstrip("\n").split("\t")
                rows[int(parts[0])] = parts
    idx = {c: i for i, c in enumerate(cols)}

    def get(pid, col):
        row = rows.get(pid)
        if not row:
            return None
        v = row[idx[col]]
        if v in (NULL, "", None):
            return None
        return v

    return rows, get


def parse_date(value):
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value.strip()[:10], fmt).date()
        except ValueError:
            continue
    return None


def parse_float(value):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def parse_int(value):
    try:
        return int(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def main():
    rows, get = parse_export(EXPORT)
    print(f"parsed {len(rows)} friend projects from export")

    conn = psycopg2.connect(dbname="project_brain", user="postgres",
                            password="postgres", host="localhost")
    cur = conn.cursor()

    # ── schemes → stage1/stage2 approvals ────────────────────────────────────
    cur.execute("""
        SELECT scheme_id, scheme_name, extra_fields->'friend_project_ids'
        FROM scheme_master
        WHERE extra_fields ? 'friend_project_ids' AND NOT is_deleted
    """)
    schemes = cur.fetchall()
    s1 = s2 = 0
    for scheme_id, scheme_name, friend_ids in schemes:
        friend_ids = [int(x) for x in (friend_ids or [])]
        if not friend_ids:
            continue
        # parent project = mapped row without parent_project_id, else first mapped
        parent = next((pid for pid in friend_ids if rows.get(pid) and not get(pid, "parent_project_id")),
                      friend_ids[0])

        stage1_date = parse_date(get(parent, "stage1_final_date") or get(parent, "stage1_date"))
        stage1_cost = parse_float(get(parent, "stage1_cost"))
        cod_date = parse_date(get(parent, "cod_date"))
        if stage1_date or stage1_cost or cod_date:
            cur.execute("""
                SELECT COUNT(*) FROM stage1_approvals
                WHERE scheme_id=%s AND NOT is_deleted
                  AND COALESCE(extra_fields->>'source','') <> 'friend_import'
            """, (scheme_id,))
            if cur.fetchone()[0] == 0:
                cur.execute("DELETE FROM stage1_approvals WHERE scheme_id=%s AND extra_fields->>'source'='friend_import'", (scheme_id,))
                cur.execute("""
                    INSERT INTO stage1_approvals
                        (scheme_id, revision_no, revision_label, is_current, cod_date,
                         corporate_pag_date, chairman_approval_date, sail_board_date,
                         sanction_date, cost_gross_cr, is_deleted, extra_fields)
                    VALUES (%s, 1, 'Original', TRUE, %s, %s, %s, %s, %s, %s, FALSE, %s::jsonb)
                """, (scheme_id, cod_date,
                      parse_date(get(parent, "corporate_pag_date")),
                      parse_date(get(parent, "chairman_approval_date")),
                      parse_date(get(parent, "board_approval_date")),
                      stage1_date, stage1_cost, TAG))
                s1 += 1

        stage2_date = parse_date(get(parent, "stage2_approval_date") or get(parent, "stage2_date"))
        stage2_cost = parse_float(get(parent, "stage2_cost") or get(parent, "master_gross_cost"))
        if stage2_date or stage2_cost:
            cur.execute("""
                SELECT COUNT(*) FROM stage2_approvals
                WHERE scheme_id=%s AND NOT is_deleted
                  AND COALESCE(extra_fields->>'source','') <> 'friend_import'
            """, (scheme_id,))
            if cur.fetchone()[0] == 0:
                cur.execute("DELETE FROM stage2_approvals WHERE scheme_id=%s AND extra_fields->>'source'='friend_import'", (scheme_id,))
                cur.execute("""
                    INSERT INTO stage2_approvals
                        (scheme_id, revision_no, revision_label, is_current,
                         sanction_date, order_date, firmed_up_cost_gross_cr,
                         is_deleted, extra_fields)
                    VALUES (%s, 1, 'Original', TRUE, %s, %s, %s, FALSE, %s::jsonb)
                """, (scheme_id, stage2_date,
                      parse_date(get(parent, "loa_issue_date") or get(parent, "loa_date")),
                      stage2_cost, TAG))
                s2 += 1

    # ── packages → contracts ─────────────────────────────────────────────────
    cur.execute("""
        SELECT package_id, package_name, extra_fields->'friend_project_ids'
        FROM packages
        WHERE extra_fields ? 'friend_project_ids' AND NOT is_deleted
    """)
    packages = cur.fetchall()
    c = 0
    for package_id, package_name, friend_ids in packages:
        friend_ids = [int(x) for x in (friend_ids or [])]
        # pick the mapped row that actually carries contract data (child rows
        # hold the contract; the parent aggregate usually doesn't)
        best = None
        for pid in friend_ids:
            if not rows.get(pid):
                continue
            has_contract = any(get(pid, k) for k in
                               ("effective_date", "loa_date", "contractor_name", "schedule_completion"))
            is_child = bool(get(pid, "parent_project_id"))
            score = (2 if has_contract else 0) + (1 if is_child else 0)
            if best is None or score > best[0]:
                best = (score, pid)
        if not best or best[0] == 0:
            continue
        pid = best[1]
        effective = parse_date(get(pid, "effective_date"))
        loa = parse_date(get(pid, "loa_date") or get(pid, "loa_issue_date"))
        completion = parse_date(get(pid, "schedule_completion")
                                or get(pid, "master_schedule_completion_date"))
        expected = parse_date(get(pid, "expected_finish")
                              or get(pid, "master_expected_completion_date")
                              or get(pid, "master_revised_completion_date"))
        contractor = (get(pid, "contractor_name") or get(pid, "master_executing_agency") or "").strip()
        if not (effective or loa or contractor):
            continue
        cur.execute("""
            SELECT COUNT(*) FROM contracts
            WHERE package_id=%s AND NOT is_deleted
              AND COALESCE(extra_fields->>'source','') <> 'friend_import'
        """, (package_id,))
        if cur.fetchone()[0] > 0:
            continue
        cur.execute("DELETE FROM contracts WHERE package_id=%s AND extra_fields->>'source'='friend_import'", (package_id,))
        cur.execute("""
            INSERT INTO contracts
                (package_id, contract_no, contractor_name, contract_value_cr,
                 loa_date, effective_date, contract_duration_months,
                 schedule_completion_date, expected_completion_date,
                 is_active, is_deleted, extra_fields)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, FALSE, %s::jsonb)
        """, (package_id,
              get(pid, "unique_id") or f"FRIEND-{pid}",
              contractor[:500],
              parse_float(get(pid, "stage2_cost")),
              loa, effective,
              parse_int(get(pid, "schedule_months")),
              completion, expected or completion, TAG))
        c += 1

    conn.commit()
    print(f"inserted: stage1_approvals={s1}, stage2_approvals={s2}, contracts={c}")
    cur.execute("SELECT COUNT(*) FROM stage1_approvals"); print("stage1 total:", cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM stage2_approvals"); print("stage2 total:", cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM contracts"); print("contracts total:", cur.fetchone()[0])
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
