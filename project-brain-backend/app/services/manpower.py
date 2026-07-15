"""Daily-progress manpower service (mirrors the reference daily_progress_manpower
module: RSP Executives/Non-Executives, Executing Agency roles, Contractor roster,
month-average PMC tables for dashboard and reports)."""

from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import text

from app.services.progress_summary import fiscal_month_labels, month_label, _f

DEFAULT_DPR_CONTRACTORS: list[str] = []

RSP_SECTION = "Rourkela Steel Plant Manpower"
AGENCY_SECTION = "Executing Agency"


def ensure_manpower_tables(db):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS daily_progress_manpower (
            id SERIAL PRIMARY KEY,
            scheme_id INTEGER NOT NULL,
            report_date DATE NOT NULL,
            section_name TEXT NOT NULL DEFAULT '',
            category_name TEXT NOT NULL DEFAULT '',
            contractor_name TEXT NOT NULL DEFAULT '',
            role_name TEXT NOT NULL DEFAULT '',
            qty REAL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            month_target TEXT NOT NULL DEFAULT '',
            last_month_average REAL NOT NULL DEFAULT 0,
            remarks TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS daily_progress_manpower_contractors (
            id SERIAL PRIMARY KEY,
            scheme_id INTEGER NOT NULL,
            contractor_name TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(scheme_id, contractor_name)
        )
    """))
    db.commit()


def scheme_agency_name(db, scheme_id: int) -> str:
    row = db.execute(text("""
        SELECT COALESCE(
                 NULLIF(MAX(c.contractor_name), ''),
                 NULLIF(MAX(p.executing_agency), ''),
                 '') AS agency_name
        FROM packages p
        LEFT JOIN contracts c ON c.package_id = p.package_id
                              AND c.is_active AND NOT c.is_deleted
        WHERE p.scheme_id = :sid AND NOT p.is_deleted
    """), {"sid": scheme_id}).mappings().first() or {}
    return str(row.get("agency_name") or "").strip()


def known_contractors(db, scheme_id: int):
    rows = db.execute(text("""
        SELECT contractor_name FROM (
            SELECT contractor_name
            FROM daily_progress_manpower_contractors
            WHERE scheme_id = :sid AND is_active = TRUE
              AND COALESCE(contractor_name, '') <> ''
            UNION
            SELECT DISTINCT h.contractor_name
            FROM daily_progress_manpower h
            WHERE h.scheme_id = :sid AND h.category_name = 'Contractor'
              AND COALESCE(h.contractor_name, '') <> ''
              AND NOT EXISTS (
                  SELECT 1 FROM daily_progress_manpower_contractors r
                  WHERE r.scheme_id = h.scheme_id
                    AND LOWER(r.contractor_name) = LOWER(h.contractor_name)
                    AND r.is_active = FALSE)
        ) contractors
        ORDER BY contractor_name
    """), {"sid": scheme_id}).scalars().all()
    return [r for r in rows if r]


def _empty_row(row_id, category, contractor_name="", trade="", remarks=""):
    return {
        "id": row_id, "category": category,
        "contractorGroupId": contractor_name if category == "Contractor" else "",
        "contractorName": contractor_name, "trade": trade,
        "designation": "", "scope": "", "unit": "",
        "lastMonth": "0", "today": "0", "remarks": remarks,
    }


def default_manpower_rows(agency_name=""):
    rows = [
        _empty_row(1, "RSP - Executive"),
        _empty_row(2, "RSP - Non Executive"),
        _empty_row(3, "Executing Agency", agency_name, "Project Manager", "Project Management Office"),
        _empty_row(4, "Executing Agency", agency_name, "Supervisor", "Site Supervision"),
    ]
    next_id = len(rows) + 1
    for name in DEFAULT_DPR_CONTRACTORS:
        rows.append(_empty_row(next_id, "Contractor", name, "Supervisor", f"{name} - Supervision"))
        rows.append(_empty_row(next_id + 1, "Contractor", name, "Labour", f"{name} - Execution"))
        next_id += 2
    return rows


def ensure_design_rows(manpower_rows, agency_name="", contractors=None):
    result = [dict(r) for r in manpower_rows]
    contractors = [str(n or "").strip() for n in (contractors or []) if str(n or "").strip()]

    def row_key(row):
        category = str(row.get("category") or "").strip()
        if category == "Contractor":
            return (category, str(row.get("contractorName") or "").strip().casefold(),
                    str(row.get("trade") or "").strip().casefold())
        return (category, str(row.get("trade") or "").strip().casefold())

    existing = {row_key(r) for r in result}
    next_id = len(result) + 1
    for default_row in default_manpower_rows(agency_name):
        if row_key(default_row) in existing:
            continue
        row = dict(default_row)
        row["id"] = next_id
        result.append(row)
        existing.add(row_key(default_row))
        next_id += 1

    have = {str(r.get("contractorName") or "").strip().casefold()
            for r in result if r.get("category") == "Contractor" and str(r.get("contractorName") or "").strip()}
    for name in contractors:
        if name.casefold() in have:
            continue
        result.append(_empty_row(next_id, "Contractor", name, "Supervisor", f"{name} - Supervision"))
        result.append(_empty_row(next_id + 1, "Contractor", name, "Labour", f"{name} - Execution"))
        next_id += 2
        have.add(name.casefold())
    return result


def load_manpower_rows(db, scheme_id: int, report_date: date):
    """UI rows for the manpower matrix on a given date (saved rows or defaults)."""
    ensure_manpower_tables(db)
    agency = scheme_agency_name(db, scheme_id)
    saved = db.execute(text("""
        SELECT section_name, category_name, contractor_name, role_name, qty, sort_order,
               COALESCE(month_target, '') AS month_target,
               COALESCE(last_month_average, 0) AS last_month_average,
               COALESCE(remarks, '') AS remarks
        FROM daily_progress_manpower
        WHERE scheme_id = :sid AND report_date = CAST(:d AS date)
        ORDER BY sort_order, id
    """), {"sid": scheme_id, "d": report_date}).mappings().all()

    rows = []
    if saved:
        for index, r in enumerate(saved, start=1):
            section, category_name, role = r["section_name"], r["category_name"], r["role_name"]
            contractor = ""
            if section == RSP_SECTION and category_name == "Executives":
                category, trade = "RSP - Executive", ""
            elif section == RSP_SECTION and category_name == "Non-Executives":
                category, trade = "RSP - Non Executive", ""
            elif category_name == "Contractor":
                category, trade = "Contractor", role
                contractor = r["contractor_name"] or ""
            else:
                category, trade = "Executing Agency", role or category_name
                contractor = agency
            rows.append({
                "id": index, "category": category,
                "contractorGroupId": contractor if category == "Contractor" else "",
                "contractorName": contractor, "trade": trade,
                "designation": "", "scope": "", "unit": "",
                "lastMonth": _f(r["last_month_average"]),
                "today": _f(r["qty"]),
                "remarks": r["remarks"],
            })
    else:
        rows = default_manpower_rows(agency)
    return ensure_design_rows(rows, agency, known_contractors(db, scheme_id)), agency


def save_manpower_rows(db, scheme_id: int, report_date: date, ui_rows):
    """Persist the manpower matrix for a date (delete+insert, like the reference)."""
    ensure_manpower_tables(db)
    db.execute(text("""
        DELETE FROM daily_progress_manpower
        WHERE scheme_id = :sid AND report_date = CAST(:d AS date)
    """), {"sid": scheme_id, "d": report_date})
    for sort_order, row in enumerate(ui_rows or []):
        category = str(row.get("category") or "").strip()
        if category == "RSP - Executive":
            section, category_name, role, contractor = RSP_SECTION, "Executives", "", ""
        elif category == "RSP - Non Executive":
            section, category_name, role, contractor = RSP_SECTION, "Non-Executives", "", ""
        elif category == "Contractor":
            section, category_name = "", "Contractor"
            role = str(row.get("trade") or "")
            contractor = str(row.get("contractorName") or "")
        else:
            section, category_name = AGENCY_SECTION, str(row.get("trade") or "Staff")
            role = str(row.get("trade") or "")
            contractor = str(row.get("contractorName") or "")
        db.execute(text("""
            INSERT INTO daily_progress_manpower
                (scheme_id, report_date, section_name, category_name, contractor_name,
                 role_name, qty, sort_order, month_target, last_month_average, remarks)
            VALUES (:sid, CAST(:d AS date), :section, :category, :contractor,
                    :role, :qty, :sort, :target, :last_avg, :remarks)
        """), {
            "sid": scheme_id, "d": report_date,
            "section": section, "category": category_name, "contractor": contractor,
            "role": role, "qty": _f(row.get("today")),
            "sort": sort_order,
            "target": str(row.get("monthTarget") or ""),
            "last_avg": _f(row.get("lastMonth")),
            "remarks": str(row.get("remarks") or ""),
        })
    db.commit()


def _is_executive_role(row) -> bool:
    role_text = " ".join([
        str(row.get("role_name") or ""),
        str(row.get("category_name") or ""),
        str(row.get("contractor_name") or ""),
    ]).lower()
    return any(t in role_text for t in ("executive", "engineer", "supervisor", "manager", "officer"))


def _classify(row, day_totals):
    section = str(row.get("section_name") or "").strip().lower()
    category = str(row.get("category_name") or "").strip().lower()
    role = str(row.get("role_name") or "").strip().lower()
    qty = _f(row.get("qty"))
    if section == RSP_SECTION.lower() and category == "executives":
        day_totals["rspExecutives"] += qty
    elif section == RSP_SECTION.lower() and category == "non-executives":
        day_totals["rspNonExecutives"] += qty
    elif category == "contractor":
        if any(t in role for t in ("supervisor", "engineer")):
            day_totals["subContractorSupervisors"] += qty
        else:
            day_totals["subContractorWorkers"] += qty
    elif section == AGENCY_SECTION.lower():
        if _is_executive_role(row):
            day_totals["agencyExecutives"] += qty
        else:
            day_totals["agencyNonExecutives"] += qty


def _empty_totals():
    return {"rspExecutives": 0.0, "rspNonExecutives": 0.0,
            "agencyExecutives": 0.0, "agencyNonExecutives": 0.0,
            "subContractorWorkers": 0.0, "subContractorSupervisors": 0.0}


def _pmc_rows(averages, agency_label):
    return [
        {"slNo": "1", "agency": "Project Department\n(Rourkela Steel Plant)", "manpower": "-", "category": "Executives", "value": averages("rspExecutives")},
        {"slNo": "", "agency": "", "manpower": "", "category": "Non-Executives", "value": averages("rspNonExecutives")},
        {"slNo": "2", "agency": agency_label, "manpower": "Employees", "category": "Executives", "value": averages("agencyExecutives")},
        {"slNo": "", "agency": "", "manpower": "", "category": "Non-Executives", "value": averages("agencyNonExecutives")},
        {"slNo": "3", "agency": f"Sub Contractors of {agency_label}", "manpower": "Workers", "category": "", "value": averages("subContractorWorkers")},
        {"slNo": "", "agency": "", "manpower": "Supervisor/Engineers", "category": "", "value": averages("subContractorSupervisors")},
    ]


def manpower_month_average_table(db, scheme_id: int, report_date: date, agency_name=""):
    """Agency-wise daily-average manpower for the report month (dashboard PMC table)."""
    ensure_manpower_tables(db)
    month_start = report_date.replace(day=1)
    m_end = date(report_date.year, report_date.month,
                 calendar.monthrange(report_date.year, report_date.month)[1])
    rows = db.execute(text("""
        SELECT report_date, COALESCE(section_name, '') AS section_name,
               COALESCE(category_name, '') AS category_name,
               COALESCE(contractor_name, '') AS contractor_name,
               COALESCE(role_name, '') AS role_name, COALESCE(qty, 0) AS qty
        FROM daily_progress_manpower
        WHERE scheme_id = :sid AND report_date BETWEEN CAST(:a AS date) AND CAST(:b AS date)
          AND qty IS NOT NULL
        ORDER BY report_date, sort_order, id
    """), {"sid": scheme_id, "a": month_start, "b": m_end}).mappings().all()

    totals_by_day = {}
    for r in rows:
        day = r["report_date"]
        if not day:
            continue
        _classify(r, totals_by_day.setdefault(day, _empty_totals()))
    filled = sorted(totals_by_day.keys())

    def average(key):
        if not filled:
            return 0
        return round(sum(totals_by_day[d].get(key, 0.0) for d in filled) / len(filled))

    agency_label = str(agency_name or "").strip() or scheme_agency_name(db, scheme_id) or "Executing Agency"
    return {
        "monthLabel": report_date.strftime("%b-%Y"),
        "filledDays": len(filled),
        "agencyName": agency_label,
        "rows": _pmc_rows(average, agency_label),
    }


def manpower_pmc_by_month(db, scheme_id: int, fy_start_year: int, agency_name=""):
    """Month-by-month PMC manpower averages for the full FY (reports)."""
    ensure_manpower_tables(db)
    labels = fiscal_month_labels(fy_start_year)
    fy_start, fy_end = date(fy_start_year, 4, 1), date(fy_start_year + 1, 3, 31)
    rows = db.execute(text("""
        SELECT report_date, COALESCE(section_name, '') AS section_name,
               COALESCE(category_name, '') AS category_name,
               COALESCE(contractor_name, '') AS contractor_name,
               COALESCE(role_name, '') AS role_name, COALESCE(qty, 0) AS qty
        FROM daily_progress_manpower
        WHERE scheme_id = :sid AND report_date BETWEEN CAST(:a AS date) AND CAST(:b AS date)
          AND qty IS NOT NULL
        ORDER BY report_date, sort_order, id
    """), {"sid": scheme_id, "a": fy_start, "b": fy_end}).mappings().all()

    month_totals = {}
    for r in rows:
        day = r["report_date"]
        if not day:
            continue
        lbl = month_label(day)
        if lbl not in labels:
            continue
        _classify(r, month_totals.setdefault(lbl, {}).setdefault(day, _empty_totals()))

    agency_label = str(agency_name or "").strip() or scheme_agency_name(db, scheme_id) or "Executing Agency"
    result = {}
    for lbl in labels:
        daily = month_totals.get(lbl, {})
        filled = sorted(daily.keys())

        def average(key, _daily=daily, _filled=filled):
            if not _filled:
                return 0
            return round(sum(_daily[d].get(key, 0.0) for d in _filled) / len(_filled))

        result[lbl] = {
            "monthLabel": lbl, "filledDays": len(filled),
            "agencyName": agency_label,
            "rows": _pmc_rows(average, agency_label),
        }
    return result
