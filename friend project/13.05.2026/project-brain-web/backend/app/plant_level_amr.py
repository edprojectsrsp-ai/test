from calendar import monthrange
from datetime import date, datetime
from pathlib import Path
import csv
import io
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
STATUS_LABELS = ["Completed", "Yet to Start", "On Time", "Delay < 1 Yr.", "Delay > 1 Yr."]
METRIC_COLUMNS = {"be": "be_cr", "re": "re_cr", "actual": "actual_cr"}
REMARKS_MAX_LENGTH = 600
DETAIL_FIELDS = {
    "department": "department",
    "contractor_name": "contractor_name",
    "at_no": "at_no",
    "at_date": "at_date",
    "scheduled_month": "scheduled_month",
    "schedule_months": "scheduled_month",
    "start_date": "schedule_start",
    "finish_date": "schedule_completion",
    "expected_finish_date": "anticipated_completion",
    "completion_date": "completion_date",
    "physical_progress_percent": "physical_progress",
    "status": "amr_status",
    "remarks": "remarks",
    "gross_cost_cr": "gross_cost",
    "actual_till_last_fy_cr": "capex_till_last_fy",
    "be_cr": "be_amount",
    "re_cr": "re_amount",
}
TEMPLATE_BASE_FIELDS = [
    ("Project Name", "project_name"),
    ("AT Date", "at_date"),
    ("AT No.", "at_no"),
    ("Department", "department"),
    ("Contractor Name", "contractor_name"),
    ("Schedule Start", "start_date"),
    ("Schedule Finish", "finish_date"),
    ("Expected Finish", "expected_finish_date"),
    ("Physical Progress", "physical_progress_percent"),
    ("Gross Cost", "gross_cost_cr"),
    ("Actual Till Last FY (Cr.)", "actual_till_last_fy_cr"),
    ("BE(Cr.)", "be_cr"),
    ("Completion Date", "completion_date"),
    ("RE(Cr.)", "re_cr"),
]


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


def months_between(start_value, finish_value):
    start = parse_date(start_value)
    finish = parse_date(finish_value)
    if not start or not finish or finish < start:
        return ""
    months = (finish.year - start.year) * 12 + (finish.month - start.month)
    if finish.day < start.day:
        months -= 1
    return str(max(0, months))


def month_label(value):
    parsed = parse_date(value)
    return parsed.strftime("%b-%y") if parsed else "-"


def plant_status_as_on_from_month(month_label=None, financial_year=None, today=None):
    if today:
        return parse_date(today) or status_as_on_from_month(month_label, financial_year)
    text = str(month_label or "").strip()
    if not text:
        return status_as_on_from_month(month_label, financial_year)
    try:
        parsed = datetime.strptime(text, "%b-%y").date()
        return date(parsed.year, parsed.month, monthrange(parsed.year, parsed.month)[1])
    except ValueError:
        return parse_date(text) or status_as_on_from_month(month_label, financial_year)


def start_bucket(row, financial_year=None, status_as_on=None):
    return classify_project_financial_year(start_date(row), financial_year, status_as_on)["fy_classification"]


def numeric(value, default=0.0):
    try:
        return float(str(value or "").replace(",", "").strip() or default)
    except (TypeError, ValueError):
        return default


def normalize_template_header(value):
    return " ".join(str(value or "").replace("\ufeff", "").replace(".", " ").replace("_", " ").strip().lower().split())


def template_monthly_fields():
    fields = []
    for month in FINANCIAL_YEAR_MONTHS:
        fields.append((f"{month} BE", month, "be"))
        fields.append((f"{month} RE", month, "re"))
        fields.append((f"{month} Actual", month, "actual"))
    return fields


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


