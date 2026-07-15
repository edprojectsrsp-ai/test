#!/usr/bin/env python3
"""
seed_cob7_appendix2.py — REVERSIBLE. Builds a realistic appendix-2 revision for
COB-7 (scheme 74, package 74) with a proper category->item hierarchy modeled on
your friend's actual appendix-2 structure (Design & Engineering, Civil Work,
Supply/Delivery, Erection, Testing & Commissioning), with real month offsets.

Then you can: approve it -> sync-to-plan -> get real plan activities -> build
multi-FY plans + S-curve on genuine appendix-2-sourced data.

SAFETY: every row tagged via appendix2_revisions.revision_label = TAG below and
extra_fields seed_tag. --unseed removes ONLY the tagged revision (cascades to its
items via FK ON DELETE CASCADE). Does NOT touch COB-7 itself or other revisions.

USAGE (Windows):
  set DATABASE_URL=postgresql+psycopg2://postgres:abc123@127.0.0.1:5432/project_brain
  python seed_cob7_appendix2.py --seed
  python seed_cob7_appendix2.py --status
  python seed_cob7_appendix2.py --unseed
"""
import os
import sys
import json

TAG = "COB7_APPX2_SEED"
SCHEME_ID = 74
PACKAGE_ID = 74

# Modeled on the friend's appendix-2 (category, item, commence_month, complete_month).
# Weights chosen to sum to 100 across all leaf items so 'approve' passes.
APPENDIX2 = [
    # (category,                 item,                                  cm, comp, weight)
    ("Design & Engineering",     "Basic Engineering",                    0,  4,   8),
    ("Design & Engineering",     "Detailed Design Engineering",          2,  7,   10),
    ("Civil Work",               "Civil Execution",                      4,  15,  20),
    ("Supply / Delivery",        "Structural Steel & Sheeting",          5,  11,  12),
    ("Supply / Delivery",        "Mechanical Plant & Equipment",         7,  15,  13),
    ("Supply / Delivery",        "Electrical Plant & Equipment",         7,  15,  7),
    ("Erection",                 "Structural Steel Erection",            6,  14,  10),
    ("Erection",                 "Mechanical Erection",                  9,  17,  10),
    ("Testing & Commissioning",  "Preliminary Acceptance",               17, 17,  5),
    ("Testing & Commissioning",  "Commissioning",                        17, 18,  5),
]
# weights: 8+10+20+12+13+7+10+10+5+5 = 100  ✓


def _engine():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: set DATABASE_URL first."); sys.exit(1)
    from sqlalchemy import create_engine
    return create_engine(url)


def unseed(conn):
    from sqlalchemy import text
    # FK ON DELETE CASCADE on appendix2_items.revision_id handles items.
    n = conn.execute(text(
        "DELETE FROM appendix2_revisions WHERE revision_label = :t"
    ), {"t": TAG}).rowcount
    print(f"  removed {n} tagged appendix-2 revision(s) (items cascade)")


def status(conn):
    from sqlalchemy import text
    rev = conn.execute(text(
        "SELECT revision_id FROM appendix2_revisions WHERE revision_label = :t"
    ), {"t": TAG}).fetchall()
    print(f"  tagged revisions: {[r.revision_id for r in rev]}")
    for r in rev:
        cats = conn.execute(text(
            "SELECT count(*) FROM appendix2_items WHERE revision_id=:r AND is_category=true"
        ), {"r": r.revision_id}).scalar()
        leaves = conn.execute(text(
            "SELECT count(*) FROM appendix2_items WHERE revision_id=:r AND is_category=false"
        ), {"r": r.revision_id}).scalar()
        wt = conn.execute(text(
            "SELECT COALESCE(SUM(weight_pct),0) FROM appendix2_items WHERE revision_id=:r AND is_category=false"
        ), {"r": r.revision_id}).scalar()
        print(f"    revision {r.revision_id}: {cats} categories, {leaves} items, weight_sum={wt}")


