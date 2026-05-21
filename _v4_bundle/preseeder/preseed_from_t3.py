"""
PROJECT BRAIN — V4 Preseeder
Loads from t3.sql (PG18 custom-format dump) into v4 schema.

Requires: pip install pgdumplib psycopg2-binary

Usage:
    python preseed_from_t3.py \
        --t3-file /path/to/t3.sql \
        --target "postgresql://postgres:abc123@127.0.0.1:5433/project_brain"

What gets loaded:
    • 74 schemes  (scheme_master)
    • 76 packages (packages — the 1st of each scheme becomes auto-mirror, real packages added)
    • 36 execution templates → appendix2_templates + appendix2_template_items
    • 16 activity_master_global rows
    • 13 uom_master rows
    • 6 custom_field_definitions
    • 30 role_permissions (already in seed, skip duplicates)
"""
from __future__ import annotations
import argparse, sys, json
from decimal import Decimal
from datetime import date, datetime
import pgdumplib
import psycopg2
import psycopg2.extras


def to_decimal(v):
    if v is None or v == '': return None
    try: return Decimal(str(v))
    except: return None


def to_date(v):
    if not v: return None
    if isinstance(v, (date, datetime)): return v if isinstance(v, date) else v.date()
    s = str(v).strip()
    if not s or s.lower() in ('null', 'none', 'nan'): return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%Y/%m/%d'):
        try: return datetime.strptime(s, fmt).date()
        except ValueError: continue
    return None


def to_jsonb(v):
    if v is None: return '{}'
    if isinstance(v, str):
        try: json.loads(v); return v
        except: return '{}'
    return json.dumps(v)


def to_bool(v):
    if v in (None, ''): return False
    if isinstance(v, bool): return v
    if isinstance(v, str): return v.lower() in ('t', 'true', '1', 'yes', 'y')
    return bool(v)


import re
def find_column_order(dump, table_name):
    """Get the column order from the COPY statement (the source of truth for data rows)."""
    for e in dump.entries:
        if e.desc == 'TABLE DATA' and e.tag == table_name:
            m = re.search(r'COPY\s+\S+\s*\(([^)]+)\)', e.copy_stmt)
            if m:
                return [c.strip() for c in m.group(1).split(',')]
    return []


def load_scheme_master(dump, cur):
    print("[1/6] Loading scheme_master...")
    cols = find_column_order(dump, 'scheme_master')
    rows = list(dump.table_data('public', 'scheme_master'))
    print(f"      Found {len(rows)} rows, {len(cols)} cols: {cols[:5]}...")

    inserted, skipped = 0, 0
    legacy_to_new = {}
    for raw in rows:
        # Convert tuple of strings to dict
        d = dict(zip(cols, raw))
        cur.execute("SAVEPOINT sm_row")
        try:
            cur.execute("""
                INSERT INTO scheme_master
                    (scheme_code, scheme_name, scheme_type, current_status,
                     wbs_element, ipm_fa_code, amr_no,
                     estimated_cost_cr, sanctioned_cost_cr, anticipated_cost_cr,
                     scheme_owner_name, scheme_owner_designation,
                     steering_committee_chair, finance_controller,
                     has_multiple_packages, extra_fields, created_by)
                VALUES (%s,%s,%s,%s, %s,%s,%s,
                        %s,%s,%s, %s,%s,%s,%s, %s, %s::jsonb, 1)
                ON CONFLICT (scheme_code) DO UPDATE SET
                    scheme_name=EXCLUDED.scheme_name,
                    current_status=EXCLUDED.current_status
                RETURNING scheme_id
            """, (
                d.get('scheme_code') or f"LEGACY-{d['scheme_id']}",
                d['scheme_name'],
                (d.get('scheme_type') or 'corporate').lower(),
                map_scheme_status(d.get('current_status')),
                d.get('wbs_element'), d.get('ipm_fa_code'), d.get('amr_no'),
                to_decimal(d.get('estimated_cost_cr')),
                to_decimal(d.get('sanctioned_cost_cr')),
                to_decimal(d.get('anticipated_cost_cr')),
                d.get('scheme_owner_name'), d.get('scheme_owner_designation'),
                d.get('steering_committee_chair'), d.get('finance_controller'),
                to_bool(d.get('has_multiple_packages')),
                to_jsonb(d.get('extra_fields')),
            ))
            new_id = cur.fetchone()[0]
            legacy_to_new[int(d['scheme_id'])] = new_id
            inserted += 1
            cur.execute("RELEASE SAVEPOINT sm_row")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT sm_row")
            print(f"      ! row {d.get('scheme_id')}: {str(e)[:120]}")
            skipped += 1

    print(f"      → {inserted} schemes inserted, {skipped} skipped")
    return legacy_to_new