def ensure_edc_idc_table(conn=None):
    own_connection = conn is None
    conn = conn or get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS plant_level_amr_edc_idc (
            financial_year TEXT NOT NULL DEFAULT '2026-2027',
            month TEXT NOT NULL,
            be_cr DOUBLE PRECISION DEFAULT 0,
            re_cr DOUBLE PRECISION DEFAULT 0,
            actual_cr DOUBLE PRECISION DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(financial_year, month)
        )
        """
    )
    conn.commit()
    if own_connection:
        conn.close()


def ensure_details_columns(conn=None):
    own_connection = conn is None
    conn = conn or get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS plant_level_amr_details (
            project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            sl_no TEXT,
            at_no TEXT,
            at_date TEXT,
            department TEXT,
            executing_agency TEXT,
            schedule_start TEXT,
            schedule_completion TEXT,
            anticipated_completion TEXT,
            remarks TEXT,
            physical_progress REAL,
            gross_cost REAL,
            capex_till_last_fy REAL,
            be_amount REAL,
            re_amount REAL,
            monthly_values TEXT DEFAULT '{}'
        )
        """
    )
    for column_name, column_type in (
        ("contractor_name", "TEXT"),
        ("scheduled_month", "TEXT"),
        ("completion_date", "TEXT"),
        ("amr_status", "TEXT"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='plant_level_amr_details'
              AND column_name=%s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE plant_level_amr_details ADD COLUMN {column_name} {column_type}")
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


def edc_idc_records(financial_year="2026-2027"):
    conn = get_db_connection()
    ensure_edc_idc_table(conn)
    cursor = conn.cursor()
    for month in FINANCIAL_YEAR_MONTHS:
        cursor.execute(
            """
            INSERT INTO plant_level_amr_edc_idc (financial_year, month, be_cr, re_cr, actual_cr)
            VALUES (%s, %s, 0, 0, 0)
            ON CONFLICT (financial_year, month) DO NOTHING
            """,
            (financial_year or "2026-2027", month),
        )
    conn.commit()
    cursor.execute(
        """
        SELECT month, be_cr, re_cr, actual_cr
        FROM plant_level_amr_edc_idc
        WHERE financial_year=%s
          AND month = ANY(%s)
        """,
        (financial_year or "2026-2027", FINANCIAL_YEAR_MONTHS),
    )
    records = {row["month"]: dict(row) for row in cursor.fetchall()}
    conn.close()
    return records


def edc_idc_project_row(records=None):
    records = records or {}
    monthly = []
    for month in FINANCIAL_YEAR_MONTHS:
        record = records.get(month) or {}
        monthly.append({
            "month": month,
            "be": round(numeric(record.get("be_cr")), 2),
            "re": round(numeric(record.get("re_cr")), 2),
            "actual": round(numeric(record.get("actual_cr")), 2),
        })
    total_be = sum(item["be"] for item in monthly)
    total_re = sum(item["re"] for item in monthly)
    total_actual = sum(item["actual"] for item in monthly)
    return {
        "sl_no": "",
        "id": "plant-edc-idc-fixed-row",
        "is_fixed_row": True,
        "project_name": "EDC & IDC",
        "department": "",
        "contractor_name": "",
        "fy_classification": "-",
        "fy_classification_color": "neutral",
        "status": "-",
        "delay_days": "",
        "delay_category": "",
        "gross_cost_cr": round(total_be, 2),
        "actual_till_last_fy_cr": 0,
        "be_cr": round(total_be, 2),
        "re_cr": round(total_re, 2),
        "actual_current_fy_cr": round(total_actual, 2),
        "monthly": monthly,
    }


def gross_cost_cr(row):
    return numeric(
        row.get("stage2_cost")
        or row.get("stage1_cost")
        or row.get("formulation_cost")
        or row.get("gross_cost")
    )


def explicit_detail(row, key):
    return row.get(key) if row.get(key) is not None else None


def detail_or_fallback(row, detail_key, *fallback_keys):
    explicit = explicit_detail(row, detail_key)
    if explicit is not None:
        return explicit
    for key in fallback_keys:
        value = row.get(key)
        if value:
            return value
    return ""


def start_date(row):
    explicit = explicit_detail(row, "amr_start_date")
    if explicit is not None:
        return explicit
    return (
        row.get("start_date")
        or row.get("registration_date")
        or row.get("cod_date")
        or row.get("stage2_date")
    )


def schedule_months(row):
    explicit = explicit_detail(row, "amr_schedule_months")
    if explicit is not None:
        return numeric(explicit, 0)
    return numeric(
        row.get("schedule_months")
        or row.get("schedule_month")
        or row.get("duration_months"),
        0,
    )


def finish_date(row):
    explicit = explicit_detail(row, "amr_finish_date")
    if explicit is not None:
        return parse_date(explicit)
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
    explicit = explicit_detail(row, "amr_expected_finish_date")
    if explicit is not None:
        return parse_date(explicit)
    return (
        parse_date(row.get("expected_finish"))
        or parse_date(row.get("anticipated_completion"))
        or finish_date(row)
    )


def completion_date(row):
    explicit = explicit_detail(row, "amr_completion_date")
    if explicit is not None:
        return parse_date(explicit)
    return (
        parse_date(row.get("completion_date"))
        or parse_date(row.get("commissioned_date"))
    )


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


def _delay_category(delay_days):
    if delay_days >= 365:
        return "Delay > 1 Yr."
    if delay_days > 0:
        return "Delay < 1 Yr."
    return ""


def project_status_context(row, today=None):
    status_as_on = parse_date(today) or date.today()
    actual_completion = completion_date(row)
    if actual_completion and status_as_on >= actual_completion:
        return {"status": "Completed", "delay_days": 0, "delay_category": ""}

    has_schedule_start = bool(start_date(row))
    has_schedule_finish = bool(finish_date(row))
    if not has_schedule_start or not has_schedule_finish:
        return {"status": "Yet to Start", "delay_days": 0, "delay_category": ""}

    start = parse_date(start_date(row))
    if not start or start > status_as_on:
        return {"status": "Yet to Start", "delay_days": 0, "delay_category": ""}

    schedule_completion = finish_date(row)
    if not schedule_completion:
        return {"status": "On Time", "delay_days": 0, "delay_category": ""}

    if row.get("amr_expected_finish_date") is not None:
        explicit_expected = parse_date(row.get("amr_expected_finish_date"))
    else:
        explicit_expected = (
            parse_date(row.get("expected_finish"))
            or parse_date(row.get("anticipated_completion"))
        )
    if explicit_expected and explicit_expected > schedule_completion:
        delay_days = (explicit_expected - schedule_completion).days
        category = _delay_category(delay_days)
        return {"status": category or "On Time", "delay_days": max(0, delay_days), "delay_category": category}

    if status_as_on <= schedule_completion:
        return {"status": "On Time", "delay_days": 0, "delay_category": ""}

    delay_days = (status_as_on - schedule_completion).days
    category = _delay_category(delay_days)
    return {"status": category or "On Time", "delay_days": max(0, delay_days), "delay_category": category}


def project_status(row, today=None):
    return project_status_context(row, today)["status"]


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
        "re": round(numeric(record.get("re_cr")), 2),
        "actual": round(numeric(record.get("actual_cr")), 2),
    }


def project_row(row, index, today=None, records=None, financial_year=None):
    finish = finish_date(row)
    expected = expected_finish(row)
    gross = gross_cost_cr(row)
    status_context = project_status_context(row, today)
    fy_context = classify_project_financial_year(start_date(row), financial_year, today)
    at_date_value = row.get("amr_at_date") if row.get("amr_at_date") is not None else row.get("stage2_date") or row.get("cod_date")
    start_value = row.get("amr_start_date") if row.get("amr_start_date") is not None else start_date(row)
    expected_value = row.get("amr_expected_finish_date") if row.get("amr_expected_finish_date") is not None else expected
    completion_value = row.get("amr_completion_date") if row.get("amr_completion_date") is not None else completion_date(row)
    return {
        "sl_no": index,
        "id": row.get("id"),
        "project_name": row.get("project_name") or "",
        "department": detail_or_fallback(row, "amr_department", "department", "dept"),
        "contractor_name": detail_or_fallback(row, "amr_contractor_name", "contractor_name"),
        "at_no": detail_or_fallback(row, "amr_at_no"),
        "at_date": format_date(at_date_value),
        "scheduled_month": row.get("amr_schedule_months") or "",
        "schedule_months": row.get("amr_schedule_months") or "",
        "start_date": format_date(start_value),
        "finish_date": format_date(finish),
        "expected_finish_date": format_date(expected_value),
        "completion_date": format_date(completion_value),
        "physical_progress_percent": numeric(row.get("amr_physical_progress"), physical_progress_percent(row)) if row.get("amr_physical_progress") is not None else physical_progress_percent(row),
        "status": status_context["status"],
        "delay_days": status_context["delay_days"],
        "delay_category": status_context["delay_category"],
        "start_bucket": fy_context["fy_classification"],
        "fy_classification": fy_context["fy_classification"],
        "fy_classification_color": fy_context["fy_classification_color"],
        "financial_year": fy_context["financial_year"],
        "fy_start_date": fy_context["fy_start_date"],
        "fy_end_date": fy_context["fy_end_date"],
        "status_as_on_date": fy_context["status_as_on_date"],
        "project_start_date": fy_context["project_start_date"],
        "gross_cost_cr": round(numeric(row.get("amr_gross_cost"), gross), 2) if row.get("amr_gross_cost") is not None else round(gross, 2),
        "actual_till_last_fy_cr": round(numeric(row.get("amr_actual_till_last_fy")), 2),
        "remarks": detail_or_fallback(row, "amr_remarks", "master_remarks"),
        "be_cr": round(numeric(row.get("amr_be_amount"), gross), 2) if row.get("amr_be_amount") is not None else round(gross, 2),
        "re_cr": round(numeric(row.get("amr_re_amount"), gross), 2) if row.get("amr_re_amount") is not None else round(gross, 2),
        "monthly": [month_capex(row, month, records) for month in FINANCIAL_YEAR_MONTHS],
    }


def fetch_plant_level_projects():
    conn = get_db_connection()
    ensure_details_columns(conn)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT p.*,
               d.department AS amr_department,
               d.contractor_name AS amr_contractor_name,
               d.at_no AS amr_at_no,
               d.at_date AS amr_at_date,
               d.scheduled_month AS amr_schedule_months,
               d.schedule_start AS amr_start_date,
               d.schedule_completion AS amr_finish_date,
               d.anticipated_completion AS amr_expected_finish_date,
               d.completion_date AS amr_completion_date,
               d.physical_progress AS amr_physical_progress,
               d.amr_status AS amr_status,
               d.remarks AS amr_remarks,
               d.gross_cost AS amr_gross_cost,
               d.capex_till_last_fy AS amr_actual_till_last_fy,
               d.be_amount AS amr_be_amount,
               d.re_amount AS amr_re_amount
        FROM projects p
        LEFT JOIN plant_level_amr_details d ON d.project_id = p.id
        WHERE p.project_type='Plant Level AMR'
          AND COALESCE(p.project_dropped, 'N') <> 'Y'
          AND COALESCE(p.project_archived, 'N') <> 'Y'
        ORDER BY p.id DESC
        """
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def _filled_score(row):
    fields = (
        "amr_contractor_name", "amr_at_no", "amr_at_date", "amr_schedule_months",
        "amr_start_date", "amr_finish_date", "amr_expected_finish_date",
        "amr_physical_progress", "amr_gross_cost", "amr_remarks",
    )
    return sum(1 for field in fields if str(row.get(field) or "").strip())


def dedupe_project_rows(rows):
    deduped = {}
    for row in rows:
        at_no = normalize_template_header(row.get("amr_at_no") or row.get("at_no"))
        name = normalize_template_header(row.get("project_name"))
        key = at_no or name or str(row.get("id"))
        current = deduped.get(key)
        if not current or (_filled_score(row), row.get("id") or 0) > (_filled_score(current), current.get("id") or 0):
            deduped[key] = row
    return list(deduped.values())


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


def build_capex_summary(rows, records=None, edc_records=None):
    edc_row = edc_idc_project_row(edc_records)
    capex_rows = []
    for month in FINANCIAL_YEAR_MONTHS:
        be = sum(month_capex(row, month, records)["be"] for row in rows)
        re = sum(month_capex(row, month, records)["re"] or 0 for row in rows)
        actual = sum(month_capex(row, month, records)["actual"] or 0 for row in rows)
        edc_month = next((item for item in edc_row["monthly"] if item["month"] == month), {})
        be += numeric(edc_month.get("be"))
        re += numeric(edc_month.get("re"))
        actual += numeric(edc_month.get("actual"))
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
    total_be = sum(row["be_cr"] or 0 for row in capex_rows)
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


def first_re_month(row, records=None):
    for month in FINANCIAL_YEAR_MONTHS:
        if month in RE_MONTHS and numeric(month_capex(row, month, records).get("re")) > 0:
            return month
    return ""


def sum_month_values(row, records, months, metric):
    return sum(numeric(month_capex(row, month, records).get(metric)) for month in months)


def build_kpi_financials(rows, records=None, edc_records=None, selected_month=None):
    selected_index = FINANCIAL_YEAR_MONTHS.index(selected_month) if selected_month in FINANCIAL_YEAR_MONTHS else 0
    months_up_to_selected = FINANCIAL_YEAR_MONTHS[:selected_index + 1]
    totals = {
        "cumulative_be_cr": 0.0,
        "cumulative_re_cr": 0.0,
        "cumulative_actual_cr": 0.0,
        "as_on_be_cr": 0.0,
        "as_on_re_cr": 0.0,
        "as_on_actual_cr": 0.0,
    }
    for row in rows:
        totals["cumulative_be_cr"] += sum_month_values(row, records, FINANCIAL_YEAR_MONTHS, "be")
        totals["cumulative_actual_cr"] += sum_month_values(row, records, FINANCIAL_YEAR_MONTHS, "actual")
        totals["as_on_be_cr"] += sum_month_values(row, records, months_up_to_selected, "be")
        totals["as_on_actual_cr"] += sum_month_values(row, records, months_up_to_selected, "actual")

        re_month = first_re_month(row, records)
        if re_month:
            re_index = FINANCIAL_YEAR_MONTHS.index(re_month)
            fy_before_re = FINANCIAL_YEAR_MONTHS[:re_index]
            fy_re_onward = FINANCIAL_YEAR_MONTHS[re_index:]
            selected_before_re = FINANCIAL_YEAR_MONTHS[:min(re_index, selected_index + 1)]
            selected_re_onward = FINANCIAL_YEAR_MONTHS[re_index:selected_index + 1] if selected_index >= re_index else []
            totals["cumulative_re_cr"] += (
                sum_month_values(row, records, fy_before_re, "actual")
                + sum_month_values(row, records, fy_re_onward, "re")
            )
            totals["as_on_re_cr"] += (
                sum_month_values(row, records, selected_before_re, "actual")
                + sum_month_values(row, records, selected_re_onward, "re")
            )

    edc_row = edc_idc_project_row(edc_records)
    for index, item in enumerate(edc_row["monthly"]):
        totals["cumulative_be_cr"] += numeric(item.get("be"))
        totals["cumulative_re_cr"] += numeric(item.get("re"))
        totals["cumulative_actual_cr"] += numeric(item.get("actual"))
        if index <= selected_index:
            totals["as_on_be_cr"] += numeric(item.get("be"))
            totals["as_on_re_cr"] += numeric(item.get("re"))
            totals["as_on_actual_cr"] += numeric(item.get("actual"))

    return {key: round(value, 2) for key, value in totals.items()}


def build_dashboard(today=None, financial_year=None, month=None):
    today = plant_status_as_on_from_month(month, financial_year, today)
    financial_year = normalize_financial_year(financial_year, today)
    raw_rows = fetch_plant_level_projects()
    seed_default_monthly_rows(raw_rows)
    records = monthly_records([row.get("id") for row in raw_rows if row.get("id")])
    edc_records = edc_idc_records()
    project_rows = [project_row(row, index, today, records, financial_year) for index, row in enumerate(raw_rows, start=1)]
    project_rows.sort(
        key=lambda row: (
            0 if row.get("fy_classification") == "Ongoing Since Last FY" else 1,
            row.get("start_date") or "",
            str(row.get("project_name") or "").lower(),
        )
    )
    for index, row in enumerate(project_rows, start=1):
        row["sl_no"] = index
    started_label = classify_project_financial_year(today, status_as_on=today)["fy_classification"]
    fy_classification_counts = {
        started_label: {"label": started_label, "value": 0, "gross_cost_cr": 0.0, "color": "green"},
        "Ongoing Since Last FY": {"label": "Ongoing Since Last FY", "value": 0, "gross_cost_cr": 0.0, "color": "orange"},
    }
    for row in project_rows:
        label = row.get("fy_classification") or "Ongoing Since Last FY"
        fy_classification_counts.setdefault(
            label,
            {"label": label, "value": 0, "gross_cost_cr": 0.0, "color": row.get("fy_classification_color") or "orange"},
        )
        fy_classification_counts[label]["value"] += 1
        fy_classification_counts[label]["gross_cost_cr"] += numeric(row.get("gross_cost_cr"))
    status_counts = {status: 0 for status in STATUS_LABELS}
    status_gross_cost = {status: 0.0 for status in STATUS_LABELS}
    for row in project_rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
        status_gross_cost[row["status"]] = status_gross_cost.get(row["status"], 0.0) + numeric(row.get("gross_cost_cr"))
    total_projects = len(project_rows)
    total_gross_cost = sum(numeric(row.get("gross_cost_cr")) for row in project_rows)
    overall_progress = (
        sum(row["physical_progress_percent"] for row in project_rows) / total_projects
        if total_projects
        else 0
    )
    edc_idc = edc_idc_project_row(edc_records)
    capex = build_capex_summary(raw_rows, records, edc_records)
    kpi_financials = build_kpi_financials(raw_rows, records, edc_records, month)
    for row in fy_classification_counts.values():
        row["gross_cost_cr"] = round(row["gross_cost_cr"], 2)
    status_gross_cost = {status: round(value, 2) for status, value in status_gross_cost.items()}
    started_during_active_rows = [
        row for row in project_rows
        if "started" in str(row.get("fy_classification") or "").lower()
        and row.get("status") in {"On Time", "Completed", "Delay < 1 Yr.", "Delay > 1 Yr."}
    ]
    return {
        "as_on": today.isoformat(),
        "financial_year": financial_year,
        "fy_start_date": classify_project_financial_year(None, financial_year, today)["fy_start_date"],
        "fy_classification_rows": list(fy_classification_counts.values()),
        "financial_year_months": FINANCIAL_YEAR_MONTHS,
        "re_months": sorted(RE_MONTHS, key=FINANCIAL_YEAR_MONTHS.index),
        "projects": project_rows,
        "edc_idc": edc_idc,
        "summary": {
            "total_projects": total_projects,
            "total_gross_cost_cr": round(total_gross_cost, 2),
            "started_during_fy_active_count": len(started_during_active_rows),
            "started_during_fy_active_gross_cost_cr": round(sum(numeric(row.get("gross_cost_cr")) for row in started_during_active_rows), 2),
            "status_counts": status_counts,
            "status_gross_cost_cr": status_gross_cost,
            "status_percent": {
                status: round((count / total_projects * 100), 2) if total_projects else 0
                for status, count in status_counts.items()
            },
            "overall_progress_percent": round(overall_progress, 2),
            "cumulative_be_cr": kpi_financials["cumulative_be_cr"],
            "cumulative_re_cr": kpi_financials["cumulative_re_cr"],
            "cumulative_actual_cr": kpi_financials["cumulative_actual_cr"],
            "as_on_be_cr": kpi_financials["as_on_be_cr"],
            "as_on_re_cr": kpi_financials["as_on_re_cr"],
            "as_on_actual_cr": kpi_financials["as_on_actual_cr"],
        },
        "capex": capex,
    }


def update_edc_idc_monthly(month, metric, value, financial_year="2026-2027", today=None):
    if month not in FINANCIAL_YEAR_MONTHS:
        raise ValueError("Invalid financial year month")
    if metric not in METRIC_COLUMNS:
        raise ValueError("Metric must be be, re, or actual")
    conn = get_db_connection()
    ensure_edc_idc_table(conn)
    cursor = conn.cursor()
    column = METRIC_COLUMNS[metric]
    next_value = numeric(value)
    cursor.execute(
        """
        INSERT INTO plant_level_amr_edc_idc (financial_year, month, be_cr, re_cr, actual_cr)
        VALUES (%s, %s, 0, 0, 0)
        ON CONFLICT (financial_year, month) DO NOTHING
        """,
        (financial_year or "2026-2027", month),
    )
    cursor.execute(
        f"""
        UPDATE plant_level_amr_edc_idc
        SET {column}=%s,
            updated_at=CURRENT_TIMESTAMP
        WHERE financial_year=%s
          AND month=%s
        """,
        (next_value, financial_year or "2026-2027", month),
    )
    conn.commit()
    conn.close()
    return build_dashboard(today=today, financial_year=financial_year)


def update_edc_idc_values(monthly_values, financial_year="2026-2027", today=None):
    conn = get_db_connection()
    ensure_edc_idc_table(conn)
    cursor = conn.cursor()
    financial_year = financial_year or "2026-2027"
    values_by_month = {
        str(item.get("month") or "").strip(): item
        for item in monthly_values or []
        if str(item.get("month") or "").strip() in FINANCIAL_YEAR_MONTHS
    }
    for month in FINANCIAL_YEAR_MONTHS:
        item = values_by_month.get(month) or {}
        cursor.execute(
            """
            INSERT INTO plant_level_amr_edc_idc (financial_year, month, be_cr, re_cr, actual_cr)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (financial_year, month) DO UPDATE SET
                be_cr=EXCLUDED.be_cr,
                re_cr=EXCLUDED.re_cr,
                actual_cr=EXCLUDED.actual_cr,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                financial_year,
                month,
                numeric(item.get("be")),
                numeric(item.get("re")),
                numeric(item.get("actual")),
            ),
        )
    conn.commit()
    conn.close()
    return build_dashboard(today=today, financial_year=financial_year)


