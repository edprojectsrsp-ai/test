from calendar import monthrange
from datetime import date, datetime
from pathlib import Path
import sys


ROOT_DIR = next(
    (parent for parent in Path(__file__).resolve().parents if (parent / "database.py").exists()),
    Path(r"D:\Python\Project Brain"),
)
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from database import get_db_connection  # noqa: E402
from utils import classify_project_financial_year, normalize_financial_year, status_as_on_from_month  # noqa: E402


FINANCIAL_YEAR_MONTHS = [
    "Apr-26",
    "May-26",
    "Jun-26",
    "Jul-26",
    "Aug-26",
    "Sep-26",
    "Oct-26",
    "Nov-26",
    "Dec-26",
    "Jan-27",
    "Feb-27",
    "Mar-27",
]
RE_MONTHS = {"Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27"}
STATUS_LABELS = ["Completed", "Yet to Start", "Ongoing", "Delay < 1 Yr.", "Delay > 1 Yr."]
METRIC_COLUMNS = {"be": "be_cr", "re": "re_cr", "actual": "actual_cr"}


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%d-%m-%y",
        "%d-%m-%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def format_date(value):
    parsed = parse_date(value)
    return parsed.isoformat() if parsed else None


def add_months(value, months):
    start = parse_date(value)
    if not start:
        return None
    try:
        month_count = int(months or 0)
    except (TypeError, ValueError):
        month_count = 0
    month_index = start.month - 1 + month_count
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, monthrange(year, month)[1])
    return date(year, month, day)


def month_label(value):
    parsed = parse_date(value)
    return parsed.strftime("%b-%y") if parsed else "-"


def start_bucket(row, financial_year=None, status_as_on=None):
    return classify_project_financial_year(start_date(row), financial_year, status_as_on)["fy_classification"]


def numeric(value, default=0.0):
    try:
        return float(str(value or "").replace(",", "").strip() or default)
    except (TypeError, ValueError):
        return default


def ensure_monthly_table(conn=None):
    own_connection = conn is None
    conn = conn or get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS plant_level_amr_monthly (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            financial_year TEXT NOT NULL DEFAULT '2026-2027',
            month TEXT NOT NULL,
            be_cr DOUBLE PRECISION DEFAULT 0,
            re_cr DOUBLE PRECISION DEFAULT 0,
            actual_cr DOUBLE PRECISION DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, financial_year, month)
        )
        """
    )
    conn.commit()
    if own_connection:
        conn.close()


def monthly_records(project_ids):
    if not project_ids:
        return {}
    conn = get_db_connection()
    ensure_monthly_table(conn)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT project_id, month, be_cr, re_cr, actual_cr
        FROM plant_level_amr_monthly
        WHERE project_id = ANY(%s)
          AND month = ANY(%s)
        """,
        (list(project_ids), FINANCIAL_YEAR_MONTHS),
    )
    records = {}
    for row in cursor.fetchall():
        records[(row["project_id"], row["month"])] = dict(row)
    conn.close()
    return records


def gross_cost_cr(row):
    return numeric(
        row.get("stage2_cost")
        or row.get("stage1_cost")
        or row.get("formulation_cost")
        or row.get("gross_cost")
    )


def start_date(row):
    return (
        row.get("start_date")
        or row.get("registration_date")
        or row.get("cod_date")
        or row.get("stage2_date")
    )


def schedule_months(row):
    return numeric(row.get("schedule_months") or row.get("schedule_month") or row.get("duration_months"), 0)


def finish_date(row):
    return (
        parse_date(row.get("finish_date"))
        or parse_date(row.get("schedule_finish"))
        or parse_date(row.get("schedule_completion"))
        or add_months(start_date(row), schedule_months(row))
        or parse_date(row.get("final_tod_date"))
        or parse_date(row.get("stage2_date"))
        or parse_date(row.get("cod_date"))
    )


def expected_finish(row):
    return parse_date(row.get("expected_finish")) or finish_date(row)


def completion_date(row):
    return parse_date(row.get("completion_date")) or parse_date(row.get("commissioned_date"))


def physical_progress_percent(row):
    if row.get("progress_override") is not None:
        return max(0, min(100, numeric(row.get("progress_override"))))
    flags = [
        row.get("cod_cleared"),
        row.get("stage1_cleared"),
        row.get("stage2_cleared"),
        row.get("completion_marked"),
        row.get("commissioned_marked"),
    ]
    completed = sum(1 for flag in flags if str(flag or "").upper() == "Y")
    return round((completed / max(1, len(flags))) * 100, 2)