_PKG_STATUS_MAP = {
    'planned':'planned', 'tendering':'tendering', 'awarded':'awarded',
    'in_progress':'in_progress', 'on_hold':'on_hold',
    'completed':'completed', 'closed':'closed', 'cancelled':'cancelled',
    # t3 variants
    'under_execution':'in_progress', 'under_tendering':'tendering',
    'execution':'in_progress', 'ongoing':'in_progress', 'awarded_executing':'in_progress',
}

_SCHEME_STATUS_MAP = {
    'under_formulation':'under_formulation', 'under_stage1':'under_stage1',
    'under_tendering':'under_tendering', 'under_stage2':'under_stage2',
    'ongoing':'ongoing', 'on_hold':'on_hold', 'closed':'closed', 'dropped':'dropped',
    # t3 variants
    'under_execution':'ongoing', 'in_progress':'ongoing', 'execution':'ongoing',
}


def map_pkg_status(s):
    if not s: return 'planned'
    return _PKG_STATUS_MAP.get(str(s).lower().strip(), 'planned')


def map_scheme_status(s):
    if not s: return 'under_formulation'
    return _SCHEME_STATUS_MAP.get(str(s).lower().strip(), 'ongoing')


def load_packages(dump, cur, scheme_map):
    print("[2/6] Loading packages...")
    cols = find_column_order(dump, 'packages')
    rows = list(dump.table_data('public', 'packages'))
    print(f"      Found {len(rows)} rows")

    inserted, skipped = 0, 0
    for raw in rows:
        d = dict(zip(cols, raw))
        new_scheme_id = scheme_map.get(int(d['scheme_id']))
        if not new_scheme_id:
            skipped += 1
            continue
        cur.execute("SAVEPOINT pkg_row")
        try:
            is_mirror = to_bool(d.get('is_scheme_mirror'))
            legacy_pkg_no = int(d.get('package_no', 1))
            if is_mirror and legacy_pkg_no == 1:
                cur.execute("""
                    UPDATE packages SET
                        package_code=%s, package_name=%s, package_scope=%s, package_type=%s,
                        package_status=%s, package_estimate_cr=%s, package_value_cr=%s,
                        project_manager_name=%s, project_manager_email=%s, project_manager_phone=%s,
                        executing_agency=%s, consultant_name=%s, consultant_pmc=%s,
                        section_in_charge=%s, safety_officer=%s, quality_officer=%s,
                        site_location=%s, start_date_actual=%s, remarks=%s, extra_fields=%s::jsonb
                    WHERE scheme_id=%s AND package_no=1
                """, (
                    d.get('package_code'), d['package_name'], d.get('package_scope'),
                    d.get('package_type'),
                    map_pkg_status(d.get('package_status')),
                    to_decimal(d.get('package_estimate_cr')), to_decimal(d.get('package_value_cr')),
                    d.get('project_manager_name'), d.get('project_manager_email'),
                    d.get('project_manager_phone'), d.get('executing_agency'),
                    d.get('consultant_name'), d.get('consultant_pmc'),
                    d.get('section_in_charge'), d.get('safety_officer'), d.get('quality_officer'),
                    d.get('site_location'), to_date(d.get('start_date_actual')),
                    d.get('remarks'), to_jsonb(d.get('extra_fields')),
                    new_scheme_id,
                ))
                inserted += 1
            else:
                cur.execute("""
                    INSERT INTO packages
                        (scheme_id, package_no, package_code, package_name, package_scope,
                         package_type, package_status, package_estimate_cr, package_value_cr,
                         project_manager_name, project_manager_email, project_manager_phone,
                         executing_agency, consultant_name, consultant_pmc,
                         section_in_charge, safety_officer, quality_officer,
                         site_location, start_date_actual, is_scheme_mirror, remarks,
                         extra_fields, created_by)
                    VALUES (%s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,
                            %s,%s,%s, %s,%s,%s,
                            %s,%s,%s,%s, %s::jsonb, 1)
                    ON CONFLICT (scheme_id, package_no) DO NOTHING
                """, (
                    new_scheme_id, legacy_pkg_no, d.get('package_code'),
                    d['package_name'], d.get('package_scope'), d.get('package_type'),
                    map_pkg_status(d.get('package_status')),
                    to_decimal(d.get('package_estimate_cr')), to_decimal(d.get('package_value_cr')),
                    d.get('project_manager_name'), d.get('project_manager_email'),
                    d.get('project_manager_phone'), d.get('executing_agency'),
                    d.get('consultant_name'), d.get('consultant_pmc'),
                    d.get('section_in_charge'), d.get('safety_officer'), d.get('quality_officer'),
                    d.get('site_location'), to_date(d.get('start_date_actual')),
                    False, d.get('remarks'),
                    to_jsonb(d.get('extra_fields')),
                ))
                inserted += 1
            cur.execute("RELEASE SAVEPOINT pkg_row")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT pkg_row")
            print(f"      ! package {d.get('package_no')} sch={d['scheme_id']}: {str(e)[:120]}")
            skipped += 1

    print(f"      → {inserted} packages inserted/updated, {skipped} skipped")