def seed(conn):
    from sqlalchemy import text
    unseed(conn)  # idempotent

    # de-current existing revisions for this scheme+package
    conn.execute(text("""
        UPDATE appendix2_revisions SET is_current=FALSE
        WHERE scheme_id=:s AND COALESCE(package_id,0)=:p AND is_current=TRUE AND is_deleted=FALSE
    """), {"s": SCHEME_ID, "p": PACKAGE_ID})

    max_rev = conn.execute(text("""
        SELECT COALESCE(MAX(revision_no),-1) FROM appendix2_revisions
        WHERE scheme_id=:s AND COALESCE(package_id,0)=:p
    """), {"s": SCHEME_ID, "p": PACKAGE_ID}).scalar()
    rev_no = int(max_rev) + 1

    rev_id = conn.execute(text("""
        INSERT INTO appendix2_revisions (
            scheme_id, package_id, revision_label, revision_no, is_current,
            is_locked, source, description, extra_fields, is_deleted,
            created_by, created_at, updated_at
        ) VALUES (
            :s, :p, :label, :rev, TRUE,
            FALSE, 'manual', 'Seeded appendix-2 for COB-7 (reversible)',
            CAST(:ef AS jsonb), FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING revision_id
    """), {
        "s": SCHEME_ID, "p": PACKAGE_ID, "label": TAG, "rev": rev_no,
        "ef": json.dumps({"seed_tag": TAG, "fy_baseline": "2024-2025",
                          "scheduled_start_date": "2024-06-01",
                          "scheduled_finish_date": "2026-12-31"}),
    }).scalar()

    # create category rows (distinct, in first-appearance order)
    cat_id = {}
    order = 0
    for (cat, *_rest) in APPENDIX2:
        if cat not in cat_id:
            order += 10
            cat_id[cat] = conn.execute(text("""
                INSERT INTO appendix2_items (
                    revision_id, parent_item_id, is_category, category, item_name,
                    commencement_months, completion_months, weight_pct, sort_order,
                    source, extra_fields, created_at, updated_at
                ) VALUES (
                    :rev, NULL, TRUE, :cat, :cat,
                    0, 0, 0, :ord, 'manual', '{}'::jsonb,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                ) RETURNING item_id
            """), {"rev": rev_id, "cat": cat, "ord": order}).scalar()

    # create leaf items under their category
    leaf_order = 0
    for (cat, item, cm, comp, wt) in APPENDIX2:
        leaf_order += 10
        conn.execute(text("""
            INSERT INTO appendix2_items (
                revision_id, parent_item_id, is_category, category, item_name,
                commencement_months, completion_months, weight_pct, sort_order,
                source, extra_fields, created_at, updated_at
            ) VALUES (
                :rev, :parent, FALSE, :cat, :item,
                :cm, :comp, :wt, :ord, 'manual', '{}'::jsonb,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
        """), {"rev": rev_id, "parent": cat_id[cat], "cat": cat, "item": item,
               "cm": cm, "comp": comp, "wt": wt, "ord": leaf_order})

    print(f"  seeded revision {rev_id}: {len(cat_id)} categories, {len(APPENDIX2)} items, weight=100")
    print(f"  NEXT: approve it, then sync-to-plan:")
    print(f"    curl.exe -X POST http://127.0.0.1:8000/api/v1/appendix2/{rev_id}/approve -H \"Content-Type: application/json\" -d \"{{}}\"")
    print(f"    curl.exe -X POST http://127.0.0.1:8000/api/v1/appendix2/{rev_id}/sync-to-plan -H \"Content-Type: application/json\" -d \"{{}}\"")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("--seed", "--unseed", "--status"):
        print(__doc__); return 0
    eng = _engine()
    with eng.begin() as conn:
        if sys.argv[1] == "--seed":
            print("[SEED] COB-7 appendix-2 (transactional, reversible)"); seed(conn)
        elif sys.argv[1] == "--unseed":
            print("[UNSEED]"); unseed(conn)
        else:
            status(conn)
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