def project_status(row, today=None):
    today = today or date.today()
    actual_completion = completion_date(row)
    if actual_completion and today >= actual_completion:
        return "Completed"
    start = parse_date(start_date(row))
    if not start or today < start:
        return "Yet to Start"
    expected = expected_finish(row)
    if not expected:
        return "Ongoing"
    delay_days = (today - expected).days
    if delay_days > 365:
        return "Delay > 1 Yr."
    if delay_days > 0:
        return "Delay < 1 Yr."
    return "Ongoing"


def default_month_capex(row, month):
    gross = gross_cost_cr(row)
    base = gross / max(1, len(FINANCIAL_YEAR_MONTHS))
    month_index = FINANCIAL_YEAR_MONTHS.index(month)
    be = base
    re = base * 0.95 if month in RE_MONTHS else None
    actual = base * (0.8 + (physical_progress_percent(row) / 500)) if month_index <= 1 else None
    return {
        "month": month,
        "be": round(be, 2),
        "re": round(re, 2) if re is not None else None,
        "actual": round(actual, 2) if actual is not None else None,
    }


def month_capex(row, month, records=None):
    default = default_month_capex(row, month)
    record = (records or {}).get((row.get("id"), month))
    if not record:
        return default
    return {
        "month": month,
        "be": round(numeric(record.get("be_cr")), 2),
        "re": round(numeric(record.get("re_cr")), 2) if month in RE_MONTHS else None,
        "actual": round(numeric(record.get("actual_cr")), 2),
    }


def project_row(row, index, today=None, records=None, financial_year=None):
    finish = finish_date(row)
    expected = expected_finish(row)
    gross = gross_cost_cr(row)
    fy_context = classify_project_financial_year(start_date(row), financial_year, today)
    return {
        "sl_no": index,
        "id": row.get("id"),
        "project_name": row.get("project_name") or "",
        "contractor_name": row.get("contractor_name") or "",
        "at_no": row.get("unique_id") or "",
        "at_date": format_date(row.get("stage2_date") or row.get("cod_date")),
        "scheduled_month": month_label(finish),
        "start_date": format_date(start_date(row)),
        "finish_date": format_date(finish),
        "expected_finish_date": format_date(expected),
        "completion_date": format_date(completion_date(row)),
        "physical_progress_percent": physical_progress_percent(row),
        "status": project_status(row, today),
        "start_bucket": fy_context["fy_classification"],
        "fy_classification": fy_context["fy_classification"],
        "fy_classification_color": fy_context["fy_classification_color"],
        "financial_year": fy_context["financial_year"],
        "fy_start_date": fy_context["fy_start_date"],
        "fy_end_date": fy_context["fy_end_date"],
        "status_as_on_date": fy_context["status_as_on_date"],
        "project_start_date": fy_context["project_start_date"],
        "gross_cost_cr": round(gross, 2),
        "remarks": row.get("amr_remarks") or row.get("master_remarks") or "",
        "be_cr": round(gross, 2),
        "re_cr": round(gross, 2),
        "monthly": [month_capex(row, month, records) for month in FINANCIAL_YEAR_MONTHS],
    }