def load_execution_templates(dump, cur):
    """Map legacy execution_template → appendix2_templates + items."""
    print("[3/6] Loading execution_template → appendix2_templates...")
    cols = find_column_order(dump, 'execution_template')
    rows = list(dump.table_data('public', 'execution_template'))
    print(f"      Found {len(rows)} template rows")

    # Group templates by template_name (or scheme_type)
    inserted_tpls, inserted_items = 0, 0
    seen_templates = {}
    for raw in rows:
        d = dict(zip(cols, raw))
        tpl_name = d.get('template_name') or d.get('scheme_type') or 'Legacy Template'
        tpl_name = f"Legacy: {tpl_name}"
        if tpl_name not in seen_templates:
            try:
                cur.execute("""
                    INSERT INTO appendix2_templates(template_name, description, is_global, is_active, created_by)
                    VALUES(%s, %s, TRUE, TRUE, 1)
                    ON CONFLICT (template_name) DO NOTHING
                    RETURNING template_id
                """, (tpl_name, f"Imported from execution_template ({d.get('scheme_type','any')})"))
                r = cur.fetchone()
                if r:
                    seen_templates[tpl_name] = r[0]
                    inserted_tpls += 1
                else:
                    cur.execute("SELECT template_id FROM appendix2_templates WHERE template_name=%s", (tpl_name,))
                    seen_templates[tpl_name] = cur.fetchone()[0]
            except Exception as e:
                print(f"      ! template insert: {str(e)[:100]}")
                continue
        tpl_id = seen_templates[tpl_name]
        # Insert template item
        try:
            cur.execute("""
                INSERT INTO appendix2_template_items
                    (template_id, is_category, category_label, item_label,
                     default_commencement_months, default_completion_months,
                     default_weight_pct, sort_order)
                VALUES(%s, FALSE, %s, %s, %s, %s, %s, %s)
            """, (
                tpl_id, d.get('category'), d.get('item_name') or d.get('activity_name'),
                to_decimal(d.get('commencement_months')) or 0,
                to_decimal(d.get('completion_months')) or 0,
                to_decimal(d.get('weight_pct')) or 0,
                int(d.get('sort_order') or 0),
            ))
            inserted_items += 1
        except Exception as e:
            print(f"      ! item: {str(e)[:100]}")

    print(f"      → {inserted_tpls} new templates, {inserted_items} items")