def update_monthly_value(project_id, month, metric, value, financial_year="2026-2027"):
    if month not in FINANCIAL_YEAR_MONTHS:
        raise ValueError("Invalid financial year month")
    if metric not in METRIC_COLUMNS:
        raise ValueError("Metric must be be, re, or actual")
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


def update_project_field(project_id, field, value, financial_year=None, month=None, status_as_on=None):
    if field != "project_name" and field not in DETAIL_FIELDS:
        raise ValueError("Unsupported Plant Level AMR field")
    if field == "remarks" and len(str(value or "").strip()) > REMARKS_MAX_LENGTH:
        raise ValueError(f"Remarks cannot exceed {REMARKS_MAX_LENGTH} characters.")
    conn = get_db_connection()
    ensure_details_columns(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s AND project_type='Plant Level AMR'", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise LookupError("Plant Level AMR project not found")
    if field == "project_name":
        cursor.execute("UPDATE projects SET project_name=%s WHERE id=%s", (str(value or "").strip(), project_id))
        conn.commit()
        conn.close()
        return build_dashboard(today=status_as_on, financial_year=financial_year, month=month)
    cursor.execute(
        """
        INSERT INTO plant_level_amr_details (project_id)
        VALUES (%s)
        ON CONFLICT (project_id) DO NOTHING
        """,
        (project_id,),
    )
    column = DETAIL_FIELDS[field]
    next_value = value
    if field in {"gross_cost_cr", "actual_till_last_fy_cr", "be_cr", "re_cr", "physical_progress_percent"}:
        next_value = numeric(value)
    elif field in {"scheduled_month", "schedule_months"}:
        next_value = str(int(numeric(value))) if numeric(value) else ""
    elif field in {"at_date", "start_date", "finish_date", "expected_finish_date", "completion_date"}:
        next_value = format_date(value) or str(value or "").strip()
    else:
        next_value = str(value or "").strip()
    if field == "remarks" and len(next_value) > REMARKS_MAX_LENGTH:
        raise ValueError(f"Remarks cannot exceed {REMARKS_MAX_LENGTH} characters.")
    cursor.execute(
        f"UPDATE plant_level_amr_details SET {column}=%s WHERE project_id=%s",
        (next_value, project_id),
    )
    if field in {"start_date", "finish_date", "schedule_months", "scheduled_month"}:
        cursor.execute(
            """
            SELECT p.*,
                   d.scheduled_month AS amr_schedule_months,
                   d.schedule_start AS amr_start_date,
                   d.schedule_completion AS amr_finish_date
            FROM projects p
            LEFT JOIN plant_level_amr_details d ON d.project_id = p.id
            WHERE p.id=%s
            """,
            (project_id,),
        )
        refreshed = cursor.fetchone()
        calculated_finish = (
            add_months(start_date(refreshed), schedule_months(refreshed))
            if refreshed and field in {"schedule_months", "scheduled_month"} and str(next_value or "").strip()
            else None
        )
        if calculated_finish and field in {"schedule_months", "scheduled_month"}:
            cursor.execute(
                "UPDATE plant_level_amr_details SET schedule_completion=%s WHERE project_id=%s",
                (format_date(calculated_finish), project_id),
            )
        if refreshed and field in {"start_date", "finish_date"}:
            calculated_months = months_between(start_date(refreshed), finish_date(refreshed))
            cursor.execute(
                "UPDATE plant_level_amr_details SET scheduled_month=%s WHERE project_id=%s",
                (calculated_months, project_id),
            )
    conn.commit()
    conn.close()
    return build_dashboard(today=status_as_on, financial_year=financial_year, month=month)


def update_project_fields(project_id, fields, financial_year=None, month=None, status_as_on=None):
    if not isinstance(fields, dict):
        raise ValueError("Project fields must be provided as an object")
    dashboard = None
    for field, value in fields.items():
        if field in {"id"}:
            continue
        dashboard = update_project_field(project_id, field, value, financial_year, month, status_as_on)
    return dashboard or build_dashboard(today=status_as_on, financial_year=financial_year, month=month)


def import_template_csv(filename, content):
    if not str(filename or "").lower().endswith(".csv"):
        raise ValueError("Please upload the downloaded CSV template. Excel .xlsx/.xls upload is not supported in this window.")
    text = str(content or "")
    if not text.strip():
        raise ValueError("Upload file is empty.")
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader if any(str(cell or "").strip() for cell in row)]
    if not rows:
        raise ValueError("Upload file is empty.")
    headers = rows[0]
    header_map = {normalize_template_header(header): index for index, header in enumerate(headers)}
    name_index = header_map.get(normalize_template_header("Project Name"))
    if name_index is None:
        raise ValueError(f"Upload template must include Project Name. Found columns: {', '.join(headers) if headers else 'none'}")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, project_name
        FROM projects
        WHERE project_type='Plant Level AMR'
          AND COALESCE(project_dropped, 'N') <> 'Y'
          AND COALESCE(project_archived, 'N') <> 'Y'
        """
    )
    project_lookup = {}
    duplicate_names = set()
    for project in cursor.fetchall():
        key = normalize_template_header(project["project_name"])
        if key in project_lookup:
            duplicate_names.add(key)
        else:
            project_lookup[key] = int(project["id"])
    conn.close()

    base_fields = [(label, field) for label, field in TEMPLATE_BASE_FIELDS if field != "project_name"]
    updated = 0
    skipped = 0
    failed = 0
    errors = []

    for row_number, row in enumerate(rows[1:], start=2):
        project_name = str(row[name_index] if name_index < len(row) else "").strip()
        project_key = normalize_template_header(project_name)
        if not project_key:
            skipped += 1
            continue
        if project_key in {"edc idc", "edc and idc"}:
            skipped += 1
            continue
        if project_key in duplicate_names:
            failed += 1
            errors.append(f"Row {row_number}: duplicate Project Name in backend '{project_name}'")
            continue
        project_id = project_lookup.get(project_key)
        if not project_id:
            failed += 1
            errors.append(f"Row {row_number}: Project Name not found '{project_name}'")
            continue
        try:
            for label, field in base_fields:
                index = header_map.get(normalize_template_header(label))
                if index is None and field == "schedule_months":
                    index = header_map.get(normalize_template_header("Scheduled Month"))
                if index is None and field == "physical_progress_percent":
                    index = header_map.get(normalize_template_header("Physical Progress %"))
                if index is None and field == "expected_finish_date":
                    index = header_map.get(normalize_template_header("Expected Finish Date"))
                if index is None and field == "gross_cost_cr":
                    index = header_map.get(normalize_template_header("Gross Cost (Cr)"))
                if index is None and field == "be_cr":
                    index = header_map.get(normalize_template_header("BE (Cr)"))
                if index is None and field == "re_cr":
                    index = header_map.get(normalize_template_header("RE (Cr)"))
                if index is None and field == "actual_till_last_fy_cr":
                    index = header_map.get(normalize_template_header("Actual Till Last FY (Cr)"))
                if index is None or index >= len(row):
                    continue
                update_project_field(project_id, field, str(row[index] or "").strip())
            updated += 1
        except (LookupError, ValueError) as exc:
            failed += 1
            errors.append(f"Row {row_number}: {exc}")

    if not updated and failed:
        raise ValueError("; ".join(errors[:5]))
    if not updated:
        raise ValueError(
            f"No project rows were uploaded. "
            f"{skipped} rows had blank Project Name." if skipped else "Please check that rows below the header contain Project Name."
        )
    dashboard = build_dashboard()
    dashboard["upload_result"] = {
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "errors": errors[:10],
    }
    return dashboard