def fetch_plant_level_projects():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT *
        FROM projects
        WHERE project_type='Plant Level AMR'
          AND COALESCE(project_dropped, 'N') <> 'Y'
        ORDER BY id DESC
        """
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def seed_default_monthly_rows(rows):
    if not rows:
        return
    conn = get_db_connection()
    ensure_monthly_table(conn)
    cursor = conn.cursor()
    for row in rows:
        project_id = row.get("id")
        if not project_id:
            continue
        for month in FINANCIAL_YEAR_MONTHS:
            defaults = default_month_capex(row, month)
            cursor.execute(
                """
                INSERT INTO plant_level_amr_monthly (
                    project_id, financial_year, month, be_cr, re_cr, actual_cr
                )
                VALUES (%s, '2026-2027', %s, %s, %s, %s)
                ON CONFLICT (project_id, financial_year, month) DO NOTHING
                """,
                (
                    project_id,
                    month,
                    defaults["be"] or 0,
                    defaults["re"] or 0,
                    defaults["actual"] or 0,
                ),
            )
    conn.commit()
    conn.close()


def build_capex_summary(rows, records=None):
    total_be = sum(gross_cost_cr(row) for row in rows)
    capex_rows = []
    for month in FINANCIAL_YEAR_MONTHS:
        be = sum(month_capex(row, month, records)["be"] for row in rows)
        re = sum(month_capex(row, month, records)["re"] or 0 for row in rows)
        actual = sum(month_capex(row, month, records)["actual"] or 0 for row in rows)
        reference = re if month in RE_MONTHS else be
        variance = reference - be
        capex_rows.append({
            "financial_year": month,
            "be_cr": round(be, 2),
            "re_cr": round(re, 2) if month in RE_MONTHS else None,
            "actual_cr": round(actual, 2),
            "variance_cr": round(variance, 2),
            "variance_percent": round((variance / be * 100), 2) if be else 0,
        })
    total_re = sum(row["re_cr"] or 0 for row in capex_rows)
    total_actual = sum(row["actual_cr"] or 0 for row in capex_rows)
    return {
        "months": FINANCIAL_YEAR_MONTHS,
        "re_months": sorted(RE_MONTHS, key=FINANCIAL_YEAR_MONTHS.index),
        "rows": capex_rows,
        "totals": {
            "be_cr": round(total_be, 2),
            "re_cr": round(total_re or total_be, 2),
            "actual_cr": round(total_actual, 2),
            "variance_cr": round((total_re or total_be) - total_be, 2),
        },
    }


def build_dashboard(today=None, financial_year=None, month=None):
    today = parse_date(today) or status_as_on_from_month(month, financial_year)
    financial_year = normalize_financial_year(financial_year, today)
    raw_rows = fetch_plant_level_projects()
    seed_default_monthly_rows(raw_rows)
    records = monthly_records([row.get("id") for row in raw_rows if row.get("id")])
    project_rows = [project_row(row, index, today, records, financial_year) for index, row in enumerate(raw_rows, start=1)]
    started_label = classify_project_financial_year(today, status_as_on=today)["fy_classification"]
    fy_classification_counts = {
        started_label: {"label": started_label, "value": 0, "color": "green"},
        "Ongoing Since Last FY": {"label": "Ongoing Since Last FY", "value": 0, "color": "orange"},
    }
    for row in project_rows:
        label = row.get("fy_classification") or "Ongoing Since Last FY"
        fy_classification_counts.setdefault(
            label,
            {"label": label, "value": 0, "color": row.get("fy_classification_color") or "orange"},
        )
        fy_classification_counts[label]["value"] += 1
    status_counts = {status: 0 for status in STATUS_LABELS}
    for row in project_rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
    total_projects = len(project_rows)
    overall_progress = (
        sum(row["physical_progress_percent"] for row in project_rows) / total_projects
        if total_projects
        else 0
    )
    capex = build_capex_summary(raw_rows, records)
    return {
        "as_on": today.isoformat(),
        "financial_year": financial_year,
        "fy_start_date": classify_project_financial_year(None, financial_year, today)["fy_start_date"],
        "fy_classification_rows": list(fy_classification_counts.values()),
        "financial_year_months": FINANCIAL_YEAR_MONTHS,
        "re_months": sorted(RE_MONTHS, key=FINANCIAL_YEAR_MONTHS.index),
        "projects": project_rows,
        "summary": {
            "total_projects": total_projects,
            "status_counts": status_counts,
            "status_percent": {
                status: round((count / total_projects * 100), 2) if total_projects else 0
                for status, count in status_counts.items()
            },
            "overall_progress_percent": round(overall_progress, 2),
            "cumulative_be_cr": capex["totals"]["be_cr"],
            "cumulative_re_cr": capex["totals"]["re_cr"],
        },
        "capex": capex,
    }


def update_monthly_value(project_id, month, metric, value, financial_year="2026-2027"):
    if month not in FINANCIAL_YEAR_MONTHS:
        raise ValueError("Invalid financial year month")
    if metric not in METRIC_COLUMNS:
        raise ValueError("Metric must be be, re, or actual")
    if metric == "re" and month not in RE_MONTHS:
        raise ValueError("RE entry is allowed only from Oct onward")
    conn = get_db_connection()
    ensure_monthly_table(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s AND project_type='Plant Level AMR'", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise LookupError("Plant Level AMR project not found")

    defaults = default_month_capex(dict(project), month)
    cursor.execute(
        """
        INSERT INTO plant_level_amr_monthly (
            project_id, financial_year, month, be_cr, re_cr, actual_cr
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (project_id, financial_year, month) DO NOTHING
        """,
        (
            project_id,
            financial_year,
            month,
            defaults["be"] or 0,
            defaults["re"] or 0,
            defaults["actual"] or 0,
        ),
    )
    column = METRIC_COLUMNS[metric]
    cursor.execute(
        f"""
        UPDATE plant_level_amr_monthly
        SET {column}=%s,
            updated_at=CURRENT_TIMESTAMP
        WHERE project_id=%s
          AND financial_year=%s
          AND month=%s
        """,
        (numeric(value), project_id, financial_year, month),
    )
    conn.commit()
    conn.close()
    return build_dashboard()