def load_masters(dump, cur):
    print("[4/6] Loading uom_master + activity_master_global...")
    # UoM — t3 columns are: uom_id, uom_name, description, is_active
    cols = find_column_order(dump, 'uom_master')
    rows = list(dump.table_data('public', 'uom_master'))
    n_uom = 0
    for raw in rows:
        d = dict(zip(cols, raw))
        # Generate uom_code from uom_name (eg "Metric Tonne" → "MT" or first 6 chars)
        name = d.get('uom_name') or d.get('uom_code') or ''
        if not name: continue
        code = (d.get('uom_code') or name[:20]).upper().replace(' ','_')
        try:
            cur.execute("""
                INSERT INTO uom_master(uom_code, uom_name, uom_category, is_active)
                VALUES(%s, %s, %s, %s) ON CONFLICT (uom_code) DO NOTHING
            """, (code, name, d.get('description') or d.get('uom_category'),
                  to_bool(d.get('is_active', True))))
            n_uom += 1
        except Exception as e:
            print(f"      ! uom {name}: {str(e)[:100]}")
    print(f"      → uom_master populated ({n_uom} rows)")

    # Activity master
    cols = find_column_order(dump, 'activity_master_global')
    rows = list(dump.table_data('public', 'activity_master_global'))
    for raw in rows:
        d = dict(zip(cols, raw))
        try:
            cur.execute("""
                INSERT INTO activity_master_global
                    (activity_name, activity_category, default_weightage, description, is_active)
                VALUES(%s, %s, %s, %s, %s) ON CONFLICT (activity_name) DO NOTHING
            """, (d['activity_name'], d.get('activity_category'),
                  to_decimal(d.get('default_weightage')) or 10,
                  d.get('description'), to_bool(d.get('is_active'))))
        except Exception as e:
            print(f"      ! activity: {str(e)[:100]}")
    print(f"      → activity_master_global populated")


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--t3-file', required=True)
    p.add_argument('--target', default='postgresql://postgres:abc123@127.0.0.1:5433/project_brain')
    args = p.parse_args()

    print("="*70)
    print("PROJECT BRAIN v4 PRESEEDER")
    print("="*70)
    print(f"Source : {args.t3_file}")
    print(f"Target : {args.target}")
    print()

    print("[0/6] Loading t3.sql with pgdumplib...")
    dump = pgdumplib.load(args.t3_file)
    print(f"      Server v{dump.server_version}, {len(dump.entries)} entries")

    conn = psycopg2.connect(args.target)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        scheme_map = load_scheme_master(dump, cur)
        conn.commit()
        load_packages(dump, cur, scheme_map)
        conn.commit()
        load_execution_templates(dump, cur)
        conn.commit()
        load_masters(dump, cur)
        conn.commit()

        print("\n[5/6] Verifying...")
        cur.execute("SELECT COUNT(*) FROM scheme_master WHERE NOT is_deleted")
        print(f"      schemes   : {cur.fetchone()[0]}")
        cur.execute("SELECT COUNT(*) FROM packages WHERE NOT is_deleted")
        print(f"      packages  : {cur.fetchone()[0]}")
        cur.execute("SELECT COUNT(*) FROM packages WHERE NOT is_scheme_mirror AND NOT is_deleted")
        print(f"      real pkgs : {cur.fetchone()[0]}")
        cur.execute("SELECT COUNT(*) FROM appendix2_templates")
        print(f"      templates : {cur.fetchone()[0]}")
        cur.execute("SELECT COUNT(*) FROM appendix2_template_items")
        print(f"      tpl items : {cur.fetchone()[0]}")

        print("\n[6/6] Sample 5 schemes:")
        cur.execute("""SELECT scheme_id, scheme_code, scheme_name, scheme_type, current_status,
                       estimated_cost_cr FROM scheme_master WHERE NOT is_deleted
                       ORDER BY scheme_id LIMIT 5""")
        for row in cur.fetchall():
            print(f"      {row[0]:>3} | {row[1]:<12} | {row[2][:55]:<55} | {row[3]:<10} | ₹{row[5]} Cr")

        print("\n" + "="*70)
        print("✅ PRESEED COMPLETE")
        print("="*70)
    except Exception as e:
        conn.rollback()
        print(f"\n❌ FAILED: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
